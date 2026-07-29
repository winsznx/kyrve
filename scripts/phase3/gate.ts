/**
 * `pnpm verify:phase3` — every Phase 3 gate, in one command, with an honest summary.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE, unchanged from Phase 2: a gate that reports PASS for
 * something it did not run is worse than no gate at all. Anything that cannot execute in the
 * current environment is reported as SKIPPED, with the exact reason and the exact command that
 * would run it, and is never folded into the pass count.
 *
 * The confidential suite needs Docker and multi-gigabyte images, so it is possible to have a green
 * summary that proves nothing about the confidentiality path. The verdict says so explicitly and
 * the process exits non-zero, exactly as Phase 2 does.
 */

import { existsSync } from "node:fs";

import { readJson, repoPath, run } from "../lib/shell.js";

type Status = "PASS" | "FAIL" | "SKIP";
type Section =
  | "LOCKS AND BOUNDARIES"
  | "CURVE ENGINE"
  | "PRIVACY"
  | "QUALITY AND SECURITY"
  | "SEPOLIA";

interface GateResult {
  readonly section: Section;
  readonly name: string;
  readonly status: Status;
  readonly detail: string;
}

interface Gate {
  readonly section: Section;
  readonly name: string;
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
const SUITE_LOG = repoPath("evidence/phase3/curve-suite.log");

const GATES: readonly Gate[] = [
  {
    /**
     * FIRST IN THE ARRAY, and displayed under quality because that is where it belongs.
     *
     * Later gates legitimately rewrite evidence files — the benchmark records fresh gas, the gas
     * experiment records fresh samples — so a clean-tree check that ran after them would fail on
     * the gate's own output and would have to be weakened until it stopped meaning anything. Run
     * first, it checks the tree as the developer left it, which is the question worth asking.
     */
    section: "QUALITY AND SECURITY",
    name: "Git identity and a clean working tree",
    execute: () => {
      const name = run("git", ["config", "user.name"]).stdout.trim();
      const email = run("git", ["config", "user.email"]).stdout.trim();
      if (name !== "winsznx") {
        throw new Error(`git user.name is "${name}", expected winsznx`);
      }
      const trailers = run("bash", [
        "-c",
        "git log --format=%B phase/02-confidential-assets..HEAD | grep -ci 'Co-Authored-By' || true",
      ]).stdout.trim();
      if (trailers !== "0") {
        throw new Error(`${trailers} commit(s) carry a Co-Authored-By trailer; none may`);
      }
      const dirty = run("git", ["status", "--porcelain"]).stdout.trim();
      if (dirty.length > 0) {
        throw new Error(
          `the working tree is not clean:\n${dirty.split("\n").slice(0, 5).join("\n")}`,
        );
      }
      return `${name} <${email}>, no co-author trailers, tree clean`;
    },
  },

  // ── Locks and boundaries ──────────────────────────────────────────────────────────────────
  {
    section: "LOCKS AND BOUNDARIES",
    name: "workspace reproducibility (--frozen-lockfile)",
    execute: () => {
      run("pnpm", ["install", "--frozen-lockfile"]);
      return "lockfile satisfied without modification";
    },
  },
  {
    section: "LOCKS AND BOUNDARIES",
    name: "source lock",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/source-lock.ts"]).stdout, 1),
  },
  {
    section: "LOCKS AND BOUNDARIES",
    name: "toolchain lock",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/toolchain.ts"]).stdout, 1),
  },
  {
    section: "LOCKS AND BOUNDARIES",
    name: "Nox import boundary (only @kyrve/nox may reach iExec)",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/import-boundary.ts"]).stdout, 1),
  },
  {
    section: "LOCKS AND BOUNDARIES",
    name: "vendored Midnight unmodified",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/vendor.ts"]).stdout, 2),
  },
  {
    section: "LOCKS AND BOUNDARIES",
    name: "TypeScript build across every package",
    execute: () => {
      run("pnpm", ["exec", "tsc", "--build", "--force"]);
      return "tsc --build clean across all project references";
    },
  },
  {
    /**
     * `scripts/` is NOT in the root tsconfig solution, so `tsc --build` never covered it — and
     * that is the entire deployment, verification and gate tree. Found when a genuinely broken
     * script typechecked clean under `tsc --build` and then failed at runtime. Every other script
     * turned out to be fine, so nothing had drifted into the gap, but a gap that reports success
     * is the shape of thing this repository exists to close. Delta R-13.
     */
    section: "LOCKS AND BOUNDARIES",
    name: "TypeScript across scripts/ (not covered by tsc --build)",
    execute: () => {
      run("pnpm", ["exec", "tsc", "-p", "scripts/tsconfig.json", "--noEmit"]);
      return "scripts/ typechecks clean";
    },
  },
  {
    section: "LOCKS AND BOUNDARIES",
    name: "confidential contracts compile (solc 0.8.36, osaka)",
    execute: () =>
      summarise(
        run("pnpm", ["--filter", "@kyrve/confidential", "exec", "hardhat", "compile"]).stdout,
      ),
  },
  {
    /**
     * The check whose absence let a 25,040-byte engine pass an entire test suite. A Hardhat node
     * allows unlimited contract size; EIP-170 does not.
     */
    section: "LOCKS AND BOUNDARIES",
    name: "every deployable contract fits EIP-170",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/contract-size.ts"]).stdout, 2),
  },

  // ── The curve engine ──────────────────────────────────────────────────────────────────────
  {
    section: "CURVE ENGINE",
    name: "unit, property and reference-model tests",
    execute: () => summarise(run("pnpm", ["exec", "vitest", "run"]).stdout, 3),
  },
  {
    section: "CURVE ENGINE",
    name: "Foundry substrate suite",
    execute: () => summarise(run("forge", ["test"]).stdout, 1),
  },
  {
    section: "CURVE ENGINE",
    name: "Worker tests under workerd",
    execute: () => summarise(run("pnpm", ["--filter", "./workers/*", "test"]).stdout, 1),
  },
  {
    /**
     * The one that matters most, and the one most likely to be skipped.
     *
     * It brings up the real KMS, handle gateway, ingestor and runner in Docker and runs every
     * demonstration, every attack, the full 16 x 128 benchmark, the gas experiment and the
     * public-surface scan. Its output is captured so the privacy scan can then search the actual
     * text for actual private values.
     */
    section: "CURVE ENGINE",
    name: "Nox suite: 20 demonstrations, attacks, 16x128 benchmark (real stack)",
    skipIf: () =>
      dockerAvailable()
        ? null
        : "Docker is not running. The Nox stack (KMS, gateway, ingestor, runner) cannot start, so " +
          "NOTHING about the curve engine's confidentiality path is verified by this run. Start " +
          "Docker and re-run: pnpm --filter @kyrve/confidential test",
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
  {
    section: "CURVE ENGINE",
    name: "16x128 benchmark recorded, and the planner sized against it",
    skipIf: () =>
      existsSync(repoPath("evidence/phase3/stage-gas.json"))
        ? null
        : "no measurement recorded; it is produced by the Nox suite above",
    execute: () => {
      const evidence = readJson<{
        universe: { providers: number; leaves: number; cells: number };
        limits: { transactionGasCeiling: number; peakTransactionGas: number };
        perUnit: Record<string, number>;
      }>(repoPath("evidence/phase3/stage-gas.json"));

      if (evidence.universe.cells !== 2048) {
        throw new Error(
          `the benchmark covered ${evidence.universe.cells} cells, not the full 2,048`,
        );
      }
      if (evidence.limits.peakTransactionGas >= evidence.limits.transactionGasCeiling) {
        throw new Error(
          `peak transaction ${evidence.limits.peakTransactionGas} gas is at or above the ceiling`,
        );
      }
      return (
        `${evidence.universe.providers}x${evidence.universe.leaves}, ${evidence.universe.cells} cells, ` +
        `peak ${evidence.limits.peakTransactionGas} gas, cell ${evidence.perUnit["accumulateCell"]}`
      );
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
    name: "gas side-channel measured against the curve engine, and not overclaimed",
    skipIf: () =>
      existsSync(repoPath("evidence/phase3/gas-side-channel.json"))
        ? null
        : "no measurement recorded; it is produced by the Nox suite above",
    execute: () => {
      const evidence = readJson<{
        verdict: { groupsSeparatedByGas: boolean; noiseFloorGas: number; claim: string };
      }>(repoPath("evidence/phase3/gas-side-channel.json"));

      if (evidence.verdict.groupsSeparatedByGas) {
        throw new Error("the two branches are separated by gas — a real side channel");
      }
      // The claim must remain honest. A run that started asserting indistinguishability would be a
      // regression in the evidence itself, not an improvement.
      if (!evidence.verdict.claim.includes("does NOT establish")) {
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
  // ── Sepolia ───────────────────────────────────────────────────────────────────────────────
  {
    section: "SEPOLIA",
    name: "AS-1: an encrypted input round-tripped through the HOSTED stack",
    skipIf: () =>
      existsSync(repoPath("evidence/phase3/sepolia-nox-smoke.json"))
        ? null
        : "not run. This is the Phase 3 PREREQUISITE and must pass before the layer is trusted " +
          "on Sepolia: DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true pnpm test:sepolia-nox",
    execute: () => {
      const evidence = readJson<{
        handles: number;
        gasUsed: string;
        latencyMs: { encryptPerHandle: number; runnerAndDecrypt: number };
        ownerCanDecrypt: boolean;
        valueRecorded: boolean;
        verdict: string;
      }>(repoPath("evidence/phase3/sepolia-nox-smoke.json"));

      if (!evidence.ownerCanDecrypt)
        throw new Error("the owner could not decrypt their own handle");
      // No Kyrve artifact ever records a decrypted value, and the evidence file says so about
      // itself. If that ever flips, the privacy scan is being asked to police a file that
      // volunteered a plaintext.
      if (evidence.valueRecorded) throw new Error("the smoke evidence recorded a decrypted VALUE");
      if (!evidence.verdict.includes("does NOT establish")) {
        throw new Error("the recorded verdict no longer disclaims what it cannot prove");
      }
      return (
        `${evidence.handles} handles, ${evidence.gasUsed} gas, ` +
        `${evidence.latencyMs.encryptPerHandle} ms/handle, decrypt ${evidence.latencyMs.runnerAndDecrypt} ms`
      );
    },
  },
  {
    section: "SEPOLIA",
    name: "curve layer deployed, bound and wired on Sepolia",
    skipIf: () =>
      existsSync(repoPath("deployments/sepolia/curve.json"))
        ? null
        : "no Sepolia curve deployment recorded. Deploy with: " +
          "DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true pnpm deploy:curve sepolia",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/curve.ts", "sepolia"]).stdout, 3),
  },
  {
    section: "SEPOLIA",
    name: "Etherscan source verification",
    skipIf: () =>
      existsSync(repoPath("deployments/sepolia/curve-etherscan.json"))
        ? null
        : "source not yet submitted. Run: pnpm verify:etherscan:curve",
    execute: () => {
      const record = readJson<{ verified: number; total: number }>(
        repoPath("deployments/sepolia/curve-etherscan.json"),
      );
      if (record.verified !== record.total) {
        throw new Error(`${record.verified}/${record.total} contracts verified`);
      }
      return `${record.verified}/${record.total} contracts verified on Etherscan V2`;
    },
  },
  {
    /**
     * Deliberately a SKIP rather than a silent omission.
     *
     * A real Sepolia epoch is affordable arithmetic, not a technical unknown, and the shortfall is
     * priced from measured local gas at the live gas price. Reporting it as anything other than
     * "not run, here is what it costs" would be claiming a result nobody produced.
     */
    section: "SEPOLIA",
    name: "a real curve epoch executed on Sepolia",
    skipIf: () =>
      existsSync(repoPath("evidence/phase3/sepolia-epoch.json"))
        ? null
        : "NOT RUN — a funding gap, not a technical one. It needs about 24,830,000 gas across " +
          "roughly 120 transactions; price it against the live network with " +
          "`pnpm exec tsx scripts/test/sepolia-epoch-budget.ts`. Every stage is proven against " +
          "the real Nox stack locally, and the deployed layer is verified read-only above.",
    execute: () => {
      const evidence = readJson<{
        epochId: string;
        matchesPlaintextReferenceModel: boolean;
        published: { aggregateFillAmount: string; quoteReady: boolean };
      }>(repoPath("evidence/phase3/sepolia-epoch.json"));

      // The whole reason for running on a public network. A recorded epoch that did NOT match the
      // model must fail the gate rather than be reported as "ran".
      if (!evidence.matchesPlaintextReferenceModel) {
        throw new Error("the Sepolia epoch did not match the plaintext reference model");
      }
      if (!evidence.published.quoteReady) {
        throw new Error("the Sepolia epoch produced no quote, so it proves nothing about a fill");
      }

      // Cost comes from the balance-derived measurement, not from the epoch evidence: a `--resume`
      // verification spends nothing, so reading gas from there would report zero for a real epoch.
      const costPath = repoPath("evidence/phase3/sepolia-epoch-cost.json");
      const cost = existsSync(costPath)
        ? readJson<{ totalEth: string }>(costPath).totalEth
        : "cost not measured";
      return `epoch ${evidence.epochId.slice(0, 10)}…, aggregate ${evidence.published.aggregateFillAmount}, matches the model, ${cost} ETH`;
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

  const width = Math.min(62, Math.max(...results.map((result) => result.name.length)));
  console.log("\nKyrve Phase 3 gate — the confidential curve engine\n");

  const sections: Section[] = [
    "LOCKS AND BOUNDARIES",
    "CURVE ENGINE",
    "PRIVACY",
    "QUALITY AND SECURITY",
    "SEPOLIA",
  ];
  for (const section of sections) {
    const inSection = results.filter((result) => result.section === section);
    if (inSection.length === 0) continue;
    console.log(`PHASE 3 — ${section}\n`);
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
      "  VERDICT: NOT VERIFIED — the confidential suite did not run, so nothing about the curve\n" +
        "  engine's confidentiality path was checked by this invocation. The other gates passed;\n" +
        "  they are necessary and nowhere near sufficient.\n",
    );
    process.exitCode = 1;
    return;
  }
  if (skipped > 0) {
    console.log(
      "  VERDICT: CONDITIONAL PASS — every executable gate passed. The skipped gates above need\n" +
        "  an environment or a balance this run did not have, and each names the exact command.\n",
    );
    return;
  }
  console.log("  VERDICT: PASS — every gate executed and passed.\n");
}

main();
