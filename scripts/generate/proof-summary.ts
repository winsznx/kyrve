/**
 * Generates the landing page's proof line from evidence that already exists.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS GENERATED AND NOT WRITTEN
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * "Live on Sepolia · contracts verified · confidential issuance, Capsule, Cross and Roll executed" is
 * a claim about what has run. Typed into a component it becomes a sentence that was true once — it
 * survives the deletion of the thing it describes, and the first person to notice is somebody who
 * checked.
 *
 * So it is derived, every time, from the records those runs wrote. A stage that has no evidence file
 * does not appear in the line. There is no way to add a stage to the landing page except by executing
 * it, which is the property worth having.
 *
 * `pnpm verify:generated` regenerates this and fails if the committed file differs, so a stale line
 * cannot survive a gate run.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * FOUR VERDICTS, CARRIED THROUGH
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Each stage is `verified`, `unavailable` or `reported-not-verified` — the same vocabulary the proof
 * pages use. Etherscan verification is `reported-not-verified` on purpose: the count comes from a
 * record this repository wrote, and nothing in the browser calls Etherscan to confirm it.
 */

import { existsSync, writeFileSync } from "node:fs";

import { readJson, repoPath } from "../lib/shell.js";

type Verdict = "verified" | "unavailable" | "reported-not-verified";

interface Stage {
  readonly id: string;
  /** What a reader is told has happened. Plain language, never a contract name. */
  readonly label: string;
  readonly verdict: Verdict;
  readonly detail: string;
}

/** Reads a record if it exists, and reports its absence as `unavailable` rather than as a failure. */
function evidence<T extends Record<string, unknown>>(path: string): T | undefined {
  return existsSync(repoPath(path)) ? readJson<T>(repoPath(path)) : undefined;
}

function main(): void {
  const stages: Stage[] = [];

  const deployment = evidence<{ chainId?: number; environment?: string }>(
    "deployments/sepolia/series.json",
  );
  stages.push(
    deployment === undefined
      ? {
          id: "deployment",
          label: "Deployed to Ethereum Sepolia",
          verdict: "unavailable",
          detail: "no Sepolia series record in this checkout",
        }
      : {
          id: "deployment",
          label: "Live on Ethereum Sepolia",
          verdict: "verified",
          detail: "two independent confidential issuance stacks, sharing no contract",
        },
  );

  // Etherscan counts come from records this repository wrote. Nothing here calls Etherscan.
  let verified = 0;
  let total = 0;
  for (const file of [
    "deployments/sepolia/series-etherscan.json",
    "deployments/sepolia/series-b-etherscan.json",
    "deployments/sepolia/market-etherscan.json",
    "deployments/sepolia/settlement-etherscan.json",
    "deployments/sepolia/confidential-etherscan.json",
  ]) {
    const record = evidence<{ verified?: number; total?: number }>(file);
    if (record === undefined) continue;
    verified += record.verified ?? 0;
    total += record.total ?? 0;
  }
  stages.push(
    total === 0
      ? {
          id: "source",
          label: "Contract source verification",
          verdict: "unavailable",
          detail: "no Etherscan submission record in this checkout",
        }
      : {
          id: "source",
          label: `${verified} of ${total} contracts source-verified`,
          verdict: "reported-not-verified",
          detail:
            "reported by the submission records in this repository. This page does not call " +
            "Etherscan, so it is listed rather than recomputed",
        },
  );

  const lifecycle: readonly [string, string, string][] = [
    ["issuance", "evidence/phase6/sepolia-allocation-a.json", "Confidential issuance executed"],
    ["settlement", "evidence/phase6/sepolia-settlement-a.json", "Exact-fill settlement executed"],
    ["capsule", "evidence/phase6/sepolia-capsule.json", "Disclosure issued"],
    ["cross", "evidence/phase6/sepolia-cross.json", "Position transfer executed"],
    ["roll", "evidence/phase6/sepolia-roll.json", "Maturity move executed"],
  ];
  for (const [id, file, label] of lifecycle) {
    const record = evidence(file);
    stages.push(
      record === undefined
        ? { id, label, verdict: "unavailable", detail: `no record at ${file}` }
        : { id, label, verdict: "verified", detail: `recorded in ${file}` },
    );
  }

  /**
   * The one-line summary, built only from stages that actually ran.
   *
   * A stage with no evidence contributes nothing rather than contributing a hedge, so the line gets
   * shorter when something is missing instead of getting vaguer.
   */
  const ran = stages.filter((stage) => stage.verdict === "verified");
  const line =
    ran.length === 0
      ? "No executed lifecycle evidence is present in this checkout."
      : `${ran[0]?.label ?? ""} · ${ran
          .slice(1)
          .map((stage) => stage.label.toLowerCase())
          .join(" · ")}`;

  const source = `/**
 * GENERATED. Do not edit by hand — run \`pnpm generate\`.
 *
 * The landing page's proof line and stage list, derived from the evidence records those runs wrote.
 * A stage that has no record does not appear as verified, so the only way to add one to the landing
 * page is to execute it. \`pnpm verify:generated\` fails if this file drifts from the records.
 */

export type ProofVerdict = "verified" | "unavailable" | "reported-not-verified";

export interface ProofStage {
  readonly id: string;
  readonly label: string;
  readonly verdict: ProofVerdict;
  readonly detail: string;
}

/** One line, built only from stages that actually ran. */
export const PROOF_LINE = ${JSON.stringify(line)};

export const PROOF_STAGES: readonly ProofStage[] = ${JSON.stringify(stages, null, 2)};
`;

  writeFileSync(repoPath("apps/web/src/generated/proof-summary.ts"), source);
  console.log(`  proof summary: ${ran.length}/${stages.length} stages verified`);
  console.log(`  ${line}`);
}

main();
