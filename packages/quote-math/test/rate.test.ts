import { describe, expect, it } from "vitest";

import { DEFAULT_TICK_SPACING, WAD } from "../src/constants.js";
import {
  annualisedRateWad,
  assertGridViable,
  buildRateIndexes,
  impliedReturnWad,
  selectGridTicks,
  tickForRateIndex,
} from "../src/rate.js";
import { tickToPrice } from "../src/tick.js";

const DAY = 86_400n;
const NINETY_DAYS = 90n * DAY;
const FEE_CBP = [14, 14, 98, 400, 1000, 2500, 5000];

describe("implied return and annualised rate", () => {
  it("returns zero at par, where the borrower pays nothing for the term", () => {
    expect(impliedReturnWad(WAD)).toBe(0n);
  });

  it("rises as price falls, because a deeper discount is dearer borrowing", () => {
    const cheap = impliedReturnWad(tickToPrice(6700n));
    const dear = impliedReturnWad(tickToPrice(4400n));
    expect(dear).toBeGreaterThan(cheap);
  });

  it("refuses an undefined input rather than dividing by zero", () => {
    expect(() => impliedReturnWad(0n)).toThrow(/undefined at price/);
    expect(() => impliedReturnWad(WAD + 1n)).toThrow(/exceeds WAD/);
  });

  it("annualises a 90-day term by roughly 4x", () => {
    const price = tickToPrice(6000n);
    const term = impliedReturnWad(price);
    const annual = annualisedRateWad(price, NINETY_DAYS);
    expect(annual).toBeGreaterThan(term * 4n - term / 10n);
    expect(annual).toBeLessThan(term * 5n);
  });

  it("refuses to annualise a matured market", () => {
    expect(() => annualisedRateWad(tickToPrice(6000n), 0n)).toThrow(/no forward rate/);
  });
});

/**
 * The direction here is the single most error-prone thing in the quote path. PRD v1.0 declined to
 * assume it; v1.1 A-7 resolved it. These tests exist so a future refactor cannot quietly flip it.
 */
describe("rate index ordering — increasing cost means DECREASING tick", () => {
  it("orders index 0 as the cheapest borrowing", () => {
    const entries = buildRateIndexes([4400n, 5424n, 6000n, 6744n], NINETY_DAYS);
    expect(entries[0]?.tick).toBe(6744n);
    expect(entries.at(-1)?.tick).toBe(4400n);
  });

  it("makes borrowing cost strictly non-decreasing across the index", () => {
    const entries = buildRateIndexes([4400n, 4912n, 5424n, 5936n, 6448n], NINETY_DAYS);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.annualisedRateWad).toBeGreaterThanOrEqual(
        entries[i - 1]!.annualisedRateWad,
      );
      expect(entries[i]!.tick).toBeLessThan(entries[i - 1]!.tick);
    }
  });

  it("sorts regardless of input order", () => {
    const ascending = buildRateIndexes([4400n, 5424n, 6000n], NINETY_DAYS);
    const descending = buildRateIndexes([6000n, 5424n, 4400n], NINETY_DAYS);
    expect(ascending).toEqual(descending);
  });

  it("rejects a grid containing duplicate ticks", () => {
    expect(() => buildRateIndexes([6000n, 6000n], NINETY_DAYS)).toThrow(/duplicate ticks/);
  });

  it("resolves an index to its exact tick, and refuses one out of range", () => {
    const entries = buildRateIndexes([4400n, 6000n], NINETY_DAYS);
    expect(tickForRateIndex(entries, 0)).toBe(6000n);
    expect(() => tickForRateIndex(entries, 2)).toThrow(/out of range; the grid has 2 entries/);
  });
});

describe("grid selection always produces a settleable universe", () => {
  const request = {
    tickSpacing: DEFAULT_TICK_SPACING,
    settlementFeeCbp: FEE_CBP,
    secondsToMaturity: NINETY_DAYS,
    minAnnualisedRateWad: 20_000_000_000_000_000n, // 2%
    maxAnnualisedRateWad: 250_000_000_000_000_000n, // 25%
    points: 16,
  };

  it("returns the requested number of points", () => {
    expect(selectGridTicks(request)).toHaveLength(16);
  });

  it("puts every tick on the market's spacing", () => {
    for (const tick of selectGridTicks(request)) {
      expect(Number(tick) % DEFAULT_TICK_SPACING).toBe(0);
    }
  });

  it("excludes every tick priced below the settlement fee, so take can never underflow", () => {
    const ticks = selectGridTicks(request);
    expect(() => assertGridViable(ticks, FEE_CBP, NINETY_DAYS, DEFAULT_TICK_SPACING)).not.toThrow();
  });

  it("keeps every point inside the requested rate band", () => {
    for (const tick of selectGridTicks(request)) {
      const rate = annualisedRateWad(tickToPrice(tick), NINETY_DAYS);
      expect(rate).toBeGreaterThanOrEqual(request.minAnnualisedRateWad);
      expect(rate).toBeLessThanOrEqual(request.maxAnnualisedRateWad);
    }
  });

  it("is deterministic", () => {
    expect(selectGridTicks(request)).toEqual(selectGridTicks(request));
  });

  it("spans the band rather than clustering at one end", () => {
    const ticks = selectGridTicks(request);
    const rates = ticks.map((t) => annualisedRateWad(tickToPrice(t), NINETY_DAYS));
    const spread =
      rates.reduce((a, b) => (a > b ? a : b)) - rates.reduce((a, b) => (a < b ? a : b));
    expect(spread).toBeGreaterThan(request.maxAnnualisedRateWad / 2n);
  });

  it("fails loudly when no tick satisfies the band, rather than returning an empty grid", () => {
    // The steepest reachable rate is set by the settlement-fee floor: the lowest usable price is
    // the fee itself, giving roughly 4e21 WAD annualised at 90 days. Anything above that is
    // genuinely unreachable rather than merely unusual.
    expect(() =>
      selectGridTicks({
        ...request,
        minAnnualisedRateWad: 10n ** 24n,
        maxAnnualisedRateWad: 10n ** 25n,
      }),
    ).toThrow(/no accessible tick/);
  });

  it("rejects an inverted band", () => {
    expect(() =>
      selectGridTicks({ ...request, minAnnualisedRateWad: 10n ** 18n, maxAnnualisedRateWad: 1n }),
    ).toThrow(/exceeds max/);
  });

  it("rejects a non-positive point count", () => {
    expect(() => selectGridTicks({ ...request, points: 0 })).toThrow(/positive integer/);
  });
});

describe("assertGridViable is a real gate", () => {
  it("rejects a grid containing a tick below the fee floor", () => {
    expect(() => assertGridViable([0n], FEE_CBP, NINETY_DAYS, DEFAULT_TICK_SPACING)).toThrow(
      /below the settlement fee/,
    );
  });

  it("rejects a grid containing an off-spacing tick", () => {
    expect(() => assertGridViable([6001n], FEE_CBP, NINETY_DAYS, DEFAULT_TICK_SPACING)).toThrow(
      /not a multiple/,
    );
  });
});
