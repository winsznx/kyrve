/**
 * The epoch schedule, including the 16 x 128 benchmark regression.
 *
 * Day 0 concluded that the full launch universe is executable. Phase 3 measurement changed two of
 * the inputs to that conclusion (delta R-3), so the conclusion is re-derived here rather than
 * inherited — and pinned, so a future change to a stage cost that pushed a transaction over the
 * ceiling fails this file instead of failing on chain.
 */

import { describe, expect, it } from "vitest";

import {
  CURVE_MAX_CELLS_PER_TRANSACTION,
  CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
  CURVE_TRANSACTION_GAS_CEILING,
  curveStepName,
  PlanError,
  planCurveEpoch,
} from "../src/index.js";

describe("the full 16 x 128 launch universe is executable", () => {
  /**
   * 192 cells per chunk, not 256.
   *
   * 256 was Phase 3's recommendation and it measured 18,193,386 gas — 1,416,170 over the Osaka
   * per-transaction cap of 2^24, which is the only reason the launch universe was not executable.
   * `CURVE_RECOMMENDED_CELLS_PER_TRANSACTION` is the width the planner is now sized against, and
   * reading it from the constant rather than repeating a literal is what keeps this test honest when
   * the width moves again. Phase 4 delta S-2.
   */
  const plan = planCurveEpoch(16, 8, 128, CURVE_RECOMMENDED_CELLS_PER_TRANSACTION, "0xepoch");

  it("no single transaction exceeds the Osaka per-transaction gas cap", () => {
    expect(plan.peakTransactionGas).toBeLessThan(CURVE_TRANSACTION_GAS_CEILING);
  });

  it("every stage appears, and none is silently skipped", () => {
    const stages = new Set(plan.transactions.map((t) => t.stage));
    expect([...stages].sort()).toEqual([
      "accumulate",
      "allocate",
      "cacheProviders",
      "finalizeLeaves",
      "publishAggregate",
      "publishWinner",
      "reduceWinner",
    ]);
  });

  it("stage C covers exactly the 2,048 cells, with no cell processed twice", () => {
    const accumulate = plan.transactions.filter((t) => t.stage === "accumulate");
    expect(accumulate.reduce((sum, t) => sum + t.units, 0)).toBe(16 * 128);
    expect(accumulate.map((t) => t.chunkIndex)).toEqual([...accumulate.keys()]);
  });

  it("stage B is sized per (provider, market), which is the R-3 correction", () => {
    const cache = plan.transactions.filter((t) => t.stage === "cacheProviders");
    // 16 x 8 = 128 units. The Day 0 model would have produced 16 and under-run the stage by 8x.
    expect(cache.reduce((sum, t) => sum + t.units, 0)).toBe(128);
  });

  it("fits inside the 15-minute Workflow window at a conservative block cadence", () => {
    // The binding constraint is wall clock, not gas. At Sepolia's ~12s blocks, one transaction per
    // block, the whole epoch must land well inside the ceiling for cron and queue consumers.
    expect(plan.transactionCount * 12).toBeLessThan(15 * 60);
  });

  it("REGRESSION PIN: the shape of the launch epoch", () => {
    // Pinned so a change to any stage cost shows up here as an intentional edit with a reason,
    // rather than as a quietly different schedule. Update deliberately, never to make this pass.
    //
    // TWENTY-FIVE TRANSACTIONS, NOT TWENTY-TWO, and the reason is Phase 4 delta S-2. Phase 3
    // measured 22 at 256 cells per chunk with a peak of 19M gas against a 24,000,000 ceiling. That
    // ceiling was a judgement measured on a local node with no per-transaction cap; the real one is
    // EIP-7825's 2^24 = 16,777,216, and 19M does not fit it. At 192 cells the peak is 14M and stage
    // C needs 11 chunks instead of 8 — so the epoch is three transactions longer and costs the same
    // total gas.
    //
    // AND THE PEAK MOVES. At 192 cells stage C is 13.6M, so the most expensive transaction in the
    // epoch is no longer stage C but stage B: `cacheProviderChunk` at 32 x 468,047 = 15.0M, which
    // fits with 1.8M to spare — about 11%. That is the tightest margin left, it is the next width
    // that will need attention, and `pnpm verify:gas-cap` reports it as tight rather than waiting
    // for it to become a failure.
    //
    // Day 0's conclusion still survives: 25 transactions fit the 15-minute window several times
    // over. What does not survive is any keeper timeout sized against 22 — which is exactly the
    // quantity delta R-7 says must scale with operation count rather than be a constant.
    expect({
      transactions: plan.transactionCount,
      cells: plan.cells,
      totalGasMillions: Math.round(plan.totalGas / 1_000_000),
      peakGasMillions: Math.round(plan.peakTransactionGas / 1_000_000),
    }).toEqual({
      transactions: 25,
      cells: 2_048,
      totalGasMillions: 301,
      peakGasMillions: 15,
    });
  });
});

describe("smaller universes stay proportionate", () => {
  const shapes: readonly [number, number, number][] = [
    [4, 1, 16],
    [8, 2, 32],
    [8, 4, 64],
    [16, 4, 64],
  ];

  for (const [providers, markets, leaves] of shapes) {
    it(`${providers} x ${markets} x ${leaves} stays under the ceiling`, () => {
      const plan = planCurveEpoch(
        providers,
        markets,
        leaves,
        CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
      );
      expect(plan.peakTransactionGas).toBeLessThan(CURVE_TRANSACTION_GAS_CEILING);
      expect(plan.cells).toBe(providers * leaves);
    });
  }
});

describe("step names are deterministic, because they are memoisation keys", () => {
  it("the same epoch, stage and index always produce the same name", () => {
    expect(curveStepName("0xabc", "accumulate", 3)).toBe(curveStepName("0xabc", "accumulate", 3));
  });

  it("different chunks never collide", () => {
    const names = planCurveEpoch(
      16,
      8,
      128,
      CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
      "0xepoch",
    ).transactions.map((t) => t.stepName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("no step name carries a timestamp or a random value", () => {
    for (const t of planCurveEpoch(4, 2, 8, 16, "0xepoch").transactions) {
      expect(t.stepName).toBe(`0xepoch:${t.stage}:${t.chunkIndex}`);
    }
  });
});

describe("the planner refuses rather than producing an unexecutable schedule", () => {
  it("refuses a chunk above the measured per-transaction budget", () => {
    expect(() => planCurveEpoch(16, 8, 128, CURVE_MAX_CELLS_PER_TRANSACTION + 1)).toThrow(
      PlanError,
    );
    expect(() => planCurveEpoch(16, 8, 128, CURVE_MAX_CELLS_PER_TRANSACTION)).not.toThrow();
  });

  it("refuses non-positive dimensions", () => {
    expect(() => planCurveEpoch(0, 8, 128, 192)).toThrow(/providers must be a positive integer/);
    expect(() => planCurveEpoch(16, 8, 0, 192)).toThrow(/leaves must be a positive integer/);
  });
});
