import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CALLBACK_SUCCESS,
  CBP,
  DEFAULT_TICK_SPACING,
  LN_ONE_PLUS_DELTA,
  MAX_CONTINUOUS_FEE,
  MAX_SETTLEMENT_FEE,
  MAX_TICK,
  PRICE_ROUNDING_STEP,
  WAD,
} from "../src/constants.js";
import {
  accessibleTicks,
  assertTickAccessible,
  isTickAccessible,
  priceToTick,
  tickToPrice,
} from "../src/tick.js";

interface Fixture {
  midnightRelease: string;
  midnightCommit: string;
  wad: string;
  cbp: string;
  maxTick: string;
  priceRoundingStep: string;
  lnOnePlusDelta: string;
  defaultTickSpacing: string;
  maxContinuousFee: string;
  callbackSuccess: string;
  maxSettlementFee: string[];
  tickPrices: string[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/tick-prices.json", import.meta.url)), "utf8"),
);

/**
 * This is the test that makes `packages/quote-math` trustworthy. It is not a sample: it asserts
 * the TypeScript port equals the pinned Solidity at EVERY tick in range. A single wei of
 * disagreement anywhere would produce a quote the chain refuses to settle at.
 */
describe("tickToPrice is bit-for-bit identical to the pinned Midnight release", () => {
  it("was generated from the release this build pins", () => {
    expect(fixture.midnightRelease).toBe("2026-07-23");
    expect(fixture.midnightCommit).toBe("dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0");
    expect(fixture.tickPrices).toHaveLength(Number(MAX_TICK) + 1);
  });

  it("agrees at all 6,745 ticks", () => {
    const mismatches: string[] = [];
    for (let tick = 0n; tick <= MAX_TICK; tick++) {
      const expected = BigInt(fixture.tickPrices[Number(tick)] as string);
      const actual = tickToPrice(tick);
      if (actual !== expected) {
        mismatches.push(`tick ${tick}: solidity ${expected}, typescript ${actual}`);
        if (mismatches.length >= 5) break;
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("reproduces the boundary values Midnight's own tests assert", () => {
    // vendor/midnight/test/TickLibTest.sol :: testTickToPriceMinMax
    expect(tickToPrice(0n)).toBe(0n);
    expect(tickToPrice(2n)).toBe(PRICE_ROUNDING_STEP);
    expect(tickToPrice(MAX_TICK - 2n)).toBe(WAD - PRICE_ROUNDING_STEP);
    expect(tickToPrice(MAX_TICK)).toBe(WAD);
  });
});

describe("constants match the vendored release", () => {
  it.each([
    ["wad", WAD],
    ["cbp", CBP],
    ["maxTick", MAX_TICK],
    ["priceRoundingStep", PRICE_ROUNDING_STEP],
    ["lnOnePlusDelta", LN_ONE_PLUS_DELTA],
    ["maxContinuousFee", MAX_CONTINUOUS_FEE],
  ] as const)("%s", (key, value) => {
    expect(BigInt(fixture[key] as string)).toBe(value);
  });

  it("tick spacing", () => {
    expect(Number(fixture.defaultTickSpacing)).toBe(DEFAULT_TICK_SPACING);
  });

  it("CALLBACK_SUCCESS, which every Midnight callback must return", () => {
    expect(fixture.callbackSuccess).toBe(CALLBACK_SUCCESS);
  });

  it("the seven settlement-fee ceilings", () => {
    expect(fixture.maxSettlementFee.map(BigInt)).toEqual([...MAX_SETTLEMENT_FEE]);
  });
});

describe("tick direction — PRD v1.1 A-7", () => {
  it("is monotonically non-decreasing and capped at par", () => {
    let previous = -1n;
    for (let tick = 0n; tick <= MAX_TICK; tick++) {
      const price = tickToPrice(tick);
      expect(price).toBeGreaterThanOrEqual(previous);
      previous = price;
    }
    expect(previous).toBe(WAD);
  });

  it("means a higher tick is CHEAPER borrowing, not dearer", () => {
    // More assets received per unit of face value = lower cost of borrowing.
    const low = tickToPrice(4400n);
    const high = tickToPrice(6000n);
    expect(high).toBeGreaterThan(low);
  });
});

describe("priceToTick round-trips against the pinned implementation", () => {
  it("recovers a tick whose price equals the original, for every accessible tick", () => {
    for (const tick of accessibleTicks(DEFAULT_TICK_SPACING)) {
      const price = tickToPrice(tick);
      const recovered = priceToTick(price, 1);
      expect(tickToPrice(recovered)).toBe(price);
      expect(recovered).toBeLessThanOrEqual(tick);
    }
  });

  it("returns the lowest tick at or above the requested price", () => {
    for (const price of [0n, 1n, 10n ** 11n, 5n * 10n ** 17n, WAD]) {
      const tick = priceToTick(price, 1);
      expect(tickToPrice(tick)).toBeGreaterThanOrEqual(price);
      if (tick > 0n) expect(tickToPrice(tick - 1n)).toBeLessThanOrEqual(price);
    }
  });

  it("snaps up to a multiple of the requested spacing", () => {
    for (const spacing of [1, 2, 4, 8]) {
      const tick = priceToTick(5n * 10n ** 17n, spacing);
      expect(Number(tick) % spacing).toBe(0);
    }
  });

  it("rejects a price above par, as Midnight does", () => {
    expect(() => priceToTick(WAD + 1n, 1)).toThrow(/exceeds WAD/);
  });
});

describe("tick accessibility mirrors Midnight's TickNotAccessible guard", () => {
  it("accepts multiples of the market spacing", () => {
    expect(isTickAccessible(6000n, DEFAULT_TICK_SPACING)).toBe(true);
    expect(() => assertTickAccessible(6000n, DEFAULT_TICK_SPACING)).not.toThrow();
  });

  it("rejects a tick that is not a multiple, before the ratifier is ever consulted", () => {
    expect(isTickAccessible(6001n, DEFAULT_TICK_SPACING)).toBe(false);
    expect(() => assertTickAccessible(6001n, DEFAULT_TICK_SPACING)).toThrow(/not a multiple/);
  });

  it("rejects a tick above MAX_TICK", () => {
    expect(isTickAccessible(MAX_TICK + 1n, 1)).toBe(false);
    expect(() => assertTickAccessible(MAX_TICK + 1n, 1)).toThrow(/out of range/);
    expect(() => tickToPrice(MAX_TICK + 1n)).toThrow(/out of range/);
  });

  it("enumerates 1,687 accessible ticks at the default spacing", () => {
    const ticks = accessibleTicks(DEFAULT_TICK_SPACING);
    expect(ticks).toHaveLength(1687);
    expect(ticks[0]).toBe(0n);
    expect(ticks.at(-1)).toBe(MAX_TICK);
  });
});
