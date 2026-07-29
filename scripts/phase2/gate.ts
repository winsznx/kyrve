/**
 * `pnpm verify:phase2` — every Phase 2 gate, in one command, with an honest summary.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a gate that reports PASS for something it did not run is
 * worse than no gate at all. Anything that cannot execute in the current environment is reported as
 * SKIPPED, with the exact reason and the exact command that would run it, and is never folded into
 * the pass count. The Nox suite in particular needs Docker and multi-gigabyte images, so it is
 * possible to have a green summary that proves nothing — the verdict says so explicitly.
 *
 * WHAT IS COVERED, matching the Phase 2 requirement list:
 *
 *   the real Nox suite            50 tests against the live local stack, including the browser flow
 *   contract tests                the Foundry substrate suite, unchanged from Phase 1
 *   local deployment              driven inside the Nox suite, which is the only place a chain,
 *                                 the off-chain stack and the contracts all exist at once
 *   browser flow                  real Chromium against the real terminal, inside that same suite
 *   security scans                slither, licence, dependency advisories, import boundary, bundles
 *   secret scan                   every tracked and untracked file, per credential
 *   generated-file checks         ABIs, bindings and deployment records regenerate byte-identically
 *   Sepolia read verification     when a deployment record exists; skipped, loudly, when it does not
 */

import { existsSync } from "node:fs";

import { readJson, repoPath, run } from "../lib/shell.js";

type Status = "PASS" | "FAIL" | "SKIP";
type Section = "CONFIDENTIAL LAYER" | "PRIVACY" | "QUALITY AND SECURITY" | "SEPOLIA";

interface GateResult {
  readonly section: Section;
  readonly name: string;
  readonly status: Status;
  readonly detail: string;
}

interface Gate {
  readonly section: Section;
  readonly name: string;
  /** Returns a skip reason, or null when the gate can run. */
  readonly skipIf?: () => string | null;
  readonly execute: () => string;
}

function summarise(output: string, lines = 1): string {
  const meaningful = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return meaningful.slice(-lines).join(" | ") || "(no output)";
}

function dockerAvailable(): boolean {
  try {
    run("docker", ["info"], { allowFailure: true });
    return true;
  } catch {
    return false;
  }
}

/** The captured confidential-suite output, so the privacy scan can search it for real values. */
const SUITE_LOG = repoPath("evidence/phase2/confidential-suite.log");

