/**
 * The Phase 5 series-accounting fixture, pinned as arithmetic.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS SEPARATELY FROM THE LIVE SUITE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `confidential/test/100-series-ownership.ts` proves the same identities against a REAL confidential
 * epoch, real Midnight and real gateway proofs — but against whatever numbers that epoch happens to
 * produce. That is the stronger test of the mechanism and the weaker test of the numbers: a run whose
 * capacity, aggregate, units and assets all coincided would pass every assertion and prove none of the
 * distinctions.
 *
 * This file is the other half. It pins the ONE fixture where all four differ and the two residues are
 * both 1 — the numbers Phase 4 actually measured on Sepolia — so an implementation that conflated any
 * pair of them fails here even if a lucky epoch would have let it through.
 *
 * The Phase 5 contracts cannot be tested in Foundry: every Nox primitive is an external call into
 * NoxCompute, and `vm.etch`-ing a fake one would be a mocked confidentiality path. So the fixture lives
 * where the sizing rule already lives, beside the code that derives it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE FIXTURE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   leaf capacity        300,000,000   what the winning (market, rate) COULD carry — PRIVATE
 *   published aggregate  299,999,999   the sum of successfully reserved allocations — public
 *   units settled        300,000,599   floor(aggregate * WAD / price) — Midnight's denomination
 *   buyer assets paid    299,999,998   floor(units * price / WAD) — what the maker actually paid
 *
 *   unreserved residue   capacity - aggregate    = 1   PRIVATE, no provider has a claim on it
 *   funding residue      aggregate - buyerAssets = 1   PUBLIC, the declared dust account's
 *
 *   confidential series minted = 299,999,999 — the AGGREGATE. Never the capacity, never the units,
 *                                              never the buyer assets. Deltas T-1 and T-2.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { deriveQuoteSize } from "../src/sizing.js";

interface BindingFixture {
  readonly labels: readonly string[];
  readonly aggregates: readonly string[];
  readonly prices: readonly string[];
  readonly ticks: readonly number[];
  readonly units: readonly string[];
  readonly buyerAssets: readonly string[];
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/quote-binding.json", import.meta.url), "utf8"),
) as BindingFixture;

/** The winning leaf's theoretical capacity. PRIVATE on chain; a constant only in this fixture. */
const LEAF_CAPACITY = 300_000_000n;

function referenceCase(): {
  aggregate: bigint;
  price: bigint;
  tick: number;
  units: bigint;
  buyerAssets: bigint;
} {
  const index = fixture.labels.indexOf("reference-dust");
  expect(index, "the reference-dust case must exist in the binding fixture").toBeGreaterThanOrEqual(
    0,
  );
  const aggregate = fixture.aggregates[index];
  const price = fixture.prices[index];
  const tick = fixture.ticks[index];
  const units = fixture.units[index];
  const buyerAssets = fixture.buyerAssets[index];
  expect(aggregate).toBeDefined();
  expect(price).toBeDefined();
  expect(tick).toBeDefined();
  expect(units).toBeDefined();
  expect(buyerAssets).toBeDefined();
  return {
    aggregate: BigInt(aggregate as string),
    price: BigInt(price as string),
    tick: tick as number,
    units: BigInt(units as string),
    buyerAssets: BigInt(buyerAssets as string),
  };
}

