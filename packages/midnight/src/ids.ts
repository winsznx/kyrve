/**
 * Market id and offer hash derivation, ported from the pinned Midnight release.
 *
 * `IdLib.toId` is NOT `keccak256(abi.encode(market))`, which is the obvious wrong guess. It is the
 * CREATE2 address hash of an SSTORE2 deployment of the encoded market:
 *
 *     keccak256(0xff ++ midnight ++ bytes32(0) ++ keccak256(SSTORE2_PREFIX ++ abi.encode(market)))
 *
 * Midnight stores each market's parameters in the runtime code of a contract deployed at the last
 * 20 bytes of that id, which is why the id has this shape. Source:
 * `vendor/midnight/src/libraries/IdLib.sol`.
 *
 * `packages/midnight/test/ids.test.ts` checks both derivations against ids returned by a real
 * `touchMarket`, so a transcription error cannot survive.
 */

import { concatHex, encodeAbiParameters, type Hex, keccak256, pad, toHex } from "viem";

import { MARKET_ABI, type Market, OFFER_ABI, type Offer } from "./types.js";

/**
 * The SSTORE2 creation-code prefix, verbatim from `IdLib.SSTORE2_PREFIX`. It turns arbitrary data
 * into a contract whose runtime code IS that data.
 */
export const SSTORE2_PREFIX = "0x600b380380600b5f395ff3" as const;

/** `abi.encode(market)` — the exact bytes Midnight hashes. */
export function encodeMarket(market: Market): Hex {
  return encodeAbiParameters([MARKET_ABI], [market as never]);
}

/** `abi.encode(offer)` — the exact bytes `KyrveQuoteRatifier` hashes. */
export function encodeOffer(offer: Offer): Hex {
  return encodeAbiParameters([OFFER_ABI], [offer as never]);
}

/**
 * `IdLib.toId(market)`.
 *
 * The `midnight` address embedded in the market struct is also the CREATE2 deployer, so a market
 * id is inseparable from the deployment it belongs to — chain and deployment replay protection is
 * native to the id rather than bolted on.
 */
export function marketId(market: Market): Hex {
  const initCodeHash = keccak256(concatHex([SSTORE2_PREFIX, encodeMarket(market)]));
  return keccak256(
    concatHex(["0xff", market.midnight, pad(toHex(0n), { size: 32 }), initCodeHash]),
  );
}

/**
 * The hash `KyrveQuoteRatifier` binds an activated quote to.
 *
 * It covers the ENTIRE offer including the embedded market, so mutating any field — tick, expiry,
 * callback, maxUnits, or any market parameter — is rejected before Midnight moves any value.
 */
export function offerHash(offer: Offer): Hex {
  return keccak256(encodeOffer(offer));
}

/** Where Midnight stores the market parameters: the last 20 bytes of the id. */
export function marketParamsAddress(id: Hex): Hex {
  return `0x${id.slice(-40)}` as Hex;
}
