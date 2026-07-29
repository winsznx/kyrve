/**
 * The transaction schedule for one epoch.
 *
 * `docs/day0/OPERATION-BUDGET.md` §5 established that the full 16 x 128 universe is executable.
 * That conclusion survives Phase 3 measurement; only the schedule changed, for two reasons recorded
 * as delta R-3:
 *
 *   - stage B's unit is (provider, market), not provider, so it is 128 units at 16 x 8 rather than
 *     16 — and it now needs chunking of its own;
 *   - the winner fold carries six values rather than three, because the winning leaf's total
 *     capacity and privacy-floor flag are both needed downstream.
 *
 * `planCurveEpoch` is what the keeper and the workflow plan against. Step names are derived from
 * `stage` and `chunkIndex` and nothing else — Cloudflare Workflow step names are memoisation keys,
 * so a timestamp or a random value in one would silently break resumption rather than fail (A-20).
 */

import {
  CURVE_ALLOCATE_CHUNK_PROVIDERS,
  CURVE_CACHE_CHUNK_UNITS,
  CURVE_FINALIZE_CHUNK_LEAVES,
  CURVE_MAX_CELLS_PER_TRANSACTION,
  CURVE_REDUCE_CHUNK_LEAVES,
  CURVE_STAGE_GAS,
  CURVE_TRANSACTION_GAS_CEILING,
} from "./constants.js";

/** Matches `QuoteEpochController.Stage`, minus the terminal members that execute nothing. */
export const CURVE_STAGES = [
  "cacheProviders",
  "accumulate",
  "finalizeLeaves",
  "reduceWinner",
  "publishWinner",
  "allocate",
  "publishAggregate",
] as const;

export type CurveStage = (typeof CURVE_STAGES)[number];

export interface CurveTransaction {
  readonly stage: CurveStage;
  readonly chunkIndex: number;
  readonly units: number;
  readonly gas: number;
  /** Deterministic. Safe to use directly as a Workflow step name. */
  readonly stepName: string;
}

export interface CurvePlan {
  readonly providers: number;
  readonly markets: number;
  readonly leaves: number;
  readonly cells: number;
  readonly transactions: readonly CurveTransaction[];
  readonly transactionCount: number;
  readonly totalGas: number;
  readonly peakTransactionGas: number;
  /** Paid once per provider at seal, not once per epoch. Excluded from `totalGas` for that reason. */
  readonly sealGas: number;
}

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

function chunkSizes(total: number, perChunk: number): number[] {
  if (total === 0) return [];
  const sizes: number[] = [];
  let remaining = total;
  while (remaining > 0) {
    const take = Math.min(perChunk, remaining);
    sizes.push(take);
    remaining -= take;
  }
  return sizes;
}

export function curveStepName(epochId: string, stage: CurveStage, chunkIndex: number): string {
  return `${epochId}:${stage}:${chunkIndex}`;
}

export function planCurveEpoch(
  providers: number,
  markets: number,
  leaves: number,
  cellsPerChunk: number,
  epochId = "epoch",
): CurvePlan {
  for (const [name, value] of Object.entries({ providers, markets, leaves, cellsPerChunk })) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new PlanError(`${name} must be a positive integer, received ${value}`);
    }
  }
  if (cellsPerChunk > CURVE_MAX_CELLS_PER_TRANSACTION) {
    throw new PlanError(
      `a chunk of ${cellsPerChunk} cells exceeds the measured ${CURVE_MAX_CELLS_PER_TRANSACTION} ` +
        "per transaction. docs/day0/OPERATION-BUDGET.md is binding.",
    );
  }

  const transactions: CurveTransaction[] = [];
  const push = (stage: CurveStage, chunkIndex: number, units: number, gas: number): void => {
    transactions.push({
      stage,
      chunkIndex,
      units,
      gas,
      stepName: curveStepName(epochId, stage, chunkIndex),
    });
  };

  chunkSizes(providers * markets, CURVE_CACHE_CHUNK_UNITS).forEach((size, i) => {
    push("cacheProviders", i, size, size * CURVE_STAGE_GAS.cacheUnit);
  });

  const cells = providers * leaves;
  chunkSizes(cells, cellsPerChunk).forEach((size, i) => {
    push(
      "accumulate",
      i,
      size,
      size * CURVE_STAGE_GAS.accumulateCell + CURVE_STAGE_GAS.accumulateChunkOverhead,
    );
  });

  chunkSizes(leaves, CURVE_FINALIZE_CHUNK_LEAVES).forEach((size, i) => {
    push("finalizeLeaves", i, size, size * CURVE_STAGE_GAS.finalizeLeaf);
  });

  chunkSizes(leaves, CURVE_REDUCE_CHUNK_LEAVES).forEach((size, i) => {
    push("reduceWinner", i, size, size * CURVE_STAGE_GAS.reduceLeaf);
  });

  push("publishWinner", 0, 1, CURVE_STAGE_GAS.publishWinner);

  chunkSizes(providers, CURVE_ALLOCATE_CHUNK_PROVIDERS).forEach((size, i) => {
    push("allocate", i, size, size * CURVE_STAGE_GAS.allocateProvider);
  });

  push("publishAggregate", 0, 1, CURVE_STAGE_GAS.publishAggregate);

  const totalGas = transactions.reduce((sum, t) => sum + t.gas, 0);
  const peakTransactionGas = transactions.reduce((max, t) => Math.max(max, t.gas), 0);

  if (peakTransactionGas > CURVE_TRANSACTION_GAS_CEILING) {
    throw new PlanError(
      `the plan for ${providers}x${markets}x${leaves} has a ${peakTransactionGas} gas transaction, ` +
        `above the ${CURVE_TRANSACTION_GAS_CEILING} ceiling. Reduce cellsPerChunk or the universe.`,
    );
  }

  return {
    providers,
    markets,
    leaves,
    cells,
    transactions,
    transactionCount: transactions.length,
    totalGas,
    peakTransactionGas,
    sealGas: providers * CURVE_STAGE_GAS.sealProvider + CURVE_STAGE_GAS.prepareEpoch,
  };
}
