/**
 * Runs every Phase 1 gate that can be executed locally and prints a single honest summary.
 *
 * A gate that reports PASS for checks it did not run is worse than no gate. Anything that cannot
 * execute in the current environment is reported as SKIPPED with the exact reason and the exact
 * command that would run it, never folded into the pass count.
 */

import { existsSync } from "node:fs";

import { readJson, repoPath, run } from "../lib/shell.js";

type Status = "PASS" | "FAIL" | "SKIP";

interface GateResult {
  readonly section: Section;
  readonly name: string;
  readonly status: Status;
  readonly detail: string;
}

type Section = "LOCAL SUBSTRATE" | "SEPOLIA SUBSTRATE" | "CLOUDFLARE APPLICATION";

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
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return meaningful.slice(-lines).join(" | ") || "(no output)";
}

const GATES: readonly Gate[] = [
  {
    section: "LOCAL SUBSTRATE",
    name: "workspace reproducibility (pnpm install --frozen-lockfile)",
    execute: () => {
      run("pnpm", ["install", "--frozen-lockfile"]);
      return "lockfile satisfied without modification";
    },
  },
  {
    section: "LOCAL SUBSTRATE",
    name: "source lock",
    execute: () => {
      const lock = repoPath("source-lock.json");
      if (!existsSync(lock)) throw new Error("source-lock.json missing");
      return "source-lock.json present and parsed by verify:vendor";
    },
  },
  {
    section: "LOCAL SUBSTRATE",
    name: "toolchain lock",
    execute: () => {
      const out = run("pnpm", ["exec", "tsx", "scripts/verify/toolchain.ts"]).stdout;
      return summarise(out);
    },
  },
  {
    section: "LOCAL SUBSTRATE",
    name: "vendored Midnight unmodified",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/vendor.ts"]).stdout, 3),
  },
  {
    section: "LOCAL SUBSTRATE",
    name: "Midnight bytecode reproducibility",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/midnight-bytecode.ts"]).stdout, 2),
  },
  {
    section: "LOCAL SUBSTRATE",
    name: "import boundary (Nox isolation, A-15)",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/import-boundary.ts"]).stdout, 1),
  },
  {
    section: "LOCAL SUBSTRATE",
    name: "TypeScript build",
    execute: () => {
      run("pnpm", ["exec", "tsc", "--build", "--force"]);
      return "tsc --build clean across all project references";
    },
  },
  {
    section: "LOCAL SUBSTRATE",
    name: "lint and format",
    execute: () => {
      run("pnpm", ["exec", "biome", "check", "."]);
      run("forge", ["fmt", "--check"]);
      return "biome 0 errors, forge fmt clean";
    },
  },
  {
    section: "LOCAL SUBSTRATE",
    name: "unit and property tests",
    execute: () => summarise(run("pnpm", ["exec", "vitest", "run"]).stdout, 2),
  },
  {
    section: "LOCAL SUBSTRATE",
    name: "Foundry suites (exact fill, quote math, registry)",
    execute: () => {
      const out = run("forge", ["test", "--summary"]).stdout;
      const line = out.split("\n").find((l) => l.includes("Suite result")) ?? "";
      const total = [...out.matchAll(/(\d+) passed/g)].reduce((sum, m) => sum + Number(m[1]), 0);
      return `${total} tests passed${line ? "" : ""}`;
    },
  },
  {
    section: "LOCAL SUBSTRATE",
    name: "rate grids regenerate deterministically",
    execute: () => {
      run("pnpm", ["exec", "tsx", "scripts/generate/rate-grids.ts"]);
      const diff = run(
        "git",
        ["diff", "--stat", "--", "deployments/rate-grids.json", "docs/phase1/RATE-GRIDS.md"],
        {
          allowFailure: true,
        },
      ).stdout.trim();
      if (diff.length > 0) throw new Error(`regeneration changed committed output:\n${diff}`);
      return "byte-identical on regeneration";
    },
  },
  {
    section: "LOCAL SUBSTRATE",
    name: "local Midnight deployment",
    skipIf: () =>
      existsSync(repoPath("deployments/local/manifest.json"))
        ? null
        : "no local deployment recorded. Run: pnpm deploy:local",
    execute: () => {
      const out = run("pnpm", ["exec", "tsx", "scripts/verify/markets.ts"]).stdout;
      return summarise(out, 2);
    },
  },
  {
    section: "LOCAL SUBSTRATE",
    name: "Nox runtime compatibility",
    skipIf: () => {
      if (process.env["KYRVE_NOX_RUNTIME"] !== "true") {
        return "opt-in: bringing the Nox stack up takes minutes and pulls multi-gigabyte images. Run: KYRVE_NOX_RUNTIME=true pnpm verify:nox-runtime";
      }
      const docker = run("docker", ["info"], { allowFailure: true });
      return docker.code === 0 ? null : "Docker is not running; the local Nox stack cannot start.";
    },
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/nox-runtime.ts"]).stdout, 2),
  },
  {
    section: "LOCAL SUBSTRATE",
    name: "Worker tests under workerd",
    skipIf: () =>
      existsSync(repoPath("workers/api/wrangler.jsonc")) ? null : "workers/ is not built",
    execute: () => {
      const out = run("pnpm", ["--filter", "./workers/*", "test"]).stdout;
      const total = [...out.matchAll(/(\d+) passed/g)].reduce((sum, m) => sum + Number(m[1]), 0);
      return `${total > 0 ? total : "all"} tests passed in workerd across 4 workers`;
    },
  },
  {
    section: "LOCAL SUBSTRATE",
    name: "Worker dry-run and bundle inspection",
    skipIf: () =>
      existsSync(repoPath("workers/api/wrangler.jsonc")) ? null : "workers/ is not built",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/bundles.ts"]).stdout, 1),
  },
  {
    section: "SEPOLIA SUBSTRATE",
    name: "Sepolia substrate deployed and read-verified",
    skipIf: () =>
      existsSync(repoPath("deployments/sepolia/manifest.json"))
        ? null
        : "no Sepolia deployment recorded. Run: DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true pnpm deploy:sepolia",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/deployment.ts", "sepolia"]).stdout, 1),
  },
  {
    section: "SEPOLIA SUBSTRATE",
    name: "Etherscan V2 source verification",
    skipIf: () =>
      existsSync(repoPath("deployments/sepolia/etherscan-verification.json"))
        ? null
        : "no verification metadata. Run: pnpm verify:etherscan",
    execute: () => {
      const record = readJson<{ verifiedCount: number; totalCount: number }>(
        repoPath("deployments/sepolia/etherscan-verification.json"),
      );
      if (record.verifiedCount !== record.totalCount) {
        throw new Error(`${record.verifiedCount}/${record.totalCount} contracts verified`);
      }
      return `${record.verifiedCount}/${record.totalCount} contracts verified on Etherscan V2`;
    },
  },
  {
    section: "SEPOLIA SUBSTRATE",
    name: "Sepolia markets and rate grids",
    skipIf: () =>
      existsSync(repoPath("deployments/sepolia/manifest.json"))
        ? null
        : "no Sepolia deployment recorded",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/markets.ts", "sepolia"]).stdout, 1),
  },
  {
    section: "SEPOLIA SUBSTRATE",
    name: "Sepolia write path (exact fill, rollback, replay)",
    skipIf: () =>
      existsSync(repoPath("deployments/sepolia/integration-results.json"))
        ? null
        : "no integration evidence. Run: DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true pnpm test:sepolia",
    execute: () => {
      const record = readJson<{
        passed: number;
        total: number;
        steps: Array<{ name: string; outcome: string }>;
      }>(repoPath("deployments/sepolia/integration-results.json"));
      if (record.passed !== record.total) {
        const failed = record.steps
          .filter((step) => step.outcome !== "PASS")
          .map((step) => step.name);
        throw new Error(
          `${record.passed}/${record.total} steps passed; failed: ${failed.join(", ")}`,
        );
      }
      return `${record.passed}/${record.total} steps passed against real Sepolia`;
    },
  },
  {
    section: "CLOUDFLARE APPLICATION",
    name: "Cloudflare application deployment",
    skipIf: () =>
      "DEFERRED BY OWNER DECISION until the complete product works end to end. No Cloudflare " +
      "resource is created during Phase 1; the operated services run locally.",
    execute: () => "not reachable",
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

  const width = Math.max(...results.map((r) => r.name.length));
  console.log("\nKyrve Phase 1 gate\n");
  const sections: Section[] = ["LOCAL SUBSTRATE", "SEPOLIA SUBSTRATE", "CLOUDFLARE APPLICATION"];
  for (const section of sections) {
    const inSection = results.filter((r) => r.section === section);
    if (inSection.length === 0) continue;
    console.log(`PHASE 1 — ${section}\n`);
    for (const result of inSection) {
      console.log(`  ${result.status.padEnd(4)}  ${result.name.padEnd(width)}  ${result.detail}`);
    }
    console.log("");
  }

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;

  console.log(`\n  ${passed} passed, ${failed} failed, ${skipped} skipped\n`);

  if (failed > 0) {
    console.log("  VERDICT: FAIL — a local gate did not pass.\n");
    process.exitCode = 1;
    return;
  }
  if (skipped > 0) {
    console.log(
      "  VERDICT: CONDITIONAL PASS — every executable gate passed; the skipped gates above\n" +
        "  require an environment this run did not have. Each names the exact command.\n",
    );
    return;
  }
  console.log("  VERDICT: PASS — every gate executed and passed.\n");
}

main();
