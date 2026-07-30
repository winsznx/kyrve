/**
 * `pnpm verify:phase6` — every Phase 6 gate, in one command, with an honest summary.
 *
 * THE RULE, unchanged since Phase 2: a gate that reports PASS for something it did not run is worse
 * than no gate at all. Anything that cannot execute here is SKIPPED with the exact reason and the
 * exact command that would run it, and is never folded into the pass count.
 *
 * Phase 6 adds two verdicts of its own, because two things about this phase cannot be squeezed into
 * pass/fail without lying:
 *
 *   UNVERIFIED BY SLITHER. crytic-compile cannot be made to drive solc 0.8.36 (delta U-5), so the
 *   confidential layer has no static-analysis coverage. That is not a PASS and it is not a FAIL —
 *   it is a known, reproduced gap with compensating evidence, and the gate names it every run so it
 *   cannot quietly become invisible.
 *
 *   MINIMAL ROLL. The Roll on Sepolia is one intent against one supply between two series. That is
 *   the whole claim. A gate that said "Roll: PASS" would read as production throughput, so the
 *   verdict says what was actually proven.
 */

import { existsSync, readFileSync } from "node:fs";

import { readJson, repoPath, run } from "../lib/shell.js";
import { requirePassingTally } from "../lib/tally.js";

type Status = "PASS" | "FAIL" | "SKIP";
type Section =
  | "ROLE SEPARATION"
  | "CAPSULE"
  | "CROSS"
  | "ROLL"
  | "KYRVE VERIFY"
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

/**
 * The node:test tally, read rather than echoed.
 *
 * This function used to return the tally as a DISPLAY STRING and let the gate report PASS beside it,
 * so a run printing `8 passing, 1 failing` was recorded as a passing gate. Phase 7 hit that and the
 * shared implementation now lives in `scripts/lib/tally.ts` with regression tests.
 *
 * NOTHING ABOUT PHASE 6's RECORDED EVIDENCE CHANGES. `docs/phase6/GATE.md` stands as written: this
 * repairs the instrument, and re-running a closed phase to see whether the repaired instrument still
 * agrees is a Phase 6 decision rather than a Phase 7 side effect. The exposure is recorded in
 * `docs/phase7/PRD-DELTA.md` W-1.
 */
