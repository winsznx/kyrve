/**
 * The plaintext reference model, tested against the behaviours the contract must exhibit.
 *
 * These are the checks that let demonstration 20 mean something. If this model were only tested
 * against itself, "Nox output matches the reference model" would prove that two implementations of
 * the same misunderstanding agree.
 *
 * Every test below states the PROPERTY it is about, not the numbers it happens to use, and each one
 * is paired with the negative case that would fire if the property stopped holding.
 */

import { describe, expect, it } from "vitest";

import {
  allocate,
  assertConservation,
  assertDustBound,
  buildUniverse,
  CURVE_RANK_CEILING,
  computeCurve,
  makeMandate,
  makeRequest,
  makeUniverseDraft,
  maturityTerm,
  type Provider,
  providerAddress,
  publicLeafRank,
  ReferenceModelError,
  safeDiv,
  safeMul,
  safeSub,
  selectWinner,
  UNIT,
  type Universe,
} from "../src/index.js";

function universeOf(markets: number, ratesPerMarket: number, overrides = {}): Universe {
  return buildUniverse(makeUniverseDraft({ markets, ratesPerMarket, ...overrides }));
}

function providers(
  count: number,
  mutate: (slot: number) => Partial<Provider> = () => ({}),
): Provider[] {
  return Array.from({ length: count }, (_, slot) => ({
    address: providerAddress(slot),
    mandate: makeMandate(),
    balance: 1_000n * UNIT,
    ...mutate(slot),
  }));
}

describe("safe operations model Nox's silent failures rather than throwing", () => {
  it("safeMul returns false AND zero on overflow, never a partial product", () => {
    const max = 2n ** 256n - 1n;
    expect(safeMul(max, 2n)).toEqual({ ok: false, value: 0n });
    expect(safeMul(3n, 4n)).toEqual({ ok: true, value: 12n });
  });

  it("safeDiv returns false AND zero on a zero denominator, and never saturates", () => {
    // Unsafe `div` SATURATES to the type maximum here. The engine never calls it, and this
    // assertion is what would notice if the model started modelling the wrong primitive.
    expect(safeDiv(100n, 0n)).toEqual({ ok: false, value: 0n });
    expect(safeDiv(7n, 2n)).toEqual({ ok: true, value: 3n });
  });

  it("safeSub returns false AND zero on underflow", () => {
    expect(safeSub(1n, 2n)).toEqual({ ok: false, value: 0n });
    expect(safeSub(5n, 2n)).toEqual({ ok: true, value: 3n });
  });
});

describe("the selection rank is positional, so no criterion can outrank a higher one", () => {
  const universe = universeOf(8, 16);

  it("the rate index dominates every public tie-break", () => {
    // The worst possible tail (priority 7, market 7) at rate index 3 must still beat the best
    // possible tail at rate index 4. If the packing widths were wrong this would invert.
    const rate3 = universe.leaves.findIndex((leaf) => leaf.rateIndex === 3);
    const rate4 = universe.leaves.findIndex((leaf) => leaf.rateIndex === 4);
    const worstAtRate3 = Math.max(
      ...universe.leaves.map((leaf, i) =>
        leaf.rateIndex === 3 ? publicLeafRank(universe, i) : -1,
      ),
    );
    const bestAtRate4 = Math.min(
      ...universe.leaves.map((leaf, i) =>
        leaf.rateIndex === 4 ? publicLeafRank(universe, i) : 1e9,
      ),
    );
    expect(rate3).toBeGreaterThanOrEqual(0);
    expect(rate4).toBeGreaterThanOrEqual(0);
    expect(worstAtRate3).toBeLessThan(bestAtRate4);
  });

  it("the maturity term sits between the rate index and the public tail (criterion 4)", () => {
    // One maturity step (128) must outweigh the whole tail (max (7<<4)|7 = 119) and never reach
    // one rate step (512). Both bounds are what put criterion 4 exactly where the policy says.
    const oneMaturityStep = maturityTerm(universe, 0, 1) - maturityTerm(universe, 0, 0);
    expect(Math.abs(oneMaturityStep)).toBe(128);
    const maxTail = Math.max(...universe.leaves.map((_, i) => publicLeafRank(universe, i) % 512));
    expect(maxTail).toBeLessThan(128);
  });

  it("every reachable score stays below the ceiling a fill-less leaf is pushed to", () => {
    const worst = Math.max(...universe.leaves.map((_, i) => publicLeafRank(universe, i))) + 3 * 128;
    expect(worst).toBeLessThan(CURVE_RANK_CEILING);
  });
});