const GATES: readonly Gate[] = [
  // ── The confidential layer ────────────────────────────────────────────────────────────────
  {
    section: "CONFIDENTIAL LAYER",
    name: "workspace reproducibility (--frozen-lockfile)",
    execute: () => {
      run("pnpm", ["install", "--frozen-lockfile"]);
      return "lockfile satisfied without modification";
    },
  },
  {
    section: "CONFIDENTIAL LAYER",
    name: "TypeScript build across every package",
    execute: () => {
      run("pnpm", ["exec", "tsc", "--build", "--force"]);
      return "tsc --build clean across all project references";
    },
  },
  {
    section: "CONFIDENTIAL LAYER",
    name: "web terminal typecheck",
    execute: () => {
      run("pnpm", ["--filter", "@kyrve/web", "exec", "tsc", "-p", "tsconfig.json", "--noEmit"]);
      return "no type errors in the confidential terminal";
    },
  },
  {
    section: "CONFIDENTIAL LAYER",
    name: "confidential contracts compile (solc 0.8.36, osaka)",
    execute: () =>
      summarise(
        run("pnpm", ["--filter", "@kyrve/confidential", "exec", "hardhat", "compile"]).stdout,
      ),
  },
  {
    section: "CONFIDENTIAL LAYER",
    name: "vendored Nox stack matches the pinned plugin",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/nox-stack.ts"]).stdout, 2),
  },
  {
    section: "CONFIDENTIAL LAYER",
    name: "Foundry substrate suite",
    execute: () => summarise(run("forge", ["test"]).stdout, 1),
  },
  {
    section: "CONFIDENTIAL LAYER",
    name: "unit and property tests",
    execute: () => summarise(run("pnpm", ["exec", "vitest", "run"]).stdout, 3),
  },
  {
    section: "CONFIDENTIAL LAYER",
    name: "Worker tests under workerd",
    execute: () => summarise(run("pnpm", ["--filter", "./workers/*", "test"]).stdout, 1),
  },
  {
    /**
     * The one that matters most, and the one most likely to be skipped.
     *
     * It brings up the real KMS, handle gateway, ingestor and runner in Docker, deploys the
     * confidential layer, drives every demonstration, repeats the gas experiment, and runs the
     * terminal in a real browser. Its output is captured to `evidence/phase2/` so the privacy scan
     * can then search the actual text for actual private values.
     */
    section: "CONFIDENTIAL LAYER",
    name: "Nox suite + local deployment + browser flow (real stack)",
    skipIf: () =>
      dockerAvailable()
        ? null
        : "Docker is not running. The Nox stack (KMS, gateway, ingestor, runner) cannot start, so " +
          "NOTHING about the confidential path is verified by this run. Start Docker and re-run: " +
          "pnpm --filter @kyrve/confidential test",
    execute: () => {
      run("bash", [
        "-c",
        `mkdir -p "$(dirname ${SUITE_LOG})" && pnpm --filter @kyrve/confidential test 2>&1 | tee ${SUITE_LOG}`,
      ]);
      const log = run("bash", ["-c", `grep -E "passing|failing" ${SUITE_LOG} | tail -2`]).stdout;
      if (/[1-9][0-9]* failing/.test(log)) throw new Error(`confidential suite: ${log.trim()}`);
      return summarise(log, 2);
    },
  },

  // ── Privacy ───────────────────────────────────────────────────────────────────────────────
  {
    section: "PRIVACY",
    name: "no private value in any file, log or code path",
    execute: () => {
      const args = ["exec", "tsx", "scripts/verify/privacy-scan.ts"];
      if (existsSync(SUITE_LOG)) args.push(SUITE_LOG);
      return summarise(run("pnpm", args).stdout, 3);
    },
  },
  {
    section: "PRIVACY",
    name: "import boundary (Nox isolation, A-15)",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/import-boundary.ts"]).stdout, 1),
  },
  {
    section: "PRIVACY",
    name: "gas side-channel evidence recorded and not overclaimed",
    skipIf: () =>
      existsSync(repoPath("evidence/phase2/gas-side-channel.json"))
        ? null
        : "no measurement recorded; it is produced by the Nox suite above",
    execute: () => {
      const evidence = readJson<{
        verdict: {
          groupsSeparatedByGas: boolean;
          noiseFloorGas: number;
          mandateShapeSeparableByGas: boolean;
          claim: string;
        };
      }>(repoPath("evidence/phase2/gas-side-channel.json"));

      if (evidence.verdict.groupsSeparatedByGas) {
        throw new Error("covered and short withdrawals separated by gas — a real side channel");
      }
      if (evidence.verdict.mandateShapeSeparableByGas) {
        throw new Error("mandate shape is readable from gas — the enabled-market count leaks");
      }
      // The claim must remain honest. A run that started asserting indistinguishability would be a
      // regression in the evidence itself, not an improvement.
      if (!evidence.verdict.claim.includes("does NOT establish gas")) {
        throw new Error("the recorded verdict no longer disclaims gas indistinguishability");
      }
      return `noise floor ${evidence.verdict.noiseFloorGas} gas, no separation, claim still disclaimed`;
    },
  },

  // ── Quality and security ──────────────────────────────────────────────────────────────────
  {
    section: "QUALITY AND SECURITY",
    name: "lint and format",
    execute: () => {
      run("pnpm", ["exec", "biome", "check", "."]);
      run("forge", ["fmt", "--check"]);
      return "biome 0 errors, forge fmt clean";
    },
  },
  {
    section: "QUALITY AND SECURITY",
    name: "secret scan",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/secrets.ts"]).stdout, 2),
  },
  {
    section: "QUALITY AND SECURITY",
    name: "licence matrix",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/licence.ts"]).stdout, 1),
  },
  {
    section: "QUALITY AND SECURITY",
    name: "slither static analysis",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/slither.ts"]).stdout, 2),
  },
  {
    section: "QUALITY AND SECURITY",
    name: "dependency advisories",
    execute: () => {
      run("pnpm", ["audit", "--audit-level", "moderate"]);
      return "0 advisories at moderate or above";
    },
  },
  {
    section: "QUALITY AND SECURITY",
    name: "generated artifacts are byte-identical on regeneration",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/generated.ts"]).stdout, 2),
  },
  {
    section: "QUALITY AND SECURITY",
    name: "Worker bundles clean under workerd",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/bundles.ts"]).stdout, 1),
  },
  {
    section: "QUALITY AND SECURITY",
    name: "vendored Midnight unmodified",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/vendor.ts"]).stdout, 2),
  },

  // ── Sepolia ───────────────────────────────────────────────────────────────────────────────
  {
    section: "SEPOLIA",
    name: "confidential layer deployed, wired and live on Sepolia",
    skipIf: () =>
      existsSync(repoPath("deployments/sepolia/confidential.json"))
        ? null
        : "no Sepolia confidential deployment recorded. Deploy with: " +
          "DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true pnpm deploy:confidential sepolia",
    execute: () =>
      summarise(
        run("pnpm", ["exec", "tsx", "scripts/verify/confidential.ts", "sepolia"]).stdout,
        4,
      ),
  },
  {
    section: "SEPOLIA",
    name: "Etherscan source verification",
    skipIf: () => {
      if (!existsSync(repoPath("deployments/sepolia/confidential.json"))) {
        return "no Sepolia confidential deployment recorded";
      }
      return existsSync(repoPath("deployments/sepolia/confidential-etherscan.json"))
        ? null
        : "source not yet submitted. Run: pnpm verify:etherscan:confidential";
    },
    execute: () => {
      const record = readJson<{ verified: number; total: number }>(
        repoPath("deployments/sepolia/confidential-etherscan.json"),
      );
      if (record.verified !== record.total) {
        throw new Error(`${record.verified}/${record.total} contracts verified`);
      }
      return `${record.verified}/${record.total} contracts verified on Etherscan V2`;
    },
  },
];

