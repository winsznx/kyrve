/**
 * The universe chunk width, bounded by a protocol rule rather than by a judgement — delta S-2.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A SEPARATE, CHEAP FILE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `cellsPerChunk` is the ONE stage width that is a universe parameter rather than a compile-time
 * constant, and it was the one width that did not fit the Osaka per-transaction gas cap. So it is
 * also the one width a curator can get wrong at runtime, on a live deployment, with no recompilation
 * — which makes it worth a check that runs in seconds and needs no epoch.
 *
 * Phase 3 recommended 256 cells and measured `accumulateLeafChunk` at 18,193,386 gas. EIP-7825 caps
 * a single transaction at 16,777,216, so 256 was over by 1,416,170 and the launch-scale epoch was
 * not executable on Ethereum Sepolia at all. `CurveUniverseRegistry` now refuses anything above 192.
 *
 * The negative fixture is deliberately retained: `256` is asserted to be REFUSED, by number, so the
 * old configuration cannot quietly come back. And 193 is asserted separately, because a bound that
 * only rejects a value far past it is not a bound.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CURVE_MAX_CELLS_PER_TRANSACTION,
  CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
  CURVE_STAGE_GAS,
  CURVE_TRANSACTION_GAS_CEILING,
} from "@kyrve/curve";

import { assertRevertsWithError, deployCurveHarness } from "./curve-helpers.js";
import { mine } from "./helpers.js";

/** EIP-7825, measured on both sides of the boundary in `09-osaka.ts`. */
const OSAKA_TRANSACTION_GAS_CAP = 16_777_216;

describe("Phase 4: the universe chunk width is bounded by the Osaka gas cap (delta S-2)", () => {
  it("S-2a. the enforced maximum is 192, and the arithmetic says why", () => {
    assert.equal(CURVE_MAX_CELLS_PER_TRANSACTION, 192);
    assert.equal(CURVE_RECOMMENDED_CELLS_PER_TRANSACTION, 192);
    assert.equal(CURVE_TRANSACTION_GAS_CEILING, OSAKA_TRANSACTION_GAS_CAP);

    const at192 = 192 * CURVE_STAGE_GAS.accumulateCell + CURVE_STAGE_GAS.accumulateChunkOverhead;
    const at256 = 256 * CURVE_STAGE_GAS.accumulateCell + CURVE_STAGE_GAS.accumulateChunkOverhead;

    assert.ok(
      at192 < OSAKA_TRANSACTION_GAS_CAP,
      `192 cells is ${at192} gas, which must be under the ${OSAKA_TRANSACTION_GAS_CAP} cap`,
    );
    assert.ok(
      at256 > OSAKA_TRANSACTION_GAS_CAP,
      `the negative fixture requires 256 cells (${at256} gas) to EXCEED the cap; if it no longer ` +
        "does, the per-cell measurement changed and this bound should be re-derived rather than " +
        "assumed",
    );

    // Real margin, not a hair. Stated as a number so "safely under" is checkable.
    const marginPercent = ((OSAKA_TRANSACTION_GAS_CAP - at192) / OSAKA_TRANSACTION_GAS_CAP) * 100;
    assert.ok(marginPercent > 15, `192 cells leaves only ${marginPercent.toFixed(1)}% margin`);
  });

  it("S-2b. the registry accepts 192, and refuses 193 and 256 by name", async () => {
    const h = await deployCurveHarness();

    assert.equal(
      await h.universes.read.MAX_CELLS_PER_TRANSACTION(),
      BigInt(CURVE_MAX_CELLS_PER_TRANSACTION),
      "the deployed registry must enforce the same bound the packages declare",
    );

    // 192 is accepted. Without this the two rejections below could pass because EVERY width is
    // refused, which would be a broken registry rather than a bound.
    await mine(
      h,
      await h.universes.write.createUniverse(
        [`s2-accepts-192-${Date.now()}`, 16, 2, 1_000_000n, 192],
        { account: h.curator.account },
      ),
    );

    // 193 — one over the bound. A bound that only rejects a distant value is not a bound.
    await assertRevertsWithError(
      () =>
        h.universes.write.createUniverse([`s2-refuses-193-${Date.now()}`, 16, 2, 1_000_000n, 193], {
          account: h.curator.account,
        }),
      h.universes,
      "ChunkOutOfBudget",
      "a chunk width of 193",
    );

    // 256 — the configuration Phase 3 actually recommended and benchmarked. THE NEGATIVE FIXTURE.
    await assertRevertsWithError(
      () =>
        h.universes.write.createUniverse([`s2-refuses-256-${Date.now()}`, 16, 2, 1_000_000n, 256], {
          account: h.curator.account,
        }),
      h.universes,
      "ChunkOutOfBudget",
      "a chunk width of 256, which is what Phase 3 recommended",
    );
  });
});