describe("eligibility is a six-term conjunction and any one term excludes silently", () => {
  const universe = universeOf(2, 4);
  const request = makeRequest();

  const cases = [
    ["the provider disabled the market", { enabledFlags: [0, 1, 1, 1, 1, 1, 1, 1] }],
    ["the provider's market cap is below the minimum ticket", { marketCaps: [0n] }],
    ["the provider's collateral-family cap is below it", { collateralFamilyCaps: [0n] }],
    ["the provider's maturity-bucket cap is below it", { maturityBucketCaps: [0n] }],
  ] as const;

  for (const [why, mandateOverride] of cases) {
    it(`excludes market 0 when ${why}, and market 1 is untouched`, () => {
      const set = providers(3, (slot) =>
        slot === 0 ? { mandate: makeMandate(mandateOverride) } : {},
      );
      const result = computeCurve(universe, set, request);
      expect(result.cached[0]?.[0]?.capacity).toBe(0n);
      expect(result.cached[0]?.[0]?.count).toBe(0);
      // The exclusion is scoped to the market it belongs to, not to the provider.
      expect(result.cached[0]?.[1]?.capacity).toBeGreaterThan(0n);
      // And the other providers are entirely unaffected.
      expect(result.cached[1]?.[0]?.capacity).toBeGreaterThan(0n);
    });
  }

  it("excludes a provider on EVERY market when their confidential balance is short", () => {
    const set = providers(3, (slot) => (slot === 2 ? { balance: 0n } : {}));
    const result = computeCurve(universe, set, request);
    for (let market = 0; market < universe.markets.length; market += 1) {
      expect(result.cached[2]?.[market]?.capacity).toBe(0n);
    }
    expect(result.cached[2]?.[0]?.predicates.balanceSufficient).toBe(false);
  });

  it("excludes a market for everyone when the BORROWER disabled it", () => {
    const result = computeCurve(universe, providers(3), makeRequest({ enabledFlags: [0, 1] }));
    for (let slot = 0; slot < 3; slot += 1) {
      expect(result.cached[slot]?.[0]?.capacity).toBe(0n);
      expect(result.cached[slot]?.[1]?.capacity).toBeGreaterThan(0n);
    }
  });
});

describe("the privacy floor zeroes a leaf instead of reporting anything", () => {
  it("a leaf with fewer eligible providers than the floor carries encrypted ZERO capacity", () => {
    const universe = universeOf(1, 4, { privacyFloor: 3 });
    // Two providers can serve rate index 0; the third has a minimum of 3, so rate 0 has two
    // eligible providers and rate 3 has three.
    const set = providers(3, (slot) =>
      slot === 2 ? { mandate: makeMandate({ minRateIndexes: [3] }) } : {},
    );
    const result = computeCurve(universe, set, makeRequest());

    const rate0 = result.leaves.find((leaf) => leaf.rateIndex === 0)!;
    const rate3 = result.leaves.find((leaf) => leaf.rateIndex === 3)!;

    expect(rate0.accumulatedCount).toBe(2);
    expect(rate0.floorPassed).toBe(false);
    expect(rate0.capacity).toBe(0n);
    expect(rate0.fill).toBe(0n);

    expect(rate3.accumulatedCount).toBe(3);
    expect(rate3.floorPassed).toBe(true);
    expect(rate3.capacity).toBeGreaterThan(0n);

    // The cheapest rate lost to the floor, so the winner is the rate that cleared it — and that is
    // the whole point: the borrower is never told a cheaper leaf existed.
    expect(result.winner?.rateIndex).toBe(3);
  });

  it("no quote at all when every leaf is below the floor, and no reason is produced", () => {
    const universe = universeOf(1, 4, { privacyFloor: 4 });
    const result = computeCurve(universe, providers(3), makeRequest());
    expect(result.winner).toBeNull();
    expect(result.published.quoteReady).toBe(false);
    expect(result.published.aggregateFillAmount).toBe(0n);
    // The published surface carries no field that could say WHY. That is the invariant.
    expect(Object.keys(result.published).sort()).toEqual([
      "aggregateFillAmount",
      "privacyFloorPassed",
      "quoteReady",
      "selectedMarketIndex",
      "selectedRateIndex",
    ]);
  });
});

describe("the rate window is two-sided", () => {
  const universe = universeOf(1, 8);

  it("a provider below their own minimum rate index does not contribute", () => {
    const set = providers(3, (slot) =>
      slot === 0 ? { mandate: makeMandate({ minRateIndexes: [5] }) } : {},
    );
    const result = computeCurve(universe, set, makeRequest());
    expect(result.leaves[0]?.accumulatedCount).toBe(2);
    expect(result.leaves[5]?.accumulatedCount).toBe(3);
  });

  it("a leaf above the borrower's maximum rate index is zeroed wholesale", () => {
    const result = computeCurve(universe, providers(3), makeRequest({ maxRateIndexes: [2] }));
    expect(result.leaves[2]?.capacity).toBeGreaterThan(0n);
    expect(result.leaves[3]?.accumulatedCapacity).toBeGreaterThan(0n);
    // Gating the leaf total is arithmetically identical to gating every cell.
    expect(result.leaves[3]?.capacity).toBe(0n);
    expect(result.leaves[3]?.fill).toBe(0n);
  });
});

