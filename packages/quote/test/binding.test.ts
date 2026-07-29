/**
 * The differential test that keeps `@kyrve/quote` and `contracts/kyrve` from drifting apart.
 *
 * The fixture is generated FROM the Solidity by
 * `contracts/script/ExportSettlementFixtures.s.sol`. Every value in it is a decimal string, because
 * JSON numbers are IEEE-754 doubles and would lose precision above 2^53 — which is well below a
 * loan-token amount in 18 decimals.
 *
 * A failure here means one of two things and both are serious: the keeper would build offers whose
 * `offer.group` no ratifier recognises, or it would build offers whose hash no ratifier accepts.
 * Neither is visible from either side alone, because each side agrees with itself.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { encodeAbiParameters, type Hex, keccak256 } from "viem";
import { describe, expect, it } from "vitest";

import {
  deploymentIdFor,
  deriveQuoteSize,
  planActivation,
  type QuoteProvenance,
  quoteIdFor,
  seriesIdFor,
} from "../src/index.js";

interface Fixture {
  readonly chainId: string;
  readonly registry: Hex;
  readonly midnight: Hex;
  readonly vault: Hex;
  readonly ratifier: Hex;
  readonly taker: Hex;
  readonly loanToken: Hex;
  readonly deploymentId: Hex;
  readonly seriesId: Hex;
  readonly marketId: Hex;
  readonly marketStructHash: Hex;
  readonly epochId: Hex;
  readonly graphRoot: Hex;
  readonly requestId: Hex;
  readonly universeId: Hex;
  readonly maturity: string;
  readonly continuousFeeCap: string;
  readonly start: string;
  readonly labels: readonly string[];
  readonly aggregates: readonly string[];
  readonly ticks: readonly string[];
  readonly prices: readonly string[];
  readonly units: readonly string[];
  readonly buyerAssets: readonly string[];
  readonly expiries: readonly string[];
  readonly maxPendingFees: readonly string[];
  readonly marketIndexes: readonly string[];
  readonly rateIndexes: readonly string[];
  readonly leafIndexes: readonly string[];
  readonly quoteIds: readonly Hex[];
  readonly offerHashes: readonly Hex[];
}

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures", "quote-binding.json"), "utf8"),
) as Fixture;

function at(values: readonly string[], index: number): string {
  const value = values[index];
  if (value === undefined) throw new Error(`fixture is missing index ${index}`);
  return value;
}

function provenanceFor(index: number): QuoteProvenance {
  return {
    epochId: fixture.epochId,
    graphRoot: fixture.graphRoot,
    requestId: fixture.requestId,
    universeId: fixture.universeId,
    deploymentId: fixture.deploymentId,
    marketStructHash: fixture.marketStructHash,
    aggregateFillAmount: BigInt(at(fixture.aggregates, index)),
    tick: Number(at(fixture.ticks, index)),
    marketIndex: Number(at(fixture.marketIndexes, index)),
    rateIndex: Number(at(fixture.rateIndexes, index)),
    leafIndex: Number(at(fixture.leafIndexes, index)),
  };
}

describe("the quote id agrees with KyrveQuoteId.compute", () => {
  it("covers every fixture case", () => {
    expect(fixture.labels.length).toBeGreaterThan(0);

    fixture.labels.forEach((label, index) => {
      const provenance = provenanceFor(index);
      const quoteId = quoteIdFor(
        {
          offerHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          marketId: fixture.marketId,
          exactUnits: BigInt(at(fixture.units, index)),
          expectedBuyerAssets: BigInt(at(fixture.buyerAssets, index)),
          maxPendingFee: BigInt(at(fixture.maxPendingFees, index)),
          expiry: BigInt(at(fixture.expiries, index)),
          activatedAt: 0n,
          status: 1,
          taker: fixture.taker,
          vault: fixture.vault,
          ratifier: fixture.ratifier,
        },
        provenance,
      );
      expect(quoteId, `quote id for ${label}`).toBe(fixture.quoteIds[index]);
    });
  });

  it("changes when any single bound term changes", () => {
    const base = provenanceFor(0);
    const execution = {
      offerHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
      marketId: fixture.marketId,
      exactUnits: BigInt(at(fixture.units, 0)),
      expectedBuyerAssets: BigInt(at(fixture.buyerAssets, 0)),
      maxPendingFee: BigInt(at(fixture.maxPendingFees, 0)),
      expiry: BigInt(at(fixture.expiries, 0)),
      activatedAt: 0n,
      status: 1 as const,
      taker: fixture.taker,
      vault: fixture.vault,
      ratifier: fixture.ratifier,
    };
    const reference = quoteIdFor(execution, base);

    // Every one of these is a term the PRD requires a quote to be bound to. If any of them could
    // change without moving the id, the binding would be a label rather than a constraint.
    const mutations: readonly QuoteProvenance[] = [
      { ...base, epochId: keccak256("0x01") },
      { ...base, graphRoot: keccak256("0x02") },
      { ...base, requestId: keccak256("0x03") },
      { ...base, universeId: keccak256("0x04") },
      { ...base, deploymentId: keccak256("0x05") },
      { ...base, marketStructHash: keccak256("0x06") },
      { ...base, aggregateFillAmount: base.aggregateFillAmount + 1n },
      { ...base, tick: base.tick + 4 },
      { ...base, marketIndex: base.marketIndex + 1 },
      { ...base, rateIndex: base.rateIndex + 1 },
      { ...base, leafIndex: base.leafIndex + 1 },
    ];
    for (const mutated of mutations) {
      expect(quoteIdFor(execution, mutated)).not.toBe(reference);
    }

    expect(quoteIdFor({ ...execution, exactUnits: execution.exactUnits + 1n }, base)).not.toBe(
      reference,
    );
    expect(
      quoteIdFor({ ...execution, expectedBuyerAssets: execution.expectedBuyerAssets + 1n }, base),
    ).not.toBe(reference);
    expect(quoteIdFor({ ...execution, maxPendingFee: 7n }, base)).not.toBe(reference);
    expect(quoteIdFor({ ...execution, expiry: execution.expiry + 1n }, base)).not.toBe(reference);
    expect(quoteIdFor({ ...execution, taker: fixture.vault }, base)).not.toBe(reference);
    expect(quoteIdFor({ ...execution, vault: fixture.taker }, base)).not.toBe(reference);
    expect(quoteIdFor({ ...execution, ratifier: fixture.taker }, base)).not.toBe(reference);
  });

  it("does not fold in the offer hash, which would be circular", () => {
    const provenance = provenanceFor(0);
    const execution = {
      marketId: fixture.marketId,
      exactUnits: BigInt(at(fixture.units, 0)),
      expectedBuyerAssets: BigInt(at(fixture.buyerAssets, 0)),
      maxPendingFee: BigInt(at(fixture.maxPendingFees, 0)),
      expiry: BigInt(at(fixture.expiries, 0)),
      activatedAt: 0n,
      status: 1 as const,
      taker: fixture.taker,
      vault: fixture.vault,
      ratifier: fixture.ratifier,
    };
    expect(quoteIdFor({ ...execution, offerHash: keccak256("0xaa") }, provenance)).toBe(
      quoteIdFor({ ...execution, offerHash: keccak256("0xbb") }, provenance),
    );
  });
});

describe("the offer agrees with QuoteActivator._buildOffer", () => {
  it("reproduces every fixture offer hash", () => {
    fixture.labels.forEach((label, index) => {
      const plan = planActivation(
        {
          marketId: fixture.marketId,
          exactUnits: BigInt(at(fixture.units, index)),
          expectedBuyerAssets: BigInt(at(fixture.buyerAssets, index)),
          maxPendingFee: BigInt(at(fixture.maxPendingFees, index)),
          expiry: BigInt(at(fixture.expiries, index)),
          taker: fixture.taker,
          vault: fixture.vault,
          ratifier: fixture.ratifier,
        },
        provenanceFor(index),
        {
          market: {
            chainId: BigInt(fixture.chainId),
            midnight: fixture.midnight,
            loanToken: fixture.loanToken,
            collateralParams: [
              {
                token: "0x0000000000000000000000000000000000000A07",
                lltv: 770000000000000000n,
                liquidationCursor: 300000000000000000n,
                oracle: "0x0000000000000000000000000000000000000b08",
              },
            ],
            maturity: BigInt(fixture.maturity),
            rcfThreshold: 0n,
            enterGate: "0x0000000000000000000000000000000000000000",
            liquidatorGate: "0x0000000000000000000000000000000000000000",
          },
          vault: fixture.vault,
          ratifier: fixture.ratifier,
          tick: BigInt(at(fixture.ticks, index)),
          exactUnits: BigInt(at(fixture.units, index)),
          start: BigInt(fixture.start),
          expiry: BigInt(at(fixture.expiries, index)),
          continuousFeeCap: BigInt(fixture.continuousFeeCap),
        },
      );

      expect(plan.quoteId, `quote id for ${label}`).toBe(fixture.quoteIds[index]);
      expect(plan.offerHash, `offer hash for ${label}`).toBe(fixture.offerHashes[index]);
      expect(plan.offer.group, "the group IS the quote id").toBe(plan.quoteId);
      expect(plan.offer.callbackData, "the callback data carries the quote id").toBe(
        encodeAbiParameters([{ type: "bytes32" }], [plan.quoteId]),
      );
      expect(plan.offer.maxAssets, "exactly one of maxUnits/maxAssets is non-zero").toBe(0n);
    });
  });
});

describe("derived identifiers", () => {
  it("reproduces KyrveQuoteRegistry.DEPLOYMENT_ID", () => {
    expect(deploymentIdFor(BigInt(fixture.chainId), fixture.registry, fixture.midnight)).toBe(
      fixture.deploymentId,
    );
  });

  it("reproduces KyrveSeriesFactory.seriesIdFor", () => {
    expect(seriesIdFor(fixture.deploymentId, fixture.marketId)).toBe(fixture.seriesId);
  });
});

describe("sizing agrees with QuoteActivator._deriveExecution", () => {
  it("reproduces units and buyer assets for every case", () => {
    fixture.labels.forEach((label, index) => {
      const size = deriveQuoteSize(
        BigInt(at(fixture.aggregates, index)),
        BigInt(at(fixture.prices, index)),
        Number(at(fixture.ticks, index)),
      );
      expect(size.units, `units for ${label}`).toBe(BigInt(at(fixture.units, index)));
      expect(size.buyerAssets, `buyer assets for ${label}`).toBe(
        BigInt(at(fixture.buyerAssets, index)),
      );
      expect(
        size.buyerAssets,
        "the maker never owes more than providers reserved",
      ).toBeLessThanOrEqual(BigInt(at(fixture.aggregates, index)));
    });
  });

  /**
   * The reference fixture, stated as an assertion rather than as a comment.
   *
   * A winning leaf whose theoretical capacity is 300,000,000 reserves 299,999,999, because every
   * pro-rata share is floored. Sizing against the capacity would produce a larger offer than
   * providers ever committed to.
   */
  it("sizes against the reserved aggregate and never against the leaf capacity", () => {
    const index = fixture.labels.indexOf("reference-dust");
    expect(index, "the reference-dust case must exist").toBeGreaterThanOrEqual(0);

    const aggregate = BigInt(at(fixture.aggregates, index));
    const price = BigInt(at(fixture.prices, index));
    const capacity = 300_000_000n;

    expect(aggregate).toBe(299_999_999n);
    expect(capacity - aggregate).toBe(1n);

    const reserved = deriveQuoteSize(aggregate, price, Number(at(fixture.ticks, index)));
    const fromCapacity = deriveQuoteSize(capacity, price, Number(at(fixture.ticks, index)));

    // Sizing from the capacity produces a STRICTLY LARGER face value: a different offer, whose
    // exact-fill size the reservations were never computed for. That is the harm, and it does not
    // depend on whether the two happen to round to the same asset amount.
    expect(fromCapacity.units).toBeGreaterThan(reserved.units);
    expect(reserved.buyerAssets).toBeLessThanOrEqual(aggregate);
    expect(reserved.residue).toBe(aggregate - reserved.buyerAssets);
  });
});
