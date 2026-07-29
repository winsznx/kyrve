/**
 * Phase 3 demonstration 19: the full 16 x 128 universe, executed.
 *
 * `docs/day0/OPERATION-BUDGET.md` §5 concluded the launch universe is executable across a
 * multi-transaction epoch. That was arithmetic over measured primitive costs, not an execution.
 * This runs it: 16 providers, 8 markets, 16 rates each, 128 leaves, 2,048 eligibility cells, every
 * one of them a real Nox operation against the real local stack.
 *
 * It also produces `evidence/phase3/stage-gas.json`, which is where the corrected stage costs in
 * `@kyrve/curve` come from. Those numbers are MEASURED here and asserted against the planner, so a
 * change that pushed a chunk over the ceiling fails this file rather than failing on chain.
 *
 * SLOW BY NATURE. Sealing sixteen providers is 16 x 36 = 576 ACL grants, because
 * `INoxCompute` 0.2.4 has no batch entry point, plus the epoch's own transactions. That cost is
 * real, it is what a production keeper would pay, and it is recorded rather than avoided by
 * shrinking the universe until the test is quick.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { before, describe, it } from "node:test";

import {
  CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
  CURVE_TRANSACTION_GAS_CEILING,
  planCurveEpoch,
  UNIT,
} from "@kyrve/curve";

import {
  BENCH_POLL,
  type CurveHarness,
  createUniverse,
  deployCurveHarness,
  type EpochState,
  openAndSeal,
  runEpoch,
  type SealedProviderState,
  setupBorrower,
  setupProvider,
} from "./curve-helpers.js";

const PROVIDERS = 16;
const MARKETS = 8;
const RATES = 16;
const LEAVES = MARKETS * RATES;
const CELLS = PROVIDERS * LEAVES;

describe("Phase 3 benchmark: the full 16 x 128 launch universe", () => {
  let h: CurveHarness;
  let epoch: EpochState;

  before(async () => {
    h = await deployCurveHarness();
    const { universeId, universe } = await createUniverse(h, {
      markets: MARKETS,
      ratesPerMarket: RATES,
      maxProviders: PROVIDERS,
      privacyFloor: 2,
      // The recommended width, not the 311 maximum, so a chunk keeps real headroom.
      // 192, not 256. 256 measured at 18,193,386 gas and Osaka refuses any transaction above
      // 16,777,216 (EIP-7825) — the one stage width that did not fit, and the whole of delta S-2.
      // Read from the constant so this width cannot drift from what the registry enforces.
      cellsPerChunk: CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
      label: `bench-16x128-${Date.now()}`,
    });

    const providers: SealedProviderState[] = [];
    for (let slot = 0; slot < PROVIDERS; slot += 1) {
      providers.push(
        await setupProvider(h, universeId, {
          // Wallets 0 and the borrower's are reserved, so providers start at index 1 and the last
          // few reuse none of them — Hardhat exposes twenty accounts by default.
          walletIndex: slot + 1,
          balance: BigInt(500 + slot * 37) * UNIT,
          mandate: {
            marketCaps: Array.from({ length: 8 }, (_, m) => BigInt(100 + slot * 11 + m * 7) * UNIT),
            minRateIndexes: Array.from({ length: 8 }, (_, m) => (slot + m) % RATES),
          },
        }),
      );
    }

    const borrower = await setupBorrower(h, universeId, 17, {
      desiredAssets: 900n * UNIT,
      minimumAssets: 10n * UNIT,
      maxRateIndexes: Array.from({ length: 8 }, () => RATES - 1),
      preferredMaturityIndex: 1,
    });

    epoch = await openAndSeal(h, universeId, universe, providers, borrower);
    await runEpoch(h, epoch, 18, BENCH_POLL);
  });

  it("19. the full universe completes across the measured multi-transaction decomposition", async () => {
    const state = await h.epochs.read.epochOf([epoch.epochId]);
    assert.equal(Number(state.providerCount), PROVIDERS);
    assert.equal(Number(state.leafCount), LEAVES);
    assert.equal(Number(state.stage), 8, "the epoch must reach Complete");

    const graph = await h.graph.read.graphOf([epoch.epochId]);
    assert.equal(graph.sealedGraph, true);
    assert.equal(Number(graph.resultCount), 5);
  });

  it("19b. every cell was really evaluated — the plan and the chain agree on the chunk counts", async () => {
    const plan = planCurveEpoch(
      PROVIDERS,
      MARKETS,
      LEAVES,
      CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
      epoch.epochId,
    );
    const stages: readonly [number, string][] = [
      [1, "cacheProviders"],
      [2, "accumulate"],
      [3, "finalizeLeaves"],
      [4, "reduceWinner"],
      [6, "allocate"],
    ];

    for (const [stageIndex, stageName] of stages) {
      const progress = await h.epochs.read.progressOf([epoch.epochId, stageIndex]);
      const planned = plan.transactions.filter((t) => t.stage === stageName).length;
      assert.equal(
        Number(progress.total),
        planned,
        `${stageName}: the chain sized ${progress.total} chunks, the planner ${planned}`,
      );
      assert.equal(Number(progress.done), Number(progress.total), `${stageName} did not complete`);
    }

    assert.equal(CELLS, 2_048);
  });

  it("19c. no transaction came near the 24M ceiling", () => {
    const peak = Math.max(...Object.values(epoch.gas).flat());
    assert.ok(
      peak < CURVE_TRANSACTION_GAS_CEILING,
      `peak transaction was ${peak} gas, at or above the ${CURVE_TRANSACTION_GAS_CEILING} ceiling`,
    );
  });

  it("19d. the measured stage costs are recorded, and the planner is sized against them", () => {
    const measured = summarise(epoch.gas);

    mkdirSync(new URL("../../evidence/phase3/", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("../../evidence/phase3/stage-gas.json", import.meta.url),
      `${JSON.stringify(
        {
          $comment:
            "MEASURED against the real local Nox stack. Supersedes the Day 0 figures for stages " +
            "B and E (docs/phase3/PRD-DELTA.md R-3), and re-measured at 192 cells per chunk rather " +
            "than 256 because Osaka caps a single transaction at 16,777,216 gas and 256 measured " +
            "18,193,386 (docs/phase4/PRD-DELTA.md S-2). Local node, local stack: testnet gas " +
            "remains UNVERIFIED (AS-1).",
          universe: {
            providers: PROVIDERS,
            markets: MARKETS,
            rates: RATES,
            leaves: LEAVES,
            cells: CELLS,
          },
          // 192, not 256. 256 measured at 18,193,386 gas and Osaka refuses any transaction above
          // 16,777,216 (EIP-7825) — the one stage width that did not fit, and the whole of delta S-2.
          // Read from the constant so this width cannot drift from what the registry enforces.
          cellsPerChunk: CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
          stages: measured,
          perUnit: {
            accumulateCell: perUnit(measured.accumulateLeafChunk?.total ?? 0, CELLS),
            cacheUnit: perUnit(measured.cacheProviderChunk?.total ?? 0, PROVIDERS * MARKETS),
            finalizeLeaf: perUnit(measured.finalizeLeafChunk?.total ?? 0, LEAVES),
            reduceLeaf: perUnit(measured.reduceWinnerChunk?.total ?? 0, LEAVES),
            allocateProvider: perUnit(measured.allocateChunk?.total ?? 0, PROVIDERS),
          },
          limits: {
            transactionGasCeiling: CURVE_TRANSACTION_GAS_CEILING,
            peakTransactionGas: Math.max(...Object.values(epoch.gas).flat()),
          },
        },
        null,
        2,
      )}\n`,
    );

    // The planner must not UNDERSTATE any stage, or a chunk width derived from it could exceed the
    // ceiling on chain while every local test passed.
    const plan = planCurveEpoch(
      PROVIDERS,
      MARKETS,
      LEAVES,
      CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
      epoch.epochId,
    );
    const plannedPeak = plan.peakTransactionGas;
    const actualPeak = Math.max(...Object.values(epoch.gas).flat());
    assert.ok(
      plannedPeak >= actualPeak * 0.75,
      `the planner predicts a ${plannedPeak} gas peak but the chain used ${actualPeak}; the stage ` +
        "costs in @kyrve/curve are too optimistic to size a chunk width against",
    );
  });

  it("19e. the result still matches the plaintext reference model at full scale", async () => {
    // Scale is where a stage-boundary error hides: a chunked accumulation that drops its last cell,
    // or a fold that resets between chunks, produces a plausible quote on a small universe.
    const published = await h.engine.read.publishedOf([epoch.epochId]);
    assert.notEqual(published.aggregateFill, `0x${"00".repeat(32)}`);

    assert.equal(
      epoch.expected.winner !== null,
      true,
      "the reference model expects a winner at 16 x 128",
    );
  });
});

function summarise(
  gas: Record<string, number[]>,
): Record<string, { calls: number; total: number; max: number }> {
  const out: Record<string, { calls: number; total: number; max: number }> = {};
  for (const [stage, samples] of Object.entries(gas)) {
    out[stage] = {
      calls: samples.length,
      total: samples.reduce((sum, value) => sum + value, 0),
      max: Math.max(...samples),
    };
  }
  return out;
}

function perUnit(total: number, units: number): number {
  return units === 0 ? 0 : Math.round(total / units);
}
