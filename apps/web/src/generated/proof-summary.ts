/**
 * GENERATED. Do not edit by hand — run `pnpm generate`.
 *
 * The landing page's proof line and stage list, derived from the evidence records those runs wrote.
 * A stage that has no record does not appear as verified, so the only way to add one to the landing
 * page is to execute it. `pnpm verify:generated` fails if this file drifts from the records.
 */

export type ProofVerdict = "verified" | "unavailable" | "reported-not-verified";

export interface ProofStage {
  readonly id: string;
  readonly label: string;
  readonly verdict: ProofVerdict;
  readonly detail: string;
}

/** One line, built only from stages that actually ran. */
export const PROOF_LINE = "Live on Ethereum Sepolia · confidential issuance executed · exact-fill settlement executed · disclosure issued · position transfer executed · maturity move executed";

export const PROOF_STAGES: readonly ProofStage[] = [
  {
    "id": "deployment",
    "label": "Live on Ethereum Sepolia",
    "verdict": "verified",
    "detail": "two independent confidential issuance stacks, sharing no contract"
  },
  {
    "id": "source",
    "label": "56 of 56 contracts source-verified",
    "verdict": "reported-not-verified",
    "detail": "reported by the submission records in this repository. This page does not call Etherscan, so it is listed rather than recomputed"
  },
  {
    "id": "issuance",
    "label": "Confidential issuance executed",
    "verdict": "verified",
    "detail": "recorded in evidence/phase6/sepolia-allocation-a.json"
  },
  {
    "id": "settlement",
    "label": "Exact-fill settlement executed",
    "verdict": "verified",
    "detail": "recorded in evidence/phase6/sepolia-settlement-a.json"
  },
  {
    "id": "capsule",
    "label": "Disclosure issued",
    "verdict": "verified",
    "detail": "recorded in evidence/phase6/sepolia-capsule.json"
  },
  {
    "id": "cross",
    "label": "Position transfer executed",
    "verdict": "verified",
    "detail": "recorded in evidence/phase6/sepolia-cross.json"
  },
  {
    "id": "roll",
    "label": "Maturity move executed",
    "verdict": "verified",
    "detail": "recorded in evidence/phase6/sepolia-roll.json"
  }
];

/** One real settled quote for the hero, or null when no settlement evidence exists. */
export const PROOF_SPECIMEN: {
  readonly amount: string;
  readonly units: string;
  readonly settlementTx: string;
} | null = {
  "amount": "299.999999",
  "units": "300000599",
  "settlementTx": "0xfa8ef1a14438f1361f1cd3bfc221f1dad2e3636e18032790fac478a4085aa684"
};
