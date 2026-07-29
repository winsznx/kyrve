import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeAbiParameters, type Hex, keccak256 } from "viem";
import { describe, expect, it } from "vitest";

import { encodeMarket, encodeOffer, marketId, marketParamsAddress, offerHash } from "../src/ids.js";
import { MARKET_ABI, type Market, OFFER_ABI, type Offer } from "../src/types.js";

interface MarketFixture {
  anchor: string;
  chainId: string;
  midnight: Hex;
  marketKeys: string[];
  marketIds: Hex[];
  encodedMarkets: Hex[];
  encodedOffer: Hex;
  offerHash: Hex;
}

const fixture: MarketFixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/markets.json", import.meta.url)), "utf8"),
);

const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** Decodes with the same ABI definition the package encodes with, so this is a true round-trip. */
function decodeMarket(encoded: Hex): Market {
  return decodeAbiParameters([MARKET_ABI], encoded)[0] as unknown as Market;
}

const markets = fixture.encodedMarkets.map(decodeMarket);

describe("the Market ABI layout matches the pinned release", () => {
  it("round-trips every fixture market to the exact bytes Solidity produced", () => {
    for (const [i, market] of markets.entries()) {
      expect(encodeMarket(market)).toBe(fixture.encodedMarkets[i]);
    }
  });

  it("decodes the fields Kyrve depends on", () => {
    for (const market of markets) {
      expect(market.chainId).toBe(BigInt(fixture.chainId));
      expect(market.midnight.toLowerCase()).toBe(fixture.midnight.toLowerCase());
      expect(market.collateralParams.length).toBeGreaterThanOrEqual(1);
      expect(market.enterGate).toBe(ZERO);
      expect(market.liquidatorGate).toBe(ZERO);
    }
  });

  it("keeps the multi-collateral market sorted by token address, as touchMarket requires", () => {
    const multi = markets.find((m) => m.collateralParams.length > 1);
    expect(multi).toBeDefined();
    const tokens = multi?.collateralParams.map((c) => c.token.toLowerCase()) ?? [];
    expect(tokens).toEqual([...tokens].sort());
  });
});

/**
 * The load-bearing test for this package.
 *
 * `IdLib.toId` is a CREATE2 address hash of an SSTORE2 deployment, not the obvious
 * `keccak256(abi.encode(market))`. Getting it wrong produces ids that match nothing on chain,
 * silently. The expected values here are what `touchMarket` actually returned.
 */
describe("marketId reproduces what touchMarket returned", () => {
  it("derives all four launch market ids exactly", () => {
    for (const [i, market] of markets.entries()) {
      expect(marketId(market), `market ${fixture.marketKeys[i]}`).toBe(fixture.marketIds[i]);
    }
  });

  it("is NOT keccak256(abi.encode(market)), the obvious wrong derivation", () => {
    for (const [i, encoded] of fixture.encodedMarkets.entries()) {
      expect(keccak256(encoded)).not.toBe(fixture.marketIds[i]);
    }
  });

  it("gives every market a distinct id", () => {
    expect(new Set(fixture.marketIds).size).toBe(fixture.marketIds.length);
  });

  it("binds the id to the deploying Midnight, so ids cannot be replayed across deployments", () => {
    const market = markets[0] as Market;
    const elsewhere = marketId({
      ...market,
      midnight: "0x9999999999999999999999999999999999999999",
    });
    expect(elsewhere).not.toBe(fixture.marketIds[0]);
  });

  it("changes when any market parameter changes", () => {
    const market = markets[0] as Market;
    expect(marketId({ ...market, maturity: market.maturity + 1n })).not.toBe(fixture.marketIds[0]);
    expect(marketId({ ...market, rcfThreshold: 1n })).not.toBe(fixture.marketIds[0]);
  });

  it("locates the market parameters at the last 20 bytes of the id", () => {
    for (const id of fixture.marketIds) {
      const address = marketParamsAddress(id);
      expect(address).toHaveLength(42);
      expect(id.toLowerCase().endsWith(address.slice(2).toLowerCase())).toBe(true);
    }
  });
});

describe("offerHash reproduces what the ratifier binds to", () => {
  const offer = decodeAbiParameters([OFFER_ABI], fixture.encodedOffer)[0] as unknown as Offer;

  it("round-trips the offer encoding", () => {
    expect(encodeOffer(offer)).toBe(fixture.encodedOffer);
  });

  it("matches the hash Solidity produced", () => {
    expect(offerHash(offer)).toBe(fixture.offerHash);
    expect(keccak256(fixture.encodedOffer)).toBe(fixture.offerHash);
  });

  it("changes when any single offer field changes", () => {
    const original = offerHash(offer);
    const mutations: Array<[string, Offer]> = [
      ["tick", { ...offer, tick: offer.tick + 4n }],
      ["expiry", { ...offer, expiry: offer.expiry + 1n }],
      ["callback", { ...offer, callback: ZERO }],
      ["maxUnits", { ...offer, maxUnits: offer.maxUnits * 2n }],
      ["maker", { ...offer, maker: ZERO }],
      ["ratifier", { ...offer, ratifier: ZERO }],
      ["reduceOnly", { ...offer, reduceOnly: !offer.reduceOnly }],
      ["group", { ...offer, group: keccak256("0xdeadbeef") }],
      // The embedded market is covered too, which is what stops a market swap.
      [
        "market.maturity",
        { ...offer, market: { ...offer.market, maturity: offer.market.maturity + 1n } },
      ],
      ["market.loanToken", { ...offer, market: { ...offer.market, loanToken: ZERO } }],
    ];

    for (const [field, mutated] of mutations) {
      expect(offerHash(mutated), `mutating ${field} must change the offer hash`).not.toBe(original);
    }
  });
});
