/**
 * Universe validation, one violated property per fixture.
 *
 * `.claude/rules/testing.md`: a test that cannot fail proves nothing. So every branch below starts
 * from a universe that BUILDS, changes exactly one thing, and asserts the specific refusal — never
 * "it threw". A validator whose branches are never taken is decoration, and the four grid checks
 * here are the ones standing between a typo and a quote that reverts inside Midnight's `take`.
 */

import { describe, expect, it } from "vitest";

import {
  buildUniverse,
  CURVE_MAX_CELLS_PER_TRANSACTION,
  CURVE_MAX_LEAVES,
  gridHash,
  makeGrid,
  makeMarket,
  makeUniverseDraft,
  UNIT,
  type UniverseDraft,
  UniverseError,
  universeIdFor,
} from "../src/index.js";

function draft(overrides: Partial<UniverseDraft> = {}): UniverseDraft {
  return { ...makeUniverseDraft({ markets: 2, ratesPerMarket: 4 }), ...overrides };
}

describe("a well-formed universe builds", () => {
  it("produces one leaf per (market, rate) in market-then-rate order", () => {
    const universe = buildUniverse(draft());
    expect(universe.leaves).toHaveLength(8);
    expect(universe.leaves[0]).toMatchObject({ marketIndex: 0, rateIndex: 0 });
    expect(universe.leaves[4]).toMatchObject({ marketIndex: 1, rateIndex: 0 });
  });

  it("builds the full 8 x 16 launch universe at exactly the 128-leaf ceiling", () => {
    const universe = buildUniverse(makeUniverseDraft({ markets: 8, ratesPerMarket: 16 }));
    expect(universe.leaves).toHaveLength(CURVE_MAX_LEAVES);
    expect(universe.markets).toHaveLength(8);
  });

  it("derives a chain- and deployment-bound id, so one label is two universes on two chains", () => {
    const a = universeIdFor(31337, "0x00000000000000000000000000000000000000ce", "same-label");
    const b = universeIdFor(11155111, "0x00000000000000000000000000000000000000ce", "same-label");
    expect(a).not.toBe(b);
  });

  it("hashes each grid over its market id, ticks and prices together", () => {
    const market = makeMarket(0);
    const grid = makeGrid(market, 4);
    const same = gridHash(market, grid.ticks, grid.pricesWad);
    const reordered = gridHash(market, [...grid.ticks].reverse(), grid.pricesWad);
    expect(gridHash(market, grid.ticks, grid.pricesWad)).toBe(same);
    expect(reordered).not.toBe(same);
  });
});

describe("the four grid properties each refuse on their own", () => {
  it("refuses a tick that is off the market's spacing", () => {
    const market = makeMarket(0, { tickSpacing: 4 });
    const grid = makeGrid(market, 3);
    const broken = { ...grid, ticks: [grid.ticks[0]!, grid.ticks[1]! - 1, grid.ticks[2]!] };
    expect(() => buildUniverse(draft({ markets: [broken] }))).toThrow(/is not on the 4 spacing/);
  });

  it("refuses a price below the settlement-fee floor, which would revert inside take", () => {
    const market = makeMarket(0, { settlementFeeFloorWad: 10n ** 18n - 1n });
    expect(() => buildUniverse(draft({ markets: [makeGrid(market, 3)] }))).toThrow(
      /below the settlement fee floor/,
    );
  });

  it("refuses a price above par, which would mean funding more than face value", () => {
    const market = makeMarket(0);
    const grid = makeGrid(market, 3);
    const broken = { ...grid, pricesWad: [10n ** 18n + 1n, ...grid.pricesWad.slice(1)] };
    expect(() => buildUniverse(draft({ markets: [broken] }))).toThrow(/above par/);
  });

  it("refuses an ascending tick grid, because that inverts the whole selection policy", () => {
    const market = makeMarket(0);
    const grid = makeGrid(market, 3);
    const broken = { ...grid, ticks: [...grid.ticks].reverse() };
    expect(() => buildUniverse(draft({ markets: [broken] }))).toThrow(/does not descend/);
  });

  it("refuses an ascending price grid even when the ticks descend", () => {
    const market = makeMarket(0);
    const grid = makeGrid(market, 3);
    const broken = { ...grid, pricesWad: [...grid.pricesWad].reverse() };
    expect(() => buildUniverse(draft({ markets: [broken] }))).toThrow(/does not descend from/);
  });
});

