import { describe, expect, it } from "vitest";

import {
  assertChunkWithinBudget,
  LAUNCH_UNIVERSE,
  OPERATION_BUDGET,
  planEpoch,
  publishedEpochGas,
  STAGE_GAS,
} from "../src/budget.js";

/**
 * The capacity table published in docs/day0/OPERATION-BUDGET.md section 5, transcribed verbatim.
 * If Day 0's measured numbers and this package ever drift apart, these tests fail rather than
 * letting the evidence quietly stop matching the code.
 */
const PUBLISHED_TABLE = [
  { providers: 4, leaves: 16, cells: 64, cellGas: 4_889_728, totalGas: 10_637_568 },
  { providers: 8, leaves: 32, cells: 256, cellGas: 19_558_912, totalGas: 31_054_592 },
  { providers: 8, leaves: 64, cells: 512, cellGas: 39_117_824, totalGas: 58_725_376 },
  { providers: 16, leaves: 64, cells: 1024, cellGas: 78_235_648, totalGas: 101_227_008 },
  { providers: 16, leaves: 128, cells: 2048, cellGas: 156_471_296, totalGas: 195_686_400 },
] as const;

describe("published Day 0 capacity table", () => {
  it.each(PUBLISHED_TABLE)(
    "reproduces $providers x $leaves exactly",
    ({ providers, leaves, cells, cellGas, totalGas }) => {
      const plan = planEpoch(providers, leaves);
      expect(plan.cells).toBe(cells);
      expect(plan.cellGas).toBe(cellGas);
      expect(publishedEpochGas(providers, leaves)).toBe(totalGas);
    },
  );

  it("derives max cells per transaction from the measured cell cost, not from a chosen constant", () => {
    const derived = Math.floor(
      (OPERATION_BUDGET.transactionGasCeiling - STAGE_GAS.accumulateChunkOverhead) /
        STAGE_GAS.accumulateCell,
    );
    expect(derived).toBe(OPERATION_BUDGET.maxCellsPerTransaction);
  });

  it("keeps the recommended chunk meaningfully under the ceiling", () => {
    const gas =
      OPERATION_BUDGET.recommendedChunkCells * STAGE_GAS.accumulateCell +
      STAGE_GAS.accumulateChunkOverhead;
    expect(gas).toBeLessThan(OPERATION_BUDGET.transactionGasCeiling);
    // ~18% margin, per docs/day0/OPERATION-BUDGET.md section 4.
    expect(gas / OPERATION_BUDGET.transactionGasCeiling).toBeLessThan(0.83);
  });
});

describe("Phase 1 correction P-1 — the published model omits per-epoch costs", () => {
  it.each(PUBLISHED_TABLE)(
    "$providers x $leaves: the corrected plan exceeds the published figure",
    ({ providers, leaves, totalGas }) => {
      const plan = planEpoch(providers, leaves);
      expect(plan.totalGas).toBeGreaterThan(totalGas);
    },
  );

  it("attributes the entire difference to chunk overhead plus publishWinner", () => {
    for (const { providers, leaves, totalGas } of PUBLISHED_TABLE) {
      const plan = planEpoch(providers, leaves);
      const chunks = plan.transactions.filter((t) => t.stage === "accumulate").length;
      const expectedDifference =
        chunks * STAGE_GAS.accumulateChunkOverhead + STAGE_GAS.publishWinner;
      expect(plan.totalGas - totalGas).toBe(expectedDifference);
    }
  });

  it("understates 16 x 128 by less than 1 percent, so the Day 0 conclusion is unaffected", () => {
    const plan = planEpoch(LAUNCH_UNIVERSE.maxProviders, LAUNCH_UNIVERSE.maxLeaves);
    const published = publishedEpochGas(LAUNCH_UNIVERSE.maxProviders, LAUNCH_UNIVERSE.maxLeaves);
    expect((plan.totalGas - published) / published).toBeLessThan(0.01);
  });
});

describe("epoch planning", () => {
  it("keeps every transaction in the launch universe under the gas ceiling", () => {
    const plan = planEpoch(LAUNCH_UNIVERSE.maxProviders, LAUNCH_UNIVERSE.maxLeaves);
    expect(plan.peakTransactionGas).toBeLessThanOrEqual(OPERATION_BUDGET.transactionGasCeiling);
    for (const tx of plan.transactions) {
      expect(tx.gas).toBeLessThanOrEqual(OPERATION_BUDGET.transactionGasCeiling);
    }
  });

  it("schedules the full launch universe inside the 15-minute epoch ceiling", () => {
    const plan = planEpoch(LAUNCH_UNIVERSE.maxProviders, LAUNCH_UNIVERSE.maxLeaves);
    // Worst case: every transaction waits a full Runner stage timeout plus a 12s block.
    const worstCaseMs = plan.transactionCount * (OPERATION_BUDGET.runnerTimeoutPerStageMs + 12_000);
    expect(worstCaseMs).toBeLessThan(OPERATION_BUDGET.epochTimeoutMs);
  });

  it("crosses the public/private boundary exactly once per epoch", () => {
    const plan = planEpoch(LAUNCH_UNIVERSE.maxProviders, LAUNCH_UNIVERSE.maxLeaves);
    expect(plan.transactions.filter((t) => t.stage === "publish")).toHaveLength(1);
  });

  it("orders stages so no stage can run before its inputs exist", () => {
    const plan = planEpoch(8, 32);
    const order = ["cacheProvider", "accumulate", "finalize", "reduce", "publish", "allocate"];
    const seen = plan.transactions.map((t) => order.indexOf(t.stage));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it("assigns deterministic chunk indexes within each stage", () => {
    const a = planEpoch(16, 128);
    const b = planEpoch(16, 128);
    expect(a.transactions).toEqual(b.transactions);
    const accumulate = a.transactions.filter((t) => t.stage === "accumulate");
    expect(accumulate.map((t) => t.chunkIndex)).toEqual(accumulate.map((_, i) => i));
  });

  it("covers every cell exactly once across accumulate chunks", () => {
    const plan = planEpoch(16, 128);
    const covered = plan.transactions
      .filter((t) => t.stage === "accumulate")
      .reduce((sum, t) => sum + t.units, 0);
    expect(covered).toBe(plan.cells);
  });

  it("uses fewer transactions at the 311-cell maximum than at the 256 recommendation", () => {
    const recommended = planEpoch(16, 128, OPERATION_BUDGET.recommendedChunkCells);
    const maximum = planEpoch(16, 128, OPERATION_BUDGET.maxCellsPerTransaction);
    expect(maximum.transactionCount).toBeLessThan(recommended.transactionCount);
    expect(maximum.peakTransactionGas).toBeLessThanOrEqual(OPERATION_BUDGET.transactionGasCeiling);
  });
});

describe("budget guards fail closed", () => {
  it("rejects a chunk above the measured maximum", () => {
    expect(() => assertChunkWithinBudget(OPERATION_BUDGET.maxCellsPerTransaction + 1)).toThrow(
      /exceeds the measured budget/,
    );
  });

  it("accepts a chunk at exactly the maximum", () => {
    expect(() => assertChunkWithinBudget(OPERATION_BUDGET.maxCellsPerTransaction)).not.toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects %s as a universe dimension", (bad) => {
    expect(() => planEpoch(bad, 16)).toThrow(/positive integer/);
    expect(() => planEpoch(16, bad)).toThrow(/positive integer/);
  });
});