function testTally(output: string): string {
  return requirePassingTally(output);
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

function noDocker(): string | null {
  return dockerAvailable()
    ? null
    : "Docker is not available, so the real Nox stack cannot boot. A mocked NoxCompute would be a " +
        "mocked confidentiality path and is forbidden.";
}

function noEnv(): string | null {
  return existsSync(repoPath(".env")) ? null : "no .env, so there is no RPC and no signer";
}

/** Reads a Sepolia evidence record, or explains precisely which run would produce it. */
function evidence<T>(file: string): T {
  return readJson<T>(repoPath(`evidence/phase6/${file}`));
}

const GATES: readonly Gate[] = [
  {
    /**
     * FIRST. Later gates legitimately rewrite evidence files, so a clean-tree check that ran after
     * them would fail on the gate's own output and would have to be weakened until it meant nothing.
     */
    section: "QUALITY AND SECURITY",
    name: "Git identity and a clean working tree",
    execute: () => {
      const name = run("git", ["config", "user.name"]).stdout.trim();
      const email = run("git", ["config", "user.email"]).stdout.trim();
      if (name !== "winsznx") throw new Error(`git user.name is "${name}", expected winsznx`);
      const trailers = run("bash", [
        "-c",
        "git log --format=%B phase/05-confidential-series..HEAD | grep -ci 'Co-Authored-By' || true",
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

  // ── Role separation ───────────────────────────────────────────────────────────────────────
  {
    section: "ROLE SEPARATION",
    name: "seven roles, documented with rotation and loss scenarios",
    execute: () => {
      const path = repoPath("docs/phase6/ROLES.md");
      if (!existsSync(path)) throw new Error("docs/phase6/ROLES.md does not exist");
      const text = readFileSync(path, "utf8");
      const roles = [
        "deployer",
        "keeper",
        "operator",
        "curator",
        "emergency authority",
        "residue beneficiary",
        "auditor",
      ];
      const missing = roles.filter((role) => !text.toLowerCase().includes(role));
      if (missing.length > 0) throw new Error(`roles not documented: ${missing.join(", ")}`);

      // A role list without rotation and loss is a diagram, not an operations document. Both were
      // explicitly asked for and both are the part that gets skipped.
      const required: readonly [string, RegExp][] = [
        ["a rotation procedure per role", /rotation/i],
        ["what happens when a key is lost", /lost|loss/i],
        ["what happens when a key is compromised", /compromis/i],
        ["EOA versus contract recorded", /EOA/],
      ];
      const absent = required.filter(([, pattern]) => !pattern.test(text)).map(([what]) => what);
      if (absent.length > 0) throw new Error(`ROLES.md is missing: ${absent.join(", ")}`);
      return `${roles.length} roles, with rotation, loss, compromise and account kind`;
    },
  },
  {
    section: "ROLE SEPARATION",
    name: "the registry refuses every collapsed pair, on chain",
    execute: () =>
      summarise(
        run("forge", ["test", "--match-path", "contracts/test/RoleSeparation.t.sol"], {
          cwd: repoPath("."),
        }).stdout,
        2,
      ),
  },
  {
    section: "ROLE SEPARATION",
    name: "no two roles resolve to one address",
    skipIf: noEnv,
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/roles.ts", "sepolia"]).stdout, 2),
  },

  // ── The three features, against the real stack ────────────────────────────────────────────
  {
    section: "CAPSULE",
    name: "demonstrations 1-7, against real Nox and real Midnight",
    skipIf: noDocker,
    execute: () =>
      testTally(
        run("npx", ["hardhat", "test", "test/110-capsule.ts"], { cwd: repoPath("confidential") })
          .stdout,
      ),
  },
  {
    section: "CROSS",
    name: "demonstrations 8-15, against real Nox and real Midnight",
    skipIf: noDocker,
    execute: () =>
      testTally(
        run("npx", ["hardhat", "test", "test/120-cross.ts"], { cwd: repoPath("confidential") })
          .stdout,
      ),
  },
  {
    section: "ROLL",
    name: "demonstrations 16-23, across TWO real confidential stacks",
    skipIf: noDocker,
    execute: () =>
      testTally(
        run("npx", ["hardhat", "test", "test/130-roll.ts"], { cwd: repoPath("confidential") })
          .stdout,
      ),
  },

  // ── Quality and security ──────────────────────────────────────────────────────────────────
  {
    section: "QUALITY AND SECURITY",
    name: "the four attacks nothing else covers, each refusal asserted BY NAME",
    skipIf: noDocker,
    execute: () =>
      testTally(
        run("npx", ["hardhat", "test", "test/140-phase6-attacks.ts"], {
          cwd: repoPath("confidential"),
        }).stdout,
      ),
  },
  {
    section: "QUALITY AND SECURITY",
    name: "no two Solidity files share a basename",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/solidity-basenames.ts"]).stdout),
  },
  {
    section: "QUALITY AND SECURITY",
    name: "every contract fits EIP-170",
    execute: () =>
      summarise(run("pnpm", ["exec", "tsx", "scripts/verify/contract-size.ts"]).stdout),
  },
  {
    section: "QUALITY AND SECURITY",
    name: "no transaction exceeds the EIP-7825 cap",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/gas-cap.ts"]).stdout),
  },
  {
    section: "QUALITY AND SECURITY",
    name: "no secret, key or RPC credential in the tree",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/secrets.ts"]).stdout),
  },
  {
    section: "QUALITY AND SECURITY",
    name: "no decrypted value reaches a record, a log or a metric",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/privacy-scan.ts"]).stdout),
  },
  {
    /**
     * This gate can only ever report SKIP, and that is the point. Marking it PASS would assert
     * static-analysis coverage the confidential layer does not have; marking it FAIL would assert a
     * defect nobody found. It is a hole, it is reproduced in U-5, and it is named every single run.
     */
    section: "QUALITY AND SECURITY",
    name: "Slither over the confidential layer",
    skipIf: () =>
      "UNVERIFIED BY SLITHER. crytic-compile will not drive solc 0.8.36 (delta U-5, with the exact " +
      "reproduction). Compensating evidence: direct 0.8.36 compilation, the full unit and " +
      "integration suite against real Nox, the attack suite, contract-size and gas-cap checks.",
    execute: () => {
      throw new Error("unreachable: this gate always skips");
    },
  },
  {
    section: "QUALITY AND SECURITY",
    name: "Slither over the settlement layer, which it CAN reach",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/slither.ts"]).stdout, 2),
  },

  // ── Kyrve Verify ──────────────────────────────────────────────────────────────────────────
  {
    section: "KYRVE VERIFY",
    name: "every published fact recomputed from chain state, not from a manifest",
    skipIf: noEnv,
    execute: () => {
      // BOTH layers, separately. A layer B check that read layer A's records would pass without
      // layer B having done anything, which is the whole reason KYRVE_EVIDENCE_TAG exists.
      //
      // Exit 2 is UNAVAILABLE and is not a failure: layer B has no capsule vault and no Cross book
      // of its own, so those two checks report N/A rather than inventing a verdict. Only a FAIL,
      // exit 1, is a failure.
      const summary: string[] = [];
      for (const tag of ["a", "b"] as const) {
        const result = run("pnpm", ["exec", "tsx", "scripts/verify/kyrve-verify.ts"], {
          allowFailure: true,
          env: { ...process.env, KYRVE_EVIDENCE_TAG: tag },
        });
        if (result.code === 1) {
          throw new Error(`layer ${tag} FAILED kyrve-verify: ${summarise(result.stdout, 3)}`);
        }
        const counts = result.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => /\d+ passed/.test(line));
        summary.push(`layer ${tag}: ${counts.at(-1) ?? "(no tally)"}`);
      }
      return summary.join(" | ");
    },
  },

  // ── Sepolia ───────────────────────────────────────────────────────────────────────────────
  {
    section: "SEPOLIA",
    name: "two INDEPENDENT confidential issuance stacks, not one stack twice",
    skipIf: () =>
      existsSync(repoPath("deployments/sepolia/series-b.json"))
        ? null
        : "layer B not deployed. Run: DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true " +
          "pnpm deploy:series sepolia --universe <id> --suffix b",
    execute: () => {
      const a = readJson<{ seriesId: string; contracts: Record<string, { address: string }> }>(
        repoPath("deployments/sepolia/series.json"),
      );
      const b = readJson<{ seriesId: string; contracts: Record<string, { address: string }> }>(
        repoPath("deployments/sepolia/series-b.json"),
      );
      if (a.seriesId === b.seriesId) throw new Error("both layers name the SAME series");

      // Every contract must differ. A roll whose two "series" shared a custody vault or an engine
      // would prove nothing, and one shared address is enough to make the whole claim false.
      const shared = Object.keys(a.contracts).filter(
        (key) =>
          b.contracts[key] !== undefined &&
          a.contracts[key]?.address.toLowerCase() === b.contracts[key]?.address.toLowerCase(),
      );
      if (shared.length > 0) {
        throw new Error(
          `layer A and layer B SHARE ${shared.length} contract(s): ${shared.join(", ")}`,
        );
      }
      return `${Object.keys(a.contracts).length} contracts each, zero shared, distinct series ids`;
    },
  },
  {
    section: "SEPOLIA",
    name: "Etherscan V2 source verification for both layers",
    skipIf: () =>
      existsSync(repoPath("deployments/sepolia/series-b-etherscan.json"))
        ? null
        : "source not yet submitted for layer B. Run: pnpm verify:etherscan:series -- --suffix b",
    execute: () => {
      let verified = 0;
      let total = 0;
      for (const file of [
        "series-etherscan.json",
        "series-b-etherscan.json",
        "market-etherscan.json",
      ]) {
        const path = repoPath(`deployments/sepolia/${file}`);
        if (!existsSync(path)) continue;
        const record = readJson<{ verified: number; total: number }>(path);
        verified += record.verified;
        total += record.total;
        if (record.verified !== record.total) {
          throw new Error(`${file}: ${record.verified}/${record.total} verified`);
        }
      }
      return `${verified}/${total} contracts verified on Etherscan V2`;
    },
  },
  {
    section: "SEPOLIA",
    name: "one real Capsule, frozen and bound",
    skipIf: () =>
      existsSync(repoPath("evidence/phase6/sepolia-capsule.json"))
        ? null
        : "no Capsule on Sepolia. Run: pnpm test:sepolia-capsule",
    execute: () => {
      const record = evidence<Record<string, unknown>>("sepolia-capsule.json");
      const id = record["capsuleId"];
      const digest = record["originDigest"];
      if (typeof id !== "string" || typeof digest !== "string") {
        throw new Error("the capsule record names no capsule id or origin digest");
      }
      return `capsule ${id.slice(0, 12)}… digest ${digest.slice(0, 12)}…`;
    },
  },
  {
    section: "SEPOLIA",
    name: "one real Cross match, with both conservation identities",
    skipIf: () =>
      existsSync(repoPath("evidence/phase6/sepolia-cross.json"))
        ? null
        : "no Cross match on Sepolia. Run: pnpm test:sepolia-cross",
    execute: () => {
      const record = evidence<Record<string, unknown>>("sepolia-cross.json");
      const identities = [
        "sellerEscrowConserved",
        "buyerEscrowConserved",
        "dustRemainedWithTheBuyer",
      ];
      const failed = identities.filter((key) => record[key] !== true);
      if (failed.length > 0) throw new Error(`conservation failed: ${failed.join(", ")}`);
      return `${identities.length} conservation identities hold on the recorded match`;
    },
  },
  {
    section: "SEPOLIA",
    name: "one minimal coherent Roll, A -> B, with both refusals asserted BY NAME",
    skipIf: () =>
      existsSync(repoPath("evidence/phase6/sepolia-roll.json"))
        ? null
        : "no Roll on Sepolia. Run: DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true pnpm test:sepolia-roll",
    execute: () => {
      const record = evidence<Record<string, unknown>>("sepolia-roll.json");
      const claims = [
        "seriesAreDistinct",
        "sourceSolvent",
        "targetSolvent",
        "conversionReproducible",
        "factorReproducible",
        "conservesUnderConversion",
        "sourceSupplyUnchanged",
        "targetSupplyUnchanged",
        "staleNetIndexRefused",
        "overUnwindRefused",
        "resumedFromChainState",
      ];
      const failed = claims.filter((key) => record[key] !== true);
      if (failed.length > 0)
        throw new Error(`the roll record does not claim: ${failed.join(", ")}`);

      // U-10 in gate form. `staleNetIndexRefused: true` written by a bare catch would satisfy the
      // loop above; only the decoded error names prove the defences actually fired.
      const named = record["refusalsAssertedByName"] as Record<string, string> | undefined;
      if (
        named?.["staleNetIndex"] !== "StaleNetIndex" ||
        named["overUnwind"] !== "ResidualExceeded"
      ) {
        throw new Error(
          "the roll's refusals are not asserted by error name. A refusal that fires for an " +
            "unrelated reason proves nothing about the defence it is supposed to demonstrate (U-10).",
        );
      }
      return `${claims.length} claims, refusals decoded as StaleNetIndex and ResidualExceeded`;
    },
  },
  {
    section: "SEPOLIA",
    name: "per-role cost reconciled from receipts, with no separation violation",
    skipIf: () =>
      existsSync(repoPath("evidence/phase6/sepolia-role-reconciliation.json"))
        ? null
        : "no reconciliation. Run: DEPLOY_SEPOLIA=true pnpm roles:reconcile",
    execute: () => {
      const record = evidence<{
        receiptsFound: number;
        totalGasUsed: string;
        separationViolations: readonly string[];
        byCampaign: Record<string, { transactions: number; gasUsed: string }>;
      }>("sepolia-role-reconciliation.json");
      if (record.separationViolations.length > 0) {
        throw new Error(
          `roles signed outside their remit: ${record.separationViolations.join(", ")}`,
        );
      }
      const phase6 = record.byCampaign["phase6"];
      return `${record.receiptsFound} receipts, phase 6 alone ${phase6?.transactions ?? 0} tx / ${phase6?.gasUsed ?? "?"} gas`;
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
    } catch (error: unknown) {
      results.push({
        section: gate.section,
        name: gate.name,
        status: "FAIL",
        detail: error instanceof Error ? error.message.split("\n")[0] || "failed" : String(error),
      });
    }
  }

  const width = Math.max(...results.map((result) => result.name.length));
  const sections: readonly Section[] = [
    "ROLE SEPARATION",
    "CAPSULE",
    "CROSS",
    "ROLL",
    "KYRVE VERIFY",
    "QUALITY AND SECURITY",
    "SEPOLIA",
  ];
  console.log("");
  for (const section of sections) {
    const inSection = results.filter((result) => result.section === section);
    if (inSection.length === 0) continue;
    console.log(`PHASE 6 — ${section}\n`);
    for (const result of inSection) {
      console.log(`  ${result.status.padEnd(4)}  ${result.name.padEnd(width)}  ${result.detail}`);
    }
    console.log("");
  }

  const passed = results.filter((result) => result.status === "PASS").length;
  const failed = results.filter((result) => result.status === "FAIL").length;
  const skipped = results.filter((result) => result.status === "SKIP").length;
  const slitherSkipped = results.some(
    (result) => result.name === "Slither over the confidential layer" && result.status === "SKIP",
  );
  const featureSkipped = results.some(
    (result) =>
      result.status === "SKIP" && ["CAPSULE", "CROSS", "ROLL"].includes(result.section as string),
  );

  console.log(`\n  ${passed} passed, ${failed} failed, ${skipped} skipped\n`);

  if (failed > 0) {
    console.log(`  VERDICT: FAIL — ${failed} gate(s) did not pass.\n`);
    process.exitCode = 1;
    return;
  }
  if (featureSkipped) {
    console.log(
      "  VERDICT: NOT VERIFIED — a Capsule, Cross or Roll demonstration did not run, so nothing\n" +
        "  about the features themselves was checked by this invocation. The other gates passed;\n" +
        "  they are necessary and nowhere near sufficient.\n",
    );
    process.exitCode = 1;
    return;
  }

  // Always, on every run that gets this far.
  console.log(
    "  THE ROLL IS MINIMAL, AND THAT IS THE CLAIM. One intent against one supply between two\n" +
      "  series that share no contract. No production-scale throughput is proven or asserted.\n",
  );
  if (slitherSkipped) {
    console.log(
      "  UNVERIFIED BY SLITHER — the confidential layer has NO static-analysis coverage. crytic-\n" +
        "  compile will not drive solc 0.8.36 and delta U-5 carries the exact reproduction. The\n" +
        "  compensating evidence is real but it is not the same thing, and this line prints every run\n" +
        "  so the gap cannot become invisible by familiarity.\n",
    );
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