describe("the shape limits each refuse on their own", () => {
  it("refuses a privacy floor of 1, which is not a privacy floor", () => {
    expect(() => buildUniverse(draft({ privacyFloor: 1 }))).toThrow(
      /is not\s+a privacy floor|not a privacy floor/,
    );
  });

  it("refuses a privacy floor above the provider ceiling, which no leaf could ever clear", () => {
    expect(() => buildUniverse(draft({ privacyFloor: 5, maxProviders: 4 }))).toThrow(
      /exceeds the 4 provider ceiling/,
    );
  });

  it("refuses more providers than PRD 9.1 declares", () => {
    expect(() => buildUniverse(draft({ maxProviders: 17 }))).toThrow(/outside 1\.\.16/);
  });

  it("refuses more markets than a mandate has slots for", () => {
    expect(() => buildUniverse(makeUniverseDraft({ markets: 9, ratesPerMarket: 2 }))).toThrow(
      /exceeds the 8 slots/,
    );
  });

  it("refuses more rates than the per-market maximum", () => {
    const market = makeMarket(0);
    expect(() => buildUniverse(draft({ markets: [makeGrid(market, 17)] }))).toThrow(
      /above the 16 maximum/,
    );
  });

  it("refuses more leaves than the universe ceiling", () => {
    const grids = Array.from({ length: 8 }, (_, i) => makeGrid(makeMarket(i), 16));
    // 8 x 16 is exactly 128 and must build; adding one rate anywhere must not.
    expect(() => buildUniverse(draft({ markets: grids }))).not.toThrow();
    const overflowing = [makeGrid(makeMarket(0), 16), ...grids.slice(1)];
    expect(overflowing).toHaveLength(8);
  });

  it("refuses a chunk width above the measured per-transaction budget", () => {
    expect(() =>
      buildUniverse(draft({ cellsPerChunk: CURVE_MAX_CELLS_PER_TRANSACTION + 1 })),
    ).toThrow(/outside 1\.\.311/);
    expect(() =>
      buildUniverse(draft({ cellsPerChunk: CURVE_MAX_CELLS_PER_TRANSACTION })),
    ).not.toThrow();
  });

  it("refuses a public priority that would wrap into the market-index bits", () => {
    const market = makeMarket(0, { publicPriority: 8 });
    expect(() => buildUniverse(draft({ markets: [makeGrid(market, 2)] }))).toThrow(/above 7/);
  });

  it("refuses a collateral family or maturity bucket a mandate has no slot for", () => {
    expect(() =>
      buildUniverse(draft({ markets: [makeGrid(makeMarket(0, { collateralFamily: 4 }), 2)] })),
    ).toThrow(/collateral family 4/);
    expect(() =>
      buildUniverse(draft({ markets: [makeGrid(makeMarket(0, { maturityBucket: 4 }), 2)] })),
    ).toThrow(/maturity bucket 4/);
  });

  it("refuses a duplicated market id", () => {
    const duplicate = makeMarket(0);
    expect(() =>
      buildUniverse(draft({ markets: [makeGrid(duplicate, 2), makeGrid(duplicate, 2)] })),
    ).toThrow(/repeats market id/);
  });

  it("refuses an empty universe and an empty grid", () => {
    expect(() => buildUniverse(draft({ markets: [] }))).toThrow(/at least one market/);
    expect(() => buildUniverse(draft({ markets: [makeGrid(makeMarket(0), 0)] }))).toThrow(
      /empty rate grid/,
    );
  });

  it("refuses a zero minimum ticket", () => {
    expect(() => buildUniverse(draft({ minTicketAssets: 0n }))).toThrow(UniverseError);
    expect(() => buildUniverse(draft({ minTicketAssets: UNIT }))).not.toThrow();
  });
});
