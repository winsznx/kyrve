/**
 * Which layer a Sepolia run is operating on, and every path that follows from it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE ORCHESTRATION RISK THIS EXISTS TO REMOVE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Phase 6 runs the whole Phase 3-5 lifecycle TWICE, against two complete confidential issuance
 * stacks that share no contract (delta U-1). Every script in that lifecycle previously named one
 * fixed record and one fixed evidence path, which was correct while there was one layer and is a
 * silent data-loss bug the moment there are two:
 *
 *   - a layer A epoch would overwrite the record describing the epoch Phase 5 actually ran;
 *   - a layer B epoch would then overwrite layer A's;
 *   - and a layer B check reading layer A's file would PASS without layer B having done anything.
 *
 * That last one is the dangerous one. A successful layer A flow must never silently satisfy a layer
 * B check, so the tag is threaded through the paths rather than left to each caller's discipline.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * HOW IT IS SELECTED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   KYRVE_EVIDENCE_TAG=a    -> deployments/sepolia/series.json     evidence/phase6/*-a.json
 *   KYRVE_EVIDENCE_TAG=b    -> deployments/sepolia/series-b.json   evidence/phase6/*-b.json
 *   (unset)                 -> the Phase 5 paths, unchanged
 *
 * The deployment record is DERIVED from the tag rather than given separately: two sources of truth
 * for "which layer" is exactly how a run ends up reading layer A's contracts and writing layer B's
 * evidence.
 */

import { existsSync } from "node:fs";

import { repoPath } from "./shell.js";

export interface LayerPaths {
  /** `a`, `b`, or the empty string for a Phase 5 run. */
  readonly tag: string;
  /** Human-readable, for output that must say which layer it is talking about. */
  readonly label: string;
  readonly deployment: string;
  readonly epoch: string;
  readonly epochProofs: string;
  readonly settlement: string;
  /** Where the activated quote id is recorded. Separate from settlement: activation precedes it. */
  readonly activation: string;
  readonly allocation: string;
  readonly capsule: string;
  readonly cross: string;
  readonly roll: string;
}

export class UnknownLayerError extends Error {
  constructor(tag: string) {
    super(
      `KYRVE_EVIDENCE_TAG is "${tag}". Phase 6 recognises "a" (the 90-day source series) and ` +
        '"b" (the 30-day target series), or unset for a Phase 5 run. A typo here would write one ' +
        "layer's evidence under another layer's name, and every later check would read the wrong one.",
    );
    this.name = "UnknownLayerError";
  }
}

/** Resolves every layer-scoped path from the environment. Never guesses. */
export function layerPaths(): LayerPaths {
  const tag = (process.env["KYRVE_EVIDENCE_TAG"] ?? "").trim().toLowerCase();
  if (tag !== "" && tag !== "a" && tag !== "b") throw new UnknownLayerError(tag);

  if (tag === "") {
    return {
      tag,
      label: "the Phase 5 layer",
      deployment: "deployments/sepolia/series.json",
      epoch: "evidence/phase5/sepolia-epoch.json",
      epochProofs: "evidence/phase5/sepolia-epoch-proofs.json",
      settlement: "evidence/phase5/sepolia-settlement.json",
      activation: "evidence/phase5/sepolia-activation.json",
      allocation: "evidence/phase5/sepolia-allocation.json",
      capsule: "evidence/phase6/sepolia-capsule.json",
      cross: "evidence/phase6/sepolia-cross.json",
      roll: "evidence/phase6/sepolia-roll.json",
    };
  }

  const suffix = `-${tag}`;
  return {
    tag,
    label:
      tag === "a" ? "layer A (the 90-day source series)" : "layer B (the 30-day target series)",
    // `series.json` for A rather than `series-a.json`: layer A IS the deployment every other tool
    // reads by default, and renaming it would orphan `kyrve-verify`, `verify:roles` and the gate.
    deployment:
      tag === "a" ? "deployments/sepolia/series.json" : "deployments/sepolia/series-b.json",
    epoch: `evidence/phase6/sepolia-epoch${suffix}.json`,
    epochProofs: `evidence/phase6/sepolia-epoch-proofs${suffix}.json`,
    settlement: `evidence/phase6/sepolia-settlement${suffix}.json`,
    activation: `evidence/phase6/sepolia-activation${suffix}.json`,
    allocation: `evidence/phase6/sepolia-allocation${suffix}.json`,
    capsule: "evidence/phase6/sepolia-capsule.json",
    cross: "evidence/phase6/sepolia-cross.json",
    roll: "evidence/phase6/sepolia-roll.json",
  };
}

/**
 * Reads a layer-scoped record, refusing a missing one with the command that produces it.
 *
 * NEVER FALLS BACK TO ANOTHER LAYER'S FILE. That fallback is the failure this module exists to
 * prevent: it would let a layer B step succeed against layer A's state and report a proof that
 * never happened.
 */
export function requireLayerFile(path: string, what: string, produce: string): string {
  if (!existsSync(repoPath(path))) {
    throw new Error(
      `no record of ${what} at ${path}. Run \`${produce}\` first. This step will NOT fall back to ` +
        "another layer's record — a check that passed on the wrong layer's evidence is worse than " +
        "one that did not run.",
    );
  }
  return path;
}