describe("the borrower's size bounds are applied in the order the contract applies them", () => {
  it("the fill is capped at the desired size BEFORE the minimum is tested", () => {
    const universe = universeOf(1, 2);
    // Capacity 1,500 units; desired 600; minimum 700. Capping first gives 600, which is BELOW the
    // minimum, so there is no quote. Testing the minimum first against 1,500 would wrongly accept.
    const result = computeCurve(
      universe,
      providers(3),
      makeRequest({ desiredAssets: 600n * UNIT, minimumAssets: 700n * UNIT }),
    );
    expect(result.leaves[0]?.capacity).toBeGreaterThan(600n * UNIT);
    expect(result.leaves[0]?.fill).toBe(0n);
    expect(result.winner).toBeNull();
  });

  it("a fill at exactly the minimum is accepted", () => {
    const universe = universeOf(1, 2);
    const result = computeCurve(
      universe,
      providers(3),
      makeRequest({ desiredAssets: 300n * UNIT, minimumAssets: 300n * UNIT }),
    );
    expect(result.leaves[0]?.fill).toBe(300n * UNIT);
  });
});

describe("allocation is pro-rata, floors, and conserves", () => {
  it("shares are proportional to contribution and sum to the published aggregate", () => {
    const universe = universeOf(1, 2);
    const set = providers(3, (slot) => ({
      mandate: makeMandate({ marketCaps: [BigInt(slot + 1) * 100n * UNIT] }),
    }));
    const result = computeCurve(universe, set, makeRequest({ desiredAssets: 500n * UNIT }));

    const summed = result.providers.reduce((total, outcome) => total + outcome.reserved, 0n);
    expect(summed).toBe(result.published.aggregateFillAmount);

    // Contributions 100 : 200 : 300, so the shares must be ordered the same way.
    const shares = result.providers.map((outcome) => outcome.allocation);
    expect(shares[0]!).toBeLessThan(shares[1]!);
    expect(shares[1]!).toBeLessThan(shares[2]!);

    assertConservation(set, result.providers);
    assertDustBound(result);
  });

  it("dust is the flooring residue and never exceeds the contributing provider COUNT", () => {
    const universe = universeOf(1, 2);
    // Deliberately awkward: a fill that does not divide evenly by the capacity.
    const set = providers(3, (slot) => ({
      mandate: makeMandate({ marketCaps: [BigInt(7 + slot * 11) * UNIT + BigInt(slot) * 3n] }),
    }));
    const result = computeCurve(
      universe,
      set,
      makeRequest({ desiredAssets: 13n * UNIT + 7n, minimumAssets: 1n }),
    );

    expect(result.dustResidue).toBeGreaterThanOrEqual(0n);
    assertDustBound(result);
    expect(result.winner!.fill - result.published.aggregateFillAmount).toBe(result.dustResidue);
  });

  it("a zero-capacity winner cannot occur, and a zero denominator would allocate zero if it did", () => {
    // safeDiv by zero is a false flag and a zero result, NOT a saturation and not a revert. This
    // asserts the model threads that flag rather than producing a plausible-looking number.
    const set = providers(2);
    const outcomes = allocate(set, [[{ capacity: 5n, count: 1, predicates: {} as never }]], {
      leafIndex: 0,
      marketIndex: 0,
      rateIndex: 0,
      fill: 100n,
      capacity: 0n,
      floorPassed: true,
    });
    expect(outcomes.every((outcome) => outcome.allocation === 0n)).toBe(true);
  });

  it("a short snapshot reserves encrypted zero and leaves the remaining balance untouched", () => {
    const universe = universeOf(1, 2);
    const set = providers(3);
    const result = computeCurve(universe, set, makeRequest());
    // Re-run the reservation against a snapshot smaller than the allocation.
    const starved = set.map((provider) => ({ ...provider, balance: 1n }));
    const outcomes = allocate(starved, result.cached, result.winner);
    for (const outcome of outcomes) {
      if (outcome.allocation > 1n) {
        expect(outcome.reserved).toBe(0n);
        expect(outcome.remaining).toBe(1n);
      }
    }
  });
});