function main(): void {
  const results: GateResult[] = [];

  for (const gate of GATES) {
    const skip = gate.skipIf?.() ?? null;
    if (skip !== null) {
      results.push({ section: gate.section, name: gate.name, status: "SKIP", detail: skip });
      continue;
    }
    try {
      results.push({
        section: gate.section,
        name: gate.name,
        status: "PASS",
        detail: gate.execute(),
      });
    } catch (error) {
      results.push({
        section: gate.section,
        name: gate.name,
        status: "FAIL",
        detail: error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : String(error),
      });
    }
  }

  const width = Math.min(60, Math.max(...results.map((result) => result.name.length)));
  console.log("\nKyrve Phase 2 gate — confidential assets, mandates and requests\n");

  const sections: Section[] = ["CONFIDENTIAL LAYER", "PRIVACY", "QUALITY AND SECURITY", "SEPOLIA"];
  for (const section of sections) {
    const inSection = results.filter((result) => result.section === section);
    if (inSection.length === 0) continue;
    console.log(`PHASE 2 — ${section}\n`);
    for (const result of inSection) {
      console.log(`  ${result.status.padEnd(4)}  ${result.name.padEnd(width)}  ${result.detail}`);
    }
    console.log("");
  }

  const passed = results.filter((result) => result.status === "PASS").length;
  const failed = results.filter((result) => result.status === "FAIL").length;
  const skipped = results.filter((result) => result.status === "SKIP").length;
  const noxSkipped = results.some(
    (result) => result.status === "SKIP" && result.name.startsWith("Nox suite"),
  );

  console.log(`\n  ${passed} passed, ${failed} failed, ${skipped} skipped\n`);

  if (failed > 0) {
    console.log("  VERDICT: FAIL — a gate did not pass.\n");
    process.exitCode = 1;
    return;
  }
  if (noxSkipped) {
    console.log(
      "  VERDICT: NOT VERIFIED — the confidential suite did not run, so nothing about the\n" +
        "  confidentiality path was checked by this invocation. The other gates passed; they are\n" +
        "  necessary and nowhere near sufficient.\n",
    );
    process.exitCode = 1;
    return;
  }
  if (skipped > 0) {
    console.log(
      "  VERDICT: CONDITIONAL PASS — every executable gate passed. The skipped gates above need\n" +
        "  an environment this run did not have, and each names the exact command.\n",
    );
    return;
  }
  console.log("  VERDICT: PASS — every gate executed and passed.\n");
}

main();
