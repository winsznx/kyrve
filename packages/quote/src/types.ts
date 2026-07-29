/**
 * The settlement layer's public types, transcribed from `contracts/kyrve/KyrveQuoteTypes.sol` and
 * `contracts/kyrve/interfaces/ICurveLayer.sol`.
 *
 * FIELD ORDER IS LOAD-BEARING in exactly one place — {QUOTE_ID_ABI} in `id.ts` — because the quote
 * id is an `abi.encode` fold and reordering a field changes every id. The interfaces here are read
 * by name and are safe to extend; the ABI tuple is not.
 */

import type { Address, Hex } from "viem";

/** Mirrors `QuoteStatus`. Terminal states are never left. */
export enum QuoteStatus {
  None = 0,
  Executable = 1,
  Consumed = 2,
  Cancelled = 3,
  Expired = 4,
}

/** Mirrors `CurveGraphRegistry.ResultRole`. The five values that may cross the public boundary. */
export enum CurveResultRole {
  SelectedMarketIndex = 0,
  SelectedRateIndex = 1,
  PrivacyFloorPassed = 2,
  QuoteReady = 3,
  AggregateFillAmount = 4,
}

/** Mirrors `QuoteEpochController.Stage`. Only `Complete` may be settled against. */
export enum CurveEpochStage {
  Open = 0,
  CacheProviders = 1,
  Accumulate = 2,
  FinalizeLeaves = 3,
  ReduceWinner = 4,
  PublishWinner = 5,
  Allocate = 6,
  PublishAggregate = 7,
  Complete = 8,
  Cancelled = 9,
}

export const CURVE_RESULT_ROLES = [
  CurveResultRole.SelectedMarketIndex,
  CurveResultRole.SelectedRateIndex,
  CurveResultRole.PrivacyFloorPassed,
  CurveResultRole.QuoteReady,
  CurveResultRole.AggregateFillAmount,
] as const;

export const CURVE_RESULT_ROLE_NAMES: Readonly<Record<CurveResultRole, string>> = {
  [CurveResultRole.SelectedMarketIndex]: "selectedMarketIndex",
  [CurveResultRole.SelectedRateIndex]: "selectedRateIndex",
  [CurveResultRole.PrivacyFloorPassed]: "privacyFloorPassed",
  [CurveResultRole.QuoteReady]: "quoteReady",
  [CurveResultRole.AggregateFillAmount]: "aggregateFillAmount",
} as const;

/** Mirrors `QuoteExecution`. What the ratifier and the vault need to authorise and size one fill. */
export interface QuoteExecution {
  readonly offerHash: Hex;
  readonly marketId: Hex;
  readonly exactUnits: bigint;
  readonly expectedBuyerAssets: bigint;
  readonly maxPendingFee: bigint;
  readonly expiry: bigint;
  readonly activatedAt: bigint;
  readonly status: QuoteStatus;
  readonly taker: Address;
  readonly vault: Address;
  readonly ratifier: Address;
}

/** Mirrors `QuoteProvenance`. Where the quote came from, and what it can never be separated from. */
export interface QuoteProvenance {
  readonly epochId: Hex;
  readonly graphRoot: Hex;
  readonly requestId: Hex;
  readonly universeId: Hex;
  readonly deploymentId: Hex;
  readonly marketStructHash: Hex;
  /** The sum of RESERVED provider allocations, exactly. Never the winning leaf's capacity. */
  readonly aggregateFillAmount: bigint;
  readonly tick: number;
  readonly marketIndex: number;
  readonly rateIndex: number;
  readonly leafIndex: number;
}

/** Mirrors `NoxCurveEngine.Published`. Five handles, in role order. */
export interface PublishedHandles {
  readonly marketIndex: Hex;
  readonly rateIndex: Hex;
  readonly floorPassed: Hex;
  readonly quoteReady: Hex;
  readonly aggregateFill: Hex;
}

export const ZERO_HANDLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
