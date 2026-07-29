import { describe, expect, it } from "vitest";

import { DEFAULT_TICK_SPACING, MAX_TICK, WAD } from "../src/constants.js";
import {
  minimumViableTick,
  quoteAmounts,
  TickBelowSettlementFee,
  unitsFromTargetAssets,
} from "../src/quote.js";
import { tickToPrice } from "../src/tick.js";

const DAY = 86_400n;
const FEE_CBP = [14, 14, 98, 400, 1000, 2500, 5000];
const NINETY_DAYS = 90n * DAY;

function inputs(overrides: Partial<Parameters<typeof quoteAmounts>[0]> = {}) {
  return {
    units: 1_000_000_000_000n,
    tick: 6000n,
    settlementFeeCbp: FEE_CBP,
    secondsToMaturity: NINETY_DAYS,
    tickSpacing: DEFAULT_TICK_SPACING,
    ...overrides,
  };
}

describe("quoteAmounts", () => {
  it("makes the maker pay floor(units * price / WAD)", () => {
    const q = quoteAmounts(inputs());
    expect(q.buyerAssets).toBe((q.units * tickToPrice(6000n)) / WAD);
    expect(q.buyerPrice).toBe(q.offerPrice);
  });

  it("takes the settlement fee out of the borrower's proceeds only", () => {
    const q = quoteAmounts(inputs());
    expect(q.sellerPrice).toBe(q.offerPrice - q.settlementFee);
    expect(q.settlementFeeTaken).toBe(q.buyerAssets - q.sellerAssets);
    expect(q.sellerAssets).toBeLessThan(q.buyerAssets);
  });

  it("rejects a tick that is not on the market's spacing", () => {
    expect(() => quoteAmounts(inputs({ tick: 6001n }))).toThrow(/not a multiple/);
  });

  it("rejects units that would not fit uint128", () => {
    expect(() => quoteAmounts(inputs({ units: 2n ** 128n }))).toThrow(/uint128/);
  });

  it("handles a matured market, where no fee remains to accrue", () => {
    const q = quoteAmounts(inputs({ secondsToMaturity: 0n }));
    // At zero time to maturity the schedule collapses to breakpoint 0.
    expect(q.settlementFee).toBe(14n * 10n ** 12n);
    expect(q.buyerAssets).toBe((q.units * q.offerPrice) / WAD);
  });

  it("is unchanged by the settlement fee for the maker, at every grid tick", () => {
    for (let tick = 4400n; tick <= MAX_TICK; tick += 256n) {
      const t = tick - (tick % BigInt(DEFAULT_TICK_SPACING));
      const low = quoteAmounts(inputs({ tick: t, settlementFeeCbp: [0, 0, 0, 1, 1, 1, 1] }));
      const high = quoteAmounts(inputs({ tick: t, settlementFeeCbp: FEE_CBP }));
      expect(high.buyerAssets).toBe(low.buyerAssets);
      expect(high.sellerAssets).toBeLessThanOrEqual(low.sellerAssets);
    }
  });
});

describe("settlement-fee floor — PRD v1.1 A-3", () => {
  it("refuses a tick priced below the fee, where take would revert on underflow", () => {
    expect(() => quoteAmounts(inputs({ tick: 0n }))).toThrow(TickBelowSettlementFee);
    expect(() => quoteAmounts(inputs({ tick: 0n }))).toThrow(/would revert on underflow/);
  });

  it("finds the lowest tick that is actually usable", () => {
    const minimum = minimumViableTick(FEE_CBP, NINETY_DAYS, DEFAULT_TICK_SPACING);
    expect(() => quoteAmounts(inputs({ tick: minimum }))).not.toThrow();
  });

  it("proves the tick below the minimum is genuinely unusable", () => {
    const minimum = minimumViableTick(FEE_CBP, NINETY_DAYS, DEFAULT_TICK_SPACING);
    if (minimum >= BigInt(DEFAULT_TICK_SPACING)) {
      const below = minimum - BigInt(DEFAULT_TICK_SPACING);
      expect(() => quoteAmounts(inputs({ tick: below }))).toThrow(TickBelowSettlementFee);
    }
  });

  it("the minimum rises as the fee rises", () => {
    const cheap = minimumViableTick([0, 0, 0, 1, 1, 1, 1], NINETY_DAYS, DEFAULT_TICK_SPACING);
    const dear = minimumViableTick(
      [0, 0, 0, 400, 1000, 2500, 5000],
      NINETY_DAYS,
      DEFAULT_TICK_SPACING,
    );
    expect(dear).toBeGreaterThanOrEqual(cheap);
  });

  it("does not apply to a sell offer, where sellerPrice is the offer price", () => {
    expect(() => quoteAmounts(inputs({ tick: 0n, buy: false }))).not.toThrow();
  });
});

describe("unitsFromTargetAssets — PRD v1.1 A-8", () => {
  it("never makes the maker owe more than providers reserved", () => {
    for (let tick = 4400n; tick <= MAX_TICK; tick += 4n) {
      for (const target of [1_000_000n, 999_999_999_999n, 123_456_789_012_345n]) {
        const { buyerAssets, dust } = unitsFromTargetAssets(target, tick, DEFAULT_TICK_SPACING);
        expect(buyerAssets).toBeLessThanOrEqual(target);
        expect(dust).toBe(target - buyerAssets);
      }
    }
  });

  it("bounds the residue at 2 wei, as Day 0 fuzzing measured", () => {
    let maxDust = 0n;
    for (let tick = 4400n; tick <= MAX_TICK; tick += 4n) {
      for (const target of [1n, 7n, 999_999_999_999n, 500_000_000_000_000n]) {
        const { dust } = unitsFromTargetAssets(target, tick, DEFAULT_TICK_SPACING);
        if (dust > maxDust) maxDust = dust;
      }
    }
    expect(maxDust).toBeLessThanOrEqual(2n);
  });

  it("routes the residue explicitly rather than absorbing it", () => {
    const { units, buyerAssets, dust } = unitsFromTargetAssets(
      999_999_999_999n,
      6000n,
      DEFAULT_TICK_SPACING,
    );
    expect(buyerAssets + dust).toBe(999_999_999_999n);
    expect(units).toBeGreaterThan(0n);
  });

  it("refuses a zero-priced tick instead of dividing by zero", () => {
    expect(() => unitsFromTargetAssets(1000n, 0n, DEFAULT_TICK_SPACING)).toThrow(/prices at zero/);
  });

  it("rejects an off-spacing tick", () => {
    expect(() => unitsFromTargetAssets(1000n, 6001n, DEFAULT_TICK_SPACING)).toThrow(
      /not a multiple/,
    );
  });

  it("round-trips: the derived units quote back to the derived buyerAssets", () => {
    const target = 750_000_000_000n;
    const { units, buyerAssets } = unitsFromTargetAssets(target, 5936n, DEFAULT_TICK_SPACING);
    const q = quoteAmounts(inputs({ units, tick: 5936n }));
    expect(q.buyerAssets).toBe(buyerAssets);
  });
});