describe("ties resolve to the lowest leaf index, deterministically", () => {
  it("two leaves with identical scores select the earlier one", () => {
    const leaves = [
      {
        effectiveScore: 100,
        fill: 5n,
        leafIndex: 0,
        marketIndex: 0,
        rateIndex: 0,
        capacity: 5n,
        floorPassed: true,
      },
      {
        effectiveScore: 100,
        fill: 5n,
        leafIndex: 1,
        marketIndex: 1,
        rateIndex: 0,
        capacity: 5n,
        floorPassed: true,
      },
    ] as never;
    expect(selectWinner(leaves)?.leafIndex).toBe(0);
  });

  it("the same universe and inputs produce the same winner every time", () => {
    const universe = universeOf(4, 8);
    const set = providers(6, (slot) => ({
      mandate: makeMandate({ minRateIndexes: [slot % 4, slot % 3, 0, 1] }),
      balance: BigInt(100 + slot * 37) * UNIT,
    }));
    const request = makeRequest({ preferredMaturityIndex: 2 });
    const first = computeCurve(universe, set, request);
    for (let i = 0; i < 5; i += 1) {
      expect(computeCurve(universe, set, request).winner).toEqual(first.winner);
    }
  });
});

describe("property sweep over randomised but reproducible universes", () => {
  // A tiny deterministic PRNG. `Math.random` would make a failure unreproducible, and a failing
  // property test nobody can re-run is a failing test that gets deleted.
  function rng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };
  }

  it("holds every invariant across 200 randomised epochs", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const next = rng(seed);
      const markets = 1 + Math.floor(next() * 4);
      const rates = 1 + Math.floor(next() * 8);
      const providerCount = 1 + Math.floor(next() * 8);
      const floor = 2 + Math.floor(next() * 3);

      const universe = buildUniverse(
        makeUniverseDraft({
          markets,
          ratesPerMarket: rates,
          privacyFloor: Math.min(floor, Math.max(2, providerCount)),
          maxProviders: Math.max(providerCount, 2),
          label: `sweep-${seed}`,
        }),
      );

      const set: Provider[] = Array.from({ length: providerCount }, (_, slot) => ({
        address: providerAddress(slot),
        mandate: makeMandate({
          minRateIndexes: Array.from({ length: 8 }, () => Math.floor(next() * rates)),
          enabledFlags: Array.from({ length: 8 }, () => (next() > 0.2 ? 1 : 0)),
          marketCaps: Array.from({ length: 8 }, () => BigInt(Math.floor(next() * 500)) * UNIT),
        }),
        balance: BigInt(Math.floor(next() * 2_000)) * UNIT,
      }));

      const request = makeRequest({
        desiredAssets: BigInt(1 + Math.floor(next() * 900)) * UNIT,
        minimumAssets: BigInt(Math.floor(next() * 100)) * UNIT,
        maxRateIndexes: Array.from({ length: 8 }, () => Math.floor(next() * rates)),
        enabledFlags: Array.from({ length: 8 }, () => (next() > 0.15 ? 1 : 0)),
        preferredMaturityIndex: Math.floor(next() * 4),
      });

      const result = computeCurve(universe, set, request);

      assertConservation(set, result.providers);
      assertDustBound(result);

      // The published aggregate is exactly what was reserved — never what was asked for.
      const reserved = result.providers.reduce((total, outcome) => total + outcome.reserved, 0n);
      expect(reserved).toBe(result.published.aggregateFillAmount);

      // A quote is ready only when a leaf actually won with a non-zero fill.
      expect(result.published.quoteReady).toBe(result.winner !== null && result.winner.fill > 0n);

      if (result.winner !== null) {
        // Never more than the borrower asked for, never less than they required.
        expect(result.winner.fill).toBeLessThanOrEqual(request.desiredAssets);
        expect(result.winner.fill).toBeGreaterThanOrEqual(request.minimumAssets);
        // The winner cleared the privacy floor. A leaf below it carries zero and cannot win.
        expect(result.winner.floorPassed).toBe(true);
        // The winning leaf is the lowest effective score, and ties went to the lowest index.
        const best = Math.min(...result.leaves.map((leaf) => leaf.effectiveScore));
        const firstBest = result.leaves.find((leaf) => leaf.effectiveScore === best)!;
        expect(result.winner.leafIndex).toBe(firstBest.leafIndex);
      }
    }
  });
});

describe("the model refuses malformed input rather than guessing", () => {
  it("rejects a mandate whose arrays are not the fixed length", () => {
    const universe = universeOf(4, 4);
    const set = providers(2, () => ({ mandate: { ...makeMandate(), marketCaps: [1n] } }));
    expect(() => computeCurve(universe, set, makeRequest())).toThrow(ReferenceModelError);
  });

  it("rejects more providers than the universe permits", () => {
    const universe = universeOf(1, 2, { maxProviders: 2 });
    expect(() => computeCurve(universe, providers(3), makeRequest())).toThrow(
      /exceeds the universe ceiling/,
    );
  });

  it("rejects an epoch with no providers", () => {
    expect(() => computeCurve(universeOf(1, 2), [], makeRequest())).toThrow(
      /at least one provider/,
    );
  });
});
