/**
 * `pnpm verify:phase4` — every Phase 4 gate, in one command, with an honest summary.
 *
 * THE RULE THIS FILE ENFORCES, unchanged since Phase 2: a gate that reports PASS for something it
 * did not run is worse than no gate at all. Anything that cannot execute here is reported as
 * SKIPPED, with the exact reason and the exact command that would run it, and is never folded into
 * the pass count.
 *
 * Phase 4 adds a second rule, because Phase 4 found something. A gate that reports PASS while a
 * KNOWN protocol limit makes the launch-scale epoch unexecutable would be worth less than nothing.
 * `verify:gas-cap` is in this gate specifically so that finding cannot be quietly carried — see
 * delta S-2. It is expected to FAIL until the curve layer's stage widths are re-tuned, and that
 * failure is the point.
 */

import { existsSync } from "node:fs";

import { readJson, repoPath, run } from "../lib/shell.js";

type Status = "PASS" | "FAIL" | "SKIP";
type Section =
  | "LOCKS AND BOUNDARIES"
  | "SETTLEMENT"
  | "CONFIDENTIAL SETTLEMENT"
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
const SUITE_LOG = repoPath("evidence/phase4/settlement-suite.log");

const GATES: readonly Gate[] = [
  {
    /**
     * FIRST, and displayed under quality. Later gates legitimately rewrite evidence files, so a
     * clean-tree check that ran after them would fail on the gate's own output and would have to be
     * weakened until it stopped meaning anything.
     */
    section: "QUALITY AND SECURITY",
    name: "Git identity and a clean working tree",
    execute: () => {
      const name = run("git", ["config", "user.name"]).stdout.trim();
      const email = run("git", ["config", "user.email"]).stdout.trim();
      if (name !== "winsznx") throw new Error(`git user.name is "${name}", expected winsznx`);
      const trailers = run("bash", [
        "-c",
        "git log --format=%B phase/03-curve-engine..HEAD | grep -ci 'Co-Authored-By' || true",
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
    name: "vendored Midnight unmodified",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/vendor.ts"]).stdout, 2),
  },
  {
    section: "LOCKS AND BOUNDARIES",
    name: "Nox import boundary (only @kyrve/nox may reach iExec)",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/import-boundary.ts"]).stdout, 1),
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
    section: "LOCKS AND BOUNDARIES",
    name: "TypeScript across scripts/ (not covered by tsc --build)",
    execute: () => {
      run("pnpm", ["exec", "tsc", "-p", "scripts/tsconfig.json", "--noEmit"]);
      return "scripts/ typechecks clean";
    },
  },
  {
    section: "LOCKS AND BOUNDARIES",
    name: "settlement contracts compile (solc 0.8.34, osaka, via_ir)",
    execute: () => {
      run("forge", ["build"]);
      return "forge build clean at the substrate compiler settings";
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
     * The check whose absence let a 25,040-byte engine pass an entire suite. It now measures both
     * sides: the Hardhat-built confidential layer AND the Foundry-built settlement layer, because
     * `KyrveSeriesFactory` embeds a whole vault in its creation code.
     */
    section: "LOCKS AND BOUNDARIES",
    name: "every deployable contract fits EIP-170",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/contract-size.ts"]).stdout, 2),
  },
  {
    /**
     * The settlement layer calls the confidential layer across a compiler boundary, declaring the
     * five entry points rather than importing them. A field reordered on either side would encode
     * cleanly, decode cleanly, and deliver one number where another was meant.
     */
    section: "LOCKS AND BOUNDARIES",
    name: "ICurveLayer matches the compiled confidential layer",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/curve-abi.ts"]).stdout, 1),
  },

  // ── Settlement, against real unmodified Midnight ───────────────────────────────────────────
  {
    section: "SETTLEMENT",
    name: "Foundry suite: exact fill, rollback, replay, cancellation, expiry, hostile tokens",
    execute: () => {
      const output = run("forge", ["test"]).stdout;
      if (/[1-9][0-9]* failed/.test(output)) throw new Error(summarise(output, 2));
      return summarise(output, 1);
    },
  },
  {
    section: "SETTLEMENT",
    name: "quote-id and offer binding agree with the Solidity, case by case",
    execute: () => summarise(run("pnpm", ["exec", "vitest", "run"]).stdout, 3),
  },
  {
    section: "SETTLEMENT",
    name: "generated artifacts are byte-identical on regeneration",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/generated.ts"]).stdout, 2),
  },
  {
    section: "SETTLEMENT",
    name: "settlement layer deployed, bound and wired locally",
    skipIf: () =>
      existsSync(repoPath("deployments/local/settlement.json"))
        ? null
        : "no local settlement deployment recorded. Deploy with: pnpm deploy:settlement local " +
          "(needs a local node with the Phase 2 and Phase 3 layers already on it)",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/settlement.ts", "local"]).stdout, 2),
  },

  // ── The confidential settlement path ──────────────────────────────────────────────────────
  {
    /**
     * The one that matters most, and the one most likely to be skipped.
     *
     * It brings up the real KMS, gateway, ingestor and runner in Docker, deploys real unmodified
     * Midnight from the Foundry artifacts onto the same chain, runs real confidential epochs, and
     * settles one of them. A stub stands in for nothing here.
     */
    section: "CONFIDENTIAL SETTLEMENT",
    name: "17 demonstrations: a real epoch settles once through real Midnight",
    skipIf: () =>
      dockerAvailable()
        ? null
        : "Docker is not running. The Nox stack cannot start, so NOTHING about the confidential " +
          "settlement path is verified by this run. Start Docker and re-run: " +
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
  {
    section: "CONFIDENTIAL SETTLEMENT",
    name: "the local chain executes Osaka, like Sepolia (delta S-1)",
    skipIf: () => (dockerAvailable() ? null : "needs the Nox node, which needs Docker"),
    execute: () => {
      const output = run("bash", [
        "-c",
        "cd confidential && pnpm exec hardhat test test/09-osaka.ts 2>&1",
      ]).stdout;
      if (/failing/.test(output) && !/0 failing/.test(output)) {
        throw new Error(summarise(output, 3));
      }
      return "CLZ executes, and 2^24 gas is the per-transaction cap";
    },
  },
  {
    section: "CONFIDENTIAL SETTLEMENT",
    name: "measured settlement gas recorded, for the funding budget",
    skipIf: () =>
      existsSync(repoPath("evidence/phase4/settlement-gas.json"))
        ? null
        : "no measurement recorded; it is produced by the confidential suite above",
    execute: () => {
      const evidence = readJson<{ activateGas: number; takeGas: number; fundingGas: number }>(
        repoPath("evidence/phase4/settlement-gas.json"),
      );
      if (evidence.activateGas <= 0 || evidence.takeGas <= 0) {
        throw new Error("the recorded gas is not from a completed settlement");
      }
      return `activate ${evidence.activateGas}, take ${evidence.takeGas}, funding ${evidence.fundingGas}`;
    },
  },
  {
    section: "CONFIDENTIAL SETTLEMENT",
    name: "the local terminal activates and takes a quote, in a real Chromium",
    skipIf: () =>
      existsSync(repoPath("evidence/phase4/browser-flow.json"))
        ? null
        : "NOT BUILT. The terminal has no settlement panel yet, so there is no browser flow to " +
          "drive and no producer for this evidence. The settlement path itself is proven " +
          "headlessly and end to end in `confidential/test/90-quote-settlement.ts`; what is " +
          "missing is the interface over it. Tracked in docs/phase4/GATE.md as outstanding.",
    execute: () => {
      const evidence = readJson<{
        settled: boolean;
        offerHashMatched: boolean;
        plaintextOrigins: readonly string[];
      }>(repoPath("evidence/phase4/browser-flow.json"));
      if (!evidence.settled) throw new Error("the browser flow did not settle a quote");
      if (!evidence.offerHashMatched) {
        throw new Error("the offer the page showed did not hash to the one the registry stored");
      }
      return `settled in Chromium, offer hash matched, plaintext reached ${evidence.plaintextOrigins.length} origin(s)`;
    },
  },

  // ── Privacy, quality and security ─────────────────────────────────────────────────────────
  {
    section: "QUALITY AND SECURITY",
    name: "no private value in any file, log or code path",
    execute: () => {
      const args = ["exec", "tsx", "scripts/verify/privacy-scan.ts"];
      if (existsSync(SUITE_LOG)) args.push(SUITE_LOG);
      return summarise(run("pnpm", args).stdout, 3);
    },
  },
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
    name: "slither static analysis over contracts/kyrve",
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
    name: "gas side channel measured against the settlement path, and not overclaimed",
    skipIf: () =>
      existsSync(repoPath("evidence/phase4/gas-side-channel.json"))
        ? null
        : "NOT MEASURED against the settlement path. Phase 3's experiment covered the curve " +
          "engine's confidential branch and is recorded in evidence/phase3/gas-side-channel.json; " +
          "activation and settlement have not been measured, so NOTHING is claimed about their " +
          "gas distinguishability. Tracked in docs/phase4/GATE.md as outstanding.",
    execute: () => {
      const evidence = readJson<{
        verdict: { groupsSeparatedByGas: boolean; noiseFloorGas: number; claim: string };
      }>(repoPath("evidence/phase4/gas-side-channel.json"));
      if (evidence.verdict.groupsSeparatedByGas) {
        throw new Error("the two branches are separated by gas — a real side channel");
      }
      if (!evidence.verdict.claim.includes("does NOT establish")) {
        throw new Error("the recorded verdict no longer disclaims gas indistinguishability");
      }
      return `noise floor ${evidence.verdict.noiseFloorGas} gas, no separation, claim still disclaimed`;
    },
  },
  {
    /**
     * DELIBERATELY LAST IN THIS SECTION, AND EXPECTED TO FAIL.
     *
     * Osaka caps a single transaction at 2^24 gas. Phase 3 sized its stage widths against a
     * 24,000,000 ceiling measured on a pre-Osaka local node, and its peak stage transaction is
     * 20,300,000 — so the launch-scale epoch cannot execute on the chain Kyrve targets. Phase 4
     * found it by configuring the local node correctly.
     *
     * This gate exists so that finding cannot be carried quietly into Phase 5. Delta S-2.
     */
    section: "QUALITY AND SECURITY",
    name: "every measured stage transaction fits the Osaka 2^24 gas cap (delta S-2)",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/gas-cap.ts"]).stdout, 2),
  },

  // ── Sepolia ───────────────────────────────────────────────────────────────────────────────
  {
    section: "SEPOLIA",
    name: "funding budget priced against the live network, with a >=35% safety margin",
    skipIf: () =>
      existsSync(repoPath("evidence/phase4/funding-budget.json"))
        ? null
        : "not priced. Run: pnpm exec tsx scripts/test/sepolia-settlement-budget.ts",
    execute: () => {
      const ledger = readJson<{
        samples: readonly {
          estimatedGas: number;
          predictedCostWithMarginEth: string;
          deployerBalanceEth: string;
          funded: boolean;
          safetyMargin: number;
        }[];
      }>(repoPath("evidence/phase4/funding-budget.json"));
      const latest = ledger.samples[ledger.samples.length - 1];
      if (latest === undefined) throw new Error("the funding ledger has no samples");
      if (latest.safetyMargin < 0.35) {
        throw new Error(
          `the recorded safety margin is ${latest.safetyMargin}, below the 0.35 floor`,
        );
      }
      if (!latest.funded) {
        throw new Error(
          `NOT FUNDED — needs ${latest.predictedCostWithMarginEth} ETH, balance is ` +
            `${latest.deployerBalanceEth} ETH`,
        );
      }
      return `${latest.estimatedGas} gas, ${latest.predictedCostWithMarginEth} ETH needed, ${latest.deployerBalanceEth} held`;
    },
  },
  {
    section: "SEPOLIA",
    name: "settlement layer deployed, bound and wired on Sepolia",
    skipIf: () =>
      existsSync(repoPath("deployments/sepolia/settlement.json"))
        ? null
        : "no Sepolia settlement deployment recorded. Deploy with: DEPLOY_SEPOLIA=true " +
          "KYRVE_CONFIRM_BROADCAST=true pnpm deploy:settlement sepolia",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/settlement.ts", "sepolia"]).stdout, 2),
  },
  {
    section: "SEPOLIA",
    name: "Etherscan source verification",
    skipIf: () =>
      existsSync(repoPath("deployments/sepolia/settlement-etherscan.json"))
        ? null
        : "source not yet submitted. Run: pnpm verify:etherscan:settlement",
    execute: () => {
      const record = readJson<{ verified: number; total: number }>(
        repoPath("deployments/sepolia/settlement-etherscan.json"),
      );
      if (record.verified !== record.total) {
        throw new Error(`${record.verified}/${record.total} contracts verified`);
      }
      return `${record.verified}/${record.total} contracts verified on Etherscan V2`;
    },
  },
  {
    /**
     * A SKIP rather than a silent omission. Running the flow on a public network is affordable
     * arithmetic priced by the budget gate above, not a technical unknown — and reporting it as
     * anything other than "not run, here is what it costs" would be claiming a result nobody
     * produced.
     */
    section: "SEPOLIA",
    name: "one real epoch, activation and settlement executed on Sepolia",
    skipIf: () =>
      existsSync(repoPath("evidence/phase4/sepolia-settlement.json"))
        ? null
        : "NOT RUN. It needs the settlement layer deployed on Sepolia and the funding budget above " +
          "reporting FUNDED. Every step is proven against the real Nox stack and real unmodified " +
          "Midnight locally, on one chain, in `confidential/test/90-quote-settlement.ts`.",
    execute: () => {
      const evidence = readJson<{
        quoteId: string;
        settled: boolean;
        replayRejected: boolean;
        partialFillRejected: boolean;
        creditUnits: string;
        debtUnits: string;
      }>(repoPath("evidence/phase4/sepolia-settlement.json"));
      if (!evidence.settled) throw new Error("the Sepolia flow did not settle");
      if (!evidence.partialFillRejected) throw new Error("the partial fill was not rejected");
      if (!evidence.replayRejected) throw new Error("the replay was not rejected");
      if (evidence.creditUnits !== evidence.debtUnits) {
        throw new Error(
          `vault credit ${evidence.creditUnits} does not equal borrower debt ${evidence.debtUnits}`,
        );
      }
      return `quote ${evidence.quoteId.slice(0, 10)}…, ${evidence.creditUnits} units of credit and debt`;
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

  const width = Math.min(66, Math.max(...results.map((result) => result.name.length)));
  console.log("\nKyrve Phase 4 gate — quote activation and Midnight settlement\n");

  const sections: Section[] = [
    "LOCKS AND BOUNDARIES",
    "SETTLEMENT",
    "CONFIDENTIAL SETTLEMENT",
    "QUALITY AND SECURITY",
    "SEPOLIA",
  ];
  for (const section of sections) {
    const inSection = results.filter((result) => result.section === section);
    if (inSection.length === 0) continue;
    console.log(`PHASE 4 — ${section}\n`);
    for (const result of inSection) {
      console.log(`  ${result.status.padEnd(4)}  ${result.name.padEnd(width)}  ${result.detail}`);
    }
    console.log("");
  }

  const passed = results.filter((result) => result.status === "PASS").length;
  const failed = results.filter((result) => result.status === "FAIL").length;
  const skipped = results.filter((result) => result.status === "SKIP").length;
  const noxSkipped = results.some(
    (result) => result.status === "SKIP" && result.name.startsWith("17 demonstrations"),
  );

  console.log(`\n  ${passed} passed, ${failed} failed, ${skipped} skipped\n`);

  if (failed > 0) {
    console.log("  VERDICT: FAIL — a gate did not pass.\n");
    process.exitCode = 1;
    return;
  }
  if (noxSkipped) {
    console.log(
      "  VERDICT: NOT VERIFIED — the confidential settlement suite did not run, so nothing about\n" +
        "  a real epoch reaching real Midnight was checked by this invocation. The other gates\n" +
        "  passed; they are necessary and nowhere near sufficient.\n",
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
