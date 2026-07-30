/**
 * `pnpm verify:phase5` — every Phase 5 gate, in one command, with an honest summary.
 *
 * THE RULE THIS FILE ENFORCES, unchanged since Phase 2: a gate that reports PASS for something it did
 * not run is worse than no gate at all. Anything that cannot execute here is reported as SKIPPED, with
 * the exact reason and the exact command that would run it, and is never folded into the pass count.
 *
 * Phase 5's own addition is the one below it. **The P5-1 decision is a gate.** It is the first entry
 * and it checks that the decision document exists, names a chosen option and a rejected one, carries a
 * threat model and a migration impact, and that the contract it decided on is actually the one in the
 * tree. A phase whose gating architectural decision could be reported as "passed" by a run that never
 * looked at it would be a phase that had learned nothing from P4-2 sitting open for two phases.
 */

import { existsSync, readFileSync } from "node:fs";

import { readJson, repoPath, run } from "../lib/shell.js";

type Status = "PASS" | "FAIL" | "SKIP";
type Section =
  | "THE P5-1 DECISION"
  | "LOCKS AND BOUNDARIES"
  | "SERIES ACCOUNTING"
  | "CONFIDENTIAL OWNERSHIP"
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

/** The captured Phase 5 suite output, so the privacy scan can search it for real values. */
const SUITE_LOG = repoPath("evidence/phase5/series-suite.log");

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
        "git log --format=%B phase/04-quote-settlement..HEAD | grep -ci 'Co-Authored-By' || true",
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

  // ── The P5-1 decision ─────────────────────────────────────────────────────────────────────
  {
    section: "THE P5-1 DECISION",
    name: "decided, with the rejected option, a threat model and a migration impact",
    execute: () => {
      const path = repoPath("docs/phase5/P5-1-DECISION.md");
      if (!existsSync(path)) throw new Error("docs/phase5/P5-1-DECISION.md does not exist");
      const text = readFileSync(path, "utf8");

      const required: readonly [string, RegExp][] = [
        ["a decided status", /Status:\s*DECIDED/],
        ["the chosen option", /Option A — handle-native vault revision/],
        ["the rejected option named", /Rejected:\s*Option B/],
        ["a threat model", /## 5\. Threat model/],
        ["a migration impact", /## 6\. Migration impact/],
        ["the eleven criteria scored", /### Scorecard/],
        ["the deployed vault's reserver measured", /reserver\(\)\(address\)/],
      ];
      const missing = required.filter(([, pattern]) => !pattern.test(text)).map(([what]) => what);
      if (missing.length > 0) {
        throw new Error(`the decision document is missing: ${missing.join(", ")}`);
      }

      // Every criterion the brief demanded, present by name. A decision that skipped one and read
      // well would otherwise pass.
      const criteria = [
        "provider custody",
        "permanent ACL risk",
        "deterministic handle aliasing",
        "replay protection",
        "cancellation and recovery",
        "atomic settlement funding",
        "solvency proof",
        "upgrade risk",
        "gas",
        "Nox API reality",
        "Sepolia feasibility",
      ];
      const absent = criteria.filter(
        (criterion) => !text.toLowerCase().includes(criterion.toLowerCase()),
      );
      if (absent.length > 0) throw new Error(`criteria not evaluated: ${absent.join(", ")}`);

      return `Option A decided over Option B on ${criteria.length} criteria, threat model and migration recorded`;
    },
  },
  {
    section: "THE P5-1 DECISION",
    name: "the decision is implemented — a handle-native lock exists and has one subtraction",
    execute: () => {
      const custody = readFileSync(
        repoPath("confidential/contracts/KyrveCustodyVault.sol"),
        "utf8",
      );
      const ledger = readFileSync(repoPath("confidential/contracts/ReservationLedger.sol"), "utf8");

      if (
        !/function lockAllocation\(\s*bytes32 epochId,\s*address provider,\s*euint256 amount/.test(
          custody,
        )
      ) {
        throw new Error(
          "KyrveCustodyVault has no handle-native lockAllocation(bytes32, address, euint256, ebool)",
        );
      }
      if (
        /externalEuint256 encryptedAmount, bytes calldata inputProof\s*\)\s*external onlyReserver/.test(
          custody,
        )
      ) {
        throw new Error(
          "the lock still takes an external input proof, which a curve allocation cannot have",
        );
      }

      // ONE subtraction, and it is in custody. Phase 3's ledger had its own, and that is precisely how
      // `sum(reserved)` and the capital that can pay became two independent quantities (delta S-6).
      const custodySubs = (custody.match(/Nox\.safeSub\(/g) ?? []).length;
      const ledgerSubs = (ledger.match(/Nox\.safeSub\(/g) ?? []).length;
      if (ledgerSubs !== 0) {
        throw new Error(
          `ReservationLedger performs ${ledgerSubs} safeSub call(s); Phase 5 moved the subtraction into custody`,
        );
      }
      if (custodySubs === 0) throw new Error("KyrveCustodyVault performs no safeSub at all");

      // The lock is pausable as an entry; release and restore must have no flag at all.
      for (const [fn, body] of [
        ["releaseLock", custody.slice(custody.indexOf("function releaseLock"))],
        ["restoreLock", custody.slice(custody.indexOf("function restoreLock"))],
      ] as const) {
        const scope = body.slice(0, body.indexOf("\n    }"));
        if (/requireNotPaused/.test(scope)) {
          throw new Error(
            `${fn} consults the emergency controller; recovery must never be pausable`,
          );
        }
      }

      return `handle-native lock present, ${custodySubs} subtraction(s) in custody and 0 in the ledger, recovery unpausable`;
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
    name: "unique Solidity basenames",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/solidity-basenames.ts"]).stdout, 1),
  },
  {
    section: "LOCKS AND BOUNDARIES",
    name: "every deployable contract inside EIP-170",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/contract-size.ts"]).stdout, 2),
  },
  {
    section: "LOCKS AND BOUNDARIES",
    name: "no stage exceeds the Osaka 2^24 single-transaction cap",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/gas-cap.ts"]).stdout, 2),
  },
  {
    section: "LOCKS AND BOUNDARIES",
    name: "ICurveLayer still matches the compiled confidential layer",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/curve-abi.ts"]).stdout, 1),
  },
  {
    section: "LOCKS AND BOUNDARIES",
    name: "ISettlementLayer matches the compiled settlement layer",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/settlement-abi.ts"]).stdout, 1),
  },
  {
    section: "LOCKS AND BOUNDARIES",
    name: "every verify:* and deploy script typechecks",
    execute: () => {
      run("pnpm", ["typecheck:scripts"]);
      return "scripts/tsconfig.json clean";
    },
  },

  // ── Series accounting ─────────────────────────────────────────────────────────────────────
  {
    section: "SERIES ACCOUNTING",
    name: "contracts compile at both pins (0.8.34 Foundry, 0.8.36 confidential)",
    execute: () => {
      run("forge", ["build"]);
      run("pnpm", ["--dir", "confidential", "exec", "hardhat", "compile"]);
      return "forge build and hardhat compile both clean";
    },
  },
  {
    section: "SERIES ACCOUNTING",
    name: "Foundry suite (settlement, exact fill, quote math)",
    execute: () => {
      const output = run("forge", ["test"]).stdout;
      const failed = output.match(/(\d+) failed/g) ?? [];
      if (failed.some((match) => !match.startsWith("0 "))) {
        throw new Error(`forge test reported failures: ${failed.join(", ")}`);
      }
      return summarise(output, 1);
    },
  },
  {
    section: "SERIES ACCOUNTING",
    name: "the measured fixture: supply is the aggregate, and the two residues stay apart",
    execute: () => {
      run("pnpm", ["exec", "vitest", "run", "packages/quote/test/series-accounting.test.ts"]);
      return "300,000,000 capacity / 299,999,999 supply / 300,000,599 units / 299,999,998 assets, all distinct";
    },
  },
  {
    section: "SERIES ACCOUNTING",
    name: "unit suites (quote math, curve constants, worker core)",
    execute: () => summarise(run("pnpm", ["test:unit"]).stdout, 3),
  },

  // ── Confidential ownership ────────────────────────────────────────────────────────────────
  {
    section: "CONFIDENTIAL OWNERSHIP",
    name: "12 demonstrations + 8 attacks against the real Nox stack and real Midnight",
    skipIf: () =>
      dockerAvailable()
        ? null
        : "Docker is not reachable, so the real Nox stack cannot start. Run: " +
          "pnpm --dir confidential exec hardhat test test/100-series-ownership.ts test/102-series-attacks.ts",
    execute: () => {
      const output = run("bash", [
        "-c",
        "cd confidential && pnpm exec hardhat test test/09-osaka.ts test/100-series-ownership.ts " +
          `test/102-series-attacks.ts 2>&1 | tee '${SUITE_LOG}'`,
      ]).stdout;
      if (/\bfailing\b/.test(output) && !/0 failing/.test(output)) {
        const line = output.split("\n").find((candidate) => /failing/.test(candidate)) ?? "";
        throw new Error(`the confidential series suite reported failures: ${line.trim()}`);
      }
      const passing = output.match(/(\d+) passing/g) ?? [];
      return passing.join(" | ") || summarise(output, 2);
    },
  },
  {
    section: "CONFIDENTIAL OWNERSHIP",
    name: "no decrypted value reached a log, an evidence file or a manifest",
    skipIf: () =>
      existsSync(SUITE_LOG)
        ? null
        : "the confidential suite has not run in this working tree, so there is no captured output " +
          "to scan. The scan is only meaningful against real decrypted values.",
    execute: () => summarise(run("pnpm", ["verify:privacy-scan"]).stdout, 2),
  },
  {
    /**
     * AN EXECUTING GATE, not a record reader.
     *
     * The evidence file is written by the demonstration itself, so a gate that only read it would
     * pass on a stale file from a build that no longer exists. This runs the demonstration and then
     * reads what that run wrote.
     */
    section: "CONFIDENTIAL OWNERSHIP",
    name: "the ownership view renders in real Chromium, and refuses a peer",
    skipIf: () =>
      dockerAvailable()
        ? null
        : "Docker is not reachable, so the real Nox stack cannot start. Run: " +
          "pnpm --dir confidential exec hardhat test test/101-series-browser.ts",
    execute: () => {
      const output = run("bash", [
        "-c",
        "cd confidential && pnpm exec hardhat test test/101-series-browser.ts",
      ]).stdout;
      if (/\bfailing\b/.test(output) && !/0 failing/.test(output)) {
        const line = output.split("\n").find((candidate) => /failing/.test(candidate)) ?? "";
        throw new Error(`the browser demonstration reported failures: ${line.trim()}`);
      }
      const evidence = readJson<{
        decryptedInBrowser: boolean;
        outsiderRefused: boolean;
        supplyMatchesAggregate: boolean;
        providerCount: number;
        refusalKind?: string;
        solvency?: string;
      }>(repoPath("evidence/phase5/browser-ownership.json"));
      if (!evidence.decryptedInBrowser)
        throw new Error("the browser did not decrypt a series balance");
      if (!evidence.outsiderRefused) throw new Error("the browser did not refuse an outsider");
      if (!evidence.supplyMatchesAggregate) {
        throw new Error("the browser's supply reading did not match the published aggregate");
      }
      if (evidence.refusalKind !== "not-authorised") {
        throw new Error(
          `the peer refusal was "${evidence.refusalKind}", not "not-authorised" — a refusal for the ` +
            "wrong reason proves the wrong thing",
        );
      }
      if (evidence.solvency !== "verified solvent") {
        throw new Error(`the browser read solvency as "${evidence.solvency}"`);
      }
      return (
        `${evidence.providerCount} provider balances decrypted in Chromium, peer refused ` +
        `${evidence.refusalKind}, supply == aggregate, ${evidence.solvency}`
      );
    },
  },

  // ── Quality and security ──────────────────────────────────────────────────────────────────
  {
    section: "QUALITY AND SECURITY",
    name: "formatting and lint (biome, forge fmt)",
    execute: () => {
      run("pnpm", ["lint:ts"]);
      run("forge", ["fmt", "--check"]);
      return "biome and forge fmt clean";
    },
  },
  {
    section: "QUALITY AND SECURITY",
    name: "no secrets, no forbidden licence claims",
    execute: () => {
      run("pnpm", ["exec", "tsx", "scripts/verify/secrets.ts"]);
      return summarise(run("pnpm", ["exec", "tsx", "scripts/verify/licence.ts"]).stdout, 2);
    },
  },
  {
    section: "QUALITY AND SECURITY",
    name: "every Kyrve contract on chain matches the current build",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/deployed-bytecode.ts"]).stdout, 2),
  },
  {
    /**
     * Regenerates every generated path and fails if a single byte moved.
     *
     * Delta R-13's shape: a generated file edited by hand, or left stale after a source change, makes
     * the repository stop describing what it builds — and the ABI generator has silently dropped
     * embedded deployment bindings before (commit ceb2de9).
     */
    section: "QUALITY AND SECURITY",
    name: "generated files are byte-identical after regeneration",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/generated.ts"]).stdout, 1),
  },
  {
    section: "QUALITY AND SECURITY",
    name: "static analysis (slither)",
    skipIf: () => {
      try {
        run("slither", ["--version"], { allowFailure: true });
        return null;
      } catch {
        return "slither is not installed. Run: pipx install slither-analyzer, then pnpm verify:slither";
      }
    },
    execute: () => summarise(run("pnpm", ["verify:slither"]).stdout, 3),
  },
  {
    section: "QUALITY AND SECURITY",
    name: "no unresolved High or Medium security finding",
    execute: () => {
      const path = repoPath("docs/phase5/SECURITY.md");
      if (!existsSync(path)) throw new Error("docs/phase5/SECURITY.md does not exist");
      const text = readFileSync(path, "utf8");

      // The register must state a disposition for every severity it lists. An OPEN High or Medium is a
      // gate failure by definition; the check reads the register rather than trusting a summary line.
      const open = [...text.matchAll(/^\|\s*(F-\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|/gm)].filter(
        (row) => /high|medium/i.test(row[2] ?? "") && /open/i.test(row[3] ?? ""),
      );
      if (open.length > 0) {
        throw new Error(
          `unresolved High/Medium finding(s): ${open.map((row) => row[1]).join(", ")}`,
        );
      }
      const counted = [...text.matchAll(/^\|\s*F-\d+\s*\|/gm)].length;
      if (counted === 0) throw new Error("the security register lists no findings at all");
      return `${counted} finding(s) recorded, none High or Medium and still open`;
    },
  },

  // ── Sepolia ───────────────────────────────────────────────────────────────────────────────
  {
    /**
     * THE FUNDING PREFLIGHT IS A GATE, AND IT RUNS.
     *
     * It is not a SKIP: the measurement executes against the live network every time, prices the whole
     * sequence from real `eth_estimateGas` calls and real measured transaction gas, and appends the
     * prediction to an append-only ledger. What it reports is a fact about the balance, not an
     * environment that was unavailable.
     *
     * An under-funded result therefore FAILS rather than skipping. The brief is explicit: report the
     * required balance, report the shortfall, stop before broadcasting, and do not downgrade the gate
     * to PASS. A SKIP would read as "not attempted", and it was attempted and answered.
     */
    section: "SEPOLIA",
    name: "the whole sequence is priced against the live network, and the balance covers it",
    skipIf: () =>
      existsSync(repoPath(".env"))
        ? null
        : "no .env, so there is no RPC and no deployer to price against",
    execute: () => {
      const result = run("pnpm", ["exec", "tsx", "scripts/test/sepolia-series-budget.ts"], {
        allowFailure: true,
      });
      const ledger = readJson<{
        samples: readonly {
          estimatedGas: number;
          predictedCostWithMarginEth: string;
          deployerBalanceEth: string;
          shortfallEth: string;
          funded: boolean;
          safetyMargin: number;
        }[];
      }>(repoPath("evidence/phase5/funding-budget.json"));
      const latest = ledger.samples.at(-1);
      if (latest === undefined) throw new Error("the funding ledger recorded no sample");

      if (!latest.funded) {
        throw new Error(
          `NOT FUNDED — ${latest.estimatedGas.toLocaleString("en-GB")} gas needs ` +
            `${latest.predictedCostWithMarginEth} ETH at a ${Math.round(latest.safetyMargin * 100)}% margin; ` +
            `balance is ${latest.deployerBalanceEth} ETH, short by ${latest.shortfallEth} ETH`,
        );
      }
      if (result.code !== 0) {
        throw new Error("the preflight reported a problem other than funding; read its output");
      }
      return (
        `${latest.estimatedGas.toLocaleString("en-GB")} gas, ${latest.predictedCostWithMarginEth} ETH ` +
        `needed at ${Math.round(latest.safetyMargin * 100)}%, ${latest.deployerBalanceEth} held`
      );
    },
  },
  {
    section: "SEPOLIA",
    name: "series layer deployed, bound and wired on Sepolia",
    skipIf: () =>
      existsSync(repoPath("deployments/sepolia/series.json"))
        ? null
        : "no Sepolia series deployment recorded. Deploy with: DEPLOY_SEPOLIA=true " +
          "KYRVE_CONFIRM_BROADCAST=true pnpm deploy:series sepolia",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/series.ts", "sepolia"]).stdout, 2),
  },
  {
    section: "SEPOLIA",
    name: "Etherscan source verification",
    skipIf: () =>
      existsSync(repoPath("deployments/sepolia/series-etherscan.json"))
        ? null
        : "source not yet submitted. Run: pnpm verify:etherscan:series",
    execute: () => {
      const record = readJson<{ verified: number; total: number }>(
        repoPath("deployments/sepolia/series-etherscan.json"),
      );
      if (record.verified !== record.total) {
        throw new Error(`${record.verified}/${record.total} contracts verified`);
      }
      return `${record.verified}/${record.total} contracts verified on Etherscan V2`;
    },
  },
  {
    /**
     * THE SETTLEMENT THAT WAS FUNDED FROM CONFIDENTIAL CAPITAL.
     *
     * Phase 4 minted public USDC into the vault, deliberately and in the open (delta S-6). This gate is
     * the difference: the unwrap's plaintext must equal the epoch's published aggregate, which is
     * invariant 1 proven by a real ERC-20 transfer rather than by argument.
     */
    section: "SEPOLIA",
    name: "one exact fill settled on Sepolia, funded from confidential capital",
    skipIf: () =>
      existsSync(repoPath("evidence/phase5/sepolia-settlement.json"))
        ? null
        : "NOT RUN. Needs the Phase 5 deployment and a completed Sepolia epoch. Run: " +
          "KYRVE_SERIES_LAYER=true DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true " +
          "pnpm test:sepolia-settlement",
    execute: () => {
      const evidence = readJson<{
        settled: boolean;
        partialFillRejected: boolean;
        replayRejected: boolean;
        creditCreatedByThisFill: string;
        debtCreatedByThisFill: string;
        aggregateFillAmount: string;
        exactUnits: string;
      }>(repoPath("evidence/phase5/sepolia-settlement.json"));
      if (!evidence.settled) throw new Error("the Sepolia flow did not settle");
      if (!evidence.partialFillRejected) throw new Error("the partial fill was not rejected");
      if (!evidence.replayRejected) throw new Error("the replay was not rejected");
      // Credit and debt are cumulative positions; only the DELTA describes one fill. Delta S-8.
      if (evidence.creditCreatedByThisFill !== evidence.debtCreatedByThisFill) {
        throw new Error(
          `credit created ${evidence.creditCreatedByThisFill} does not equal debt created ` +
            `${evidence.debtCreatedByThisFill}`,
        );
      }
      if (evidence.creditCreatedByThisFill !== evidence.exactUnits) {
        throw new Error("the credit created is not the quote's exact units");
      }
      return (
        `${evidence.creditCreatedByThisFill} units of credit and debt from an aggregate of ` +
        `${evidence.aggregateFillAmount}, partial fill and replay both refused`
      );
    },
  },
  {
    /**
     * THE PHASE'S ONE IRREDUCIBLE CLAIM, on a public network.
     *
     * Every assertion here is read from the recorded run rather than restated: the supply, the three
     * quantities that must not coincide, the per-provider decryption, the peer refusals, the credit, the
     * solvency verdict and the duplicate refusal.
     */
    section: "SEPOLIA",
    name: "one real confidential series allocation executed on Sepolia",
    skipIf: () =>
      existsSync(repoPath("evidence/phase5/sepolia-allocation.json"))
        ? null
        : "NOT RUN. Needs the settled Sepolia position above. Run: DEPLOY_SEPOLIA=true " +
          "KYRVE_CONFIRM_BROADCAST=true pnpm test:sepolia-series-allocation",
    execute: () => {
      const evidence = readJson<{
        quoteId: string;
        allocated: boolean;
        closed: boolean;
        providerCount: number;
        allocatedCount: number;
        supply: string;
        aggregate: string;
        exactUnits: string;
        buyerAssets: string;
        creditUnits: string;
        residue: string;
        supplyEqualsAggregate: boolean;
        supplyIsNotUnits: boolean;
        supplyIsNotBuyerAssets: boolean;
        everyProviderMatchedTheirReservation: boolean;
        everyPeerRefused: boolean;
        solvent: boolean;
        publicCoverage: string;
        duplicateAllocationRefused: boolean;
      }>(repoPath("evidence/phase5/sepolia-allocation.json"));

      if (!evidence.allocated) throw new Error("the Sepolia allocation did not complete");
      if (!evidence.closed) throw new Error("the allocation was not sealed");
      if (evidence.allocatedCount !== evidence.providerCount) {
        throw new Error(
          `${evidence.allocatedCount} claims minted for ${evidence.providerCount} providers`,
        );
      }

      // INVARIANT 1, and the negative half of 2 and 3 beside it. All three quantities differ on this
      // fixture, so an implementation that conflated any pair fails here rather than passing by luck.
      if (!evidence.supplyEqualsAggregate || evidence.supply !== evidence.aggregate) {
        throw new Error(
          `confidential supply ${evidence.supply} does not equal the published aggregate ` +
            `${evidence.aggregate}`,
        );
      }
      if (!evidence.supplyIsNotUnits) throw new Error("supply equals the Midnight units");
      if (!evidence.supplyIsNotBuyerAssets) throw new Error("supply equals the borrower's assets");
      const distinct = new Set([evidence.supply, evidence.exactUnits, evidence.buyerAssets]);
      if (distinct.size !== 3) {
        throw new Error(
          "supply, units and buyer assets are not three distinct numbers on this run",
        );
      }

      // INVARIANTS 6 and 7: each provider read their own and nobody read another's.
      if (!evidence.everyProviderMatchedTheirReservation) {
        throw new Error("a provider's series balance did not equal the capital that funded it");
      }
      if (!evidence.everyPeerRefused) {
        throw new Error("a provider was NOT refused another provider's balance");
      }

      // INVARIANT 13, and the public credit the claims are on.
      if (!evidence.solvent) throw new Error("the published solvency verdict was not true");
      if (BigInt(evidence.publicCoverage) < BigInt(evidence.supply)) {
        throw new Error("public coverage does not cover the confidential claims");
      }
      if (BigInt(evidence.creditUnits) < BigInt(evidence.exactUnits)) {
        throw new Error("the vault does not hold the credit the claims are against");
      }

      if (!evidence.duplicateAllocationRefused) {
        throw new Error("a duplicate allocation was not refused");
      }

      return (
        `quote ${evidence.quoteId.slice(0, 10)}…, supply ${evidence.supply} == aggregate, ` +
        `units ${evidence.exactUnits}, assets ${evidence.buyerAssets}, credit ` +
        `${evidence.creditUnits}, residue ${evidence.residue}, ${evidence.providerCount}/` +
        `${evidence.providerCount} providers decrypted their own and were refused each other's, solvent`
      );
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
  console.log("\nKyrve Phase 5 gate — confidential series ownership\n");

  const sections: Section[] = [
    "THE P5-1 DECISION",
    "LOCKS AND BOUNDARIES",
    "SERIES ACCOUNTING",
    "CONFIDENTIAL OWNERSHIP",
    "QUALITY AND SECURITY",
    "SEPOLIA",
  ];
  for (const section of sections) {
    const inSection = results.filter((result) => result.section === section);
    if (inSection.length === 0) continue;
    console.log(`PHASE 5 — ${section}\n`);
    for (const result of inSection) {
      console.log(`  ${result.status.padEnd(4)}  ${result.name.padEnd(width)}  ${result.detail}`);
    }
    console.log("");
  }

  const passed = results.filter((result) => result.status === "PASS").length;
  const failed = results.filter((result) => result.status === "FAIL").length;
  const skipped = results.filter((result) => result.status === "SKIP").length;
  /**
   * A funding shortfall is a fact about a wallet, not a broken build — and it must still not be a
   * PASS. It gets its own verdict so the summary cannot be read either way round: nothing is
   * asserted to work that does not, and nothing is reported as broken that is not.
   */
  const fundingFailures = results.filter(
    (result) => result.status === "FAIL" && result.detail.startsWith("NOT FUNDED"),
  );
  const otherFailures = failed - fundingFailures.length;
  const ownershipSkipped = results.some(
    (result) =>
      result.status === "SKIP" &&
      result.section === "CONFIDENTIAL OWNERSHIP" &&
      /demonstrations/.test(result.name),
  );

  console.log(`\n  ${passed} passed, ${failed} failed, ${skipped} skipped\n`);

  if (otherFailures > 0) {
    console.log(`  VERDICT: FAIL — ${otherFailures} gate(s) did not pass.\n`);
    process.exitCode = 1;
    return;
  }
  if (fundingFailures.length > 0) {
    for (const failure of fundingFailures) console.log(`  ${failure.detail}\n`);
    console.log(
      "  VERDICT: NOT FUNDED — every other executable gate passed. The Sepolia sequence is priced\n" +
        "  against the live network and the deployer cannot cover it, so nothing was broadcast and\n" +
        "  nothing will be. This is not a PASS and must not be recorded as one; fund the deployer by\n" +
        "  the shortfall above and re-run.\n",
    );
    process.exitCode = 1;
    return;
  }
  if (ownershipSkipped) {
    console.log(
      "  VERDICT: NOT VERIFIED — the confidential ownership suite did not run, so nothing about a\n" +
        "  real lock becoming a real confidential claim was checked by this invocation. The other\n" +
        "  gates passed; they are necessary and nowhere near sufficient.\n",
    );
    process.exitCode = 1;
    return;
  }
  if (skipped > 0) {
    console.log(
      "  VERDICT: CONDITIONAL PASS — every executable gate passed. The skipped gates above need an\n" +
        "  environment or a balance this run did not have, and each names the exact command.\n",
    );
    return;
  }
  console.log("  VERDICT: PASS — every gate executed and passed.\n");
}

main();