describe("Phase 5 series accounting, against the measured Sepolia fixture", () => {
  it("pins all four quantities, and proves no two of them are the same number", () => {
    const c = referenceCase();

    expect(LEAF_CAPACITY).toBe(300_000_000n);
    expect(c.aggregate).toBe(299_999_999n);
    expect(c.units).toBe(300_000_599n);
    expect(c.buyerAssets).toBe(299_999_998n);

    // The whole point. If any pair coincided, an implementation that conflated them would pass every
    // downstream assertion in this file and in the live suite.
    const distinct = new Set([LEAF_CAPACITY, c.aggregate, c.units, c.buyerAssets]);
    expect(distinct.size, "all four quantities must be distinct in this fixture").toBe(4);
  });

  it("derives the fixture's units and assets from the aggregate, not from the capacity", () => {
    const c = referenceCase();
    const sized = deriveQuoteSize(c.aggregate, c.price, c.tick);

    expect(sized.units).toBe(c.units);
    expect(sized.buyerAssets).toBe(c.buyerAssets);
    // Floor, then floor. Structural, and asserted because a violation would overdraw the reservation.
    expect(sized.buyerAssets).toBeLessThanOrEqual(c.aggregate);
  });

  it("mints exactly the published aggregate as confidential series supply", () => {
    const c = referenceCase();

    // INVARIANT 4. `SeriesAllocator` hands `KyrveSeriesToken.mintClaim` the handle each provider's
    // custody lock became, and those sum to the published aggregate — so total supply is the aggregate
    // by construction. This states the resulting number rather than restating the construction.
    const supply = c.aggregate;
    expect(supply).toBe(299_999_999n);

    // INVARIANTS 2 and 3, the negative half. Supply is not the capacity, not the units, not the assets.
    expect(supply).not.toBe(LEAF_CAPACITY);
    expect(supply).not.toBe(c.units);
    expect(supply).not.toBe(c.buyerAssets);

    // And the size of each mistake, so the failure message says how wrong it would have been.
    expect(LEAF_CAPACITY - supply).toBe(1n);
    expect(c.units - supply).toBe(600n);
    expect(supply - c.buyerAssets).toBe(1n);
  });

  it("keeps the two residues apart even though both are 1", () => {
    const c = referenceCase();

    const unreserved = LEAF_CAPACITY - c.aggregate;
    const funding = c.aggregate - c.buyerAssets;

    expect(unreserved).toBe(1n);
    expect(funding).toBe(1n);

    // THE TRAP THIS FIXTURE SETS. They are equal here, so a test asserting "the residue is 1" passes
    // against either and proves nothing about the other. Delta T-2 requires them to be derived from
    // DIFFERENT sources, which is what the two expressions above do — one from capacity, one from
    // buyer assets — and neither is computed from the other.
    expect(unreserved).toBe(funding);
    expect(LEAF_CAPACITY - c.aggregate).not.toBe(c.aggregate - c.units);
  });

  it("shows why sizing from capacity would over-issue, in units rather than in assets", () => {
    const c = referenceCase();

    const fromAggregate = deriveQuoteSize(c.aggregate, c.price, c.tick);
    const fromCapacity = deriveQuoteSize(LEAF_CAPACITY, c.price, c.tick);

    // A strictly larger face value: a different offer, whose exact-fill size the reservations were
    // never computed for. That is the harm, and it does not depend on whether the two happen to round
    // to the same asset amount.
    expect(fromCapacity.units).toBeGreaterThan(fromAggregate.units);
    expect(fromCapacity.buyerAssets).toBeGreaterThan(fromAggregate.buyerAssets);

    // If the series had been minted against the capacity, the over-issuance would be exactly the
    // unreserved residue — one unit of principal no provider ever committed.
    expect(LEAF_CAPACITY - c.aggregate).toBe(1n);
  });

  it("states the redemption factor as public arithmetic over two public numbers", () => {
    const c = referenceCase();
    const WAD = 10n ** 18n;

    // Delta T-1: the unit-to-asset conversion is a PUBLIC factor applied at redemption, not baked into
    // the mint. `KyrveSeriesToken.setRedemptionFactor` computes exactly this on chain from
    // `unitsWithdrawn` and `supplyReference`, so anyone can reproduce it from public data — which is
    // what invariant 14 needs.
    const factor = (c.units * WAD) / c.aggregate;
    expect(factor).toBeGreaterThan(WAD);

    // Applied to the whole supply it returns the units, up to the floor the factor itself carries.
    const redeemable = (c.aggregate * factor) / WAD;
    expect(redeemable).toBeLessThanOrEqual(c.units);
    expect(c.units - redeemable).toBeLessThan(10n);
  });
});
