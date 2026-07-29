/**
 * The pinned Morpho Midnight structs, transcribed from
 * `vendor/midnight/src/interfaces/IMidnight.sol` at release `2026-07-23` (`dbd8d3d5`).
 *
 * FIELD ORDER IS LOAD-BEARING. `IdLib.toId` hashes `abi.encode(market)` and the ratifier hashes
 * `abi.encode(offer)`, so reordering a single field changes every market id and invalidates every
 * activated quote. The ABI parameter definitions below are the canonical encoding and are checked
 * against real chain values by `packages/midnight/test/ids.test.ts`.
 */

import type { Address, Hex } from "viem";

export interface CollateralParams {
  readonly token: Address;
  readonly lltv: bigint;
  readonly liquidationCursor: bigint;
  readonly oracle: Address;
}

export interface Market {
  readonly chainId: bigint;
  readonly midnight: Address;
  readonly loanToken: Address;
  readonly collateralParams: readonly CollateralParams[];
  readonly maturity: bigint;
  readonly rcfThreshold: bigint;
  readonly enterGate: Address;
  readonly liquidatorGate: Address;
}

export interface Offer {
  readonly market: Market;
  readonly buy: boolean;
  readonly maker: Address;
  readonly start: bigint;
  readonly expiry: bigint;
  readonly tick: bigint;
  readonly group: Hex;
  readonly callback: Address;
  readonly callbackData: Hex;
  readonly receiverIfMakerIsSeller: Address;
  readonly ratifier: Address;
  readonly reduceOnly: boolean;
  readonly maxUnits: bigint;
  readonly maxAssets: bigint;
  readonly continuousFeeCap: bigint;
}

export interface MarketState {
  readonly totalUnits: bigint;
  readonly lossFactor: bigint;
  readonly withdrawable: bigint;
  readonly continuousFeeCredit: bigint;
  readonly settlementFeeCbp: readonly number[];
  readonly continuousFee: bigint;
  readonly tickSpacing: number;
}

export interface Position {
  readonly credit: bigint;
  readonly pendingFee: bigint;
  readonly lastLossFactor: bigint;
  readonly lastAccrual: bigint;
  readonly debt: bigint;
  readonly collateralBitmap: bigint;
}

/** Canonical ABI encoding of `CollateralParams`, in declaration order. */
export const COLLATERAL_PARAMS_ABI = {
  type: "tuple",
  components: [
    { name: "token", type: "address" },
    { name: "lltv", type: "uint256" },
    { name: "liquidationCursor", type: "uint256" },
    { name: "oracle", type: "address" },
  ],
} as const;

/** Canonical ABI encoding of `Market`, in declaration order. */
export const MARKET_ABI = {
  type: "tuple",
  components: [
    { name: "chainId", type: "uint256" },
    { name: "midnight", type: "address" },
    { name: "loanToken", type: "address" },
    { name: "collateralParams", type: "tuple[]", components: COLLATERAL_PARAMS_ABI.components },
    { name: "maturity", type: "uint256" },
    { name: "rcfThreshold", type: "uint256" },
    { name: "enterGate", type: "address" },
    { name: "liquidatorGate", type: "address" },
  ],
} as const;

/** Canonical ABI encoding of `Offer`, in declaration order. */
export const OFFER_ABI = {
  type: "tuple",
  components: [
    { name: "market", type: "tuple", components: MARKET_ABI.components },
    { name: "buy", type: "bool" },
    { name: "maker", type: "address" },
    { name: "start", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "tick", type: "uint256" },
    { name: "group", type: "bytes32" },
    { name: "callback", type: "address" },
    { name: "callbackData", type: "bytes" },
    { name: "receiverIfMakerIsSeller", type: "address" },
    { name: "ratifier", type: "address" },
    { name: "reduceOnly", type: "bool" },
    { name: "maxUnits", type: "uint128" },
    { name: "maxAssets", type: "uint128" },
    { name: "continuousFeeCap", type: "uint256" },
  ],
} as const;
