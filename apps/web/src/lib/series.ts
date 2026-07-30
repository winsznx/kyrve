/**
 * The confidential-ownership half of the served deployment record.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS RECORD MAY CONTAIN, AND WHAT IT STRUCTURALLY CANNOT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * IDENTIFIERS AND TRANSACTION HASHES ONLY. Every field below is public the moment it exists: the
 * series id and market id are derived from public state, the epoch id and sealed graph root are
 * public from the epoch, the quote id is public from activation, and a transaction hash is public by
 * construction.
 *
 * There is **no amount in this type at all** — not the aggregate, not the credit, not the supply, and
 * certainly not a provider's balance. Every number the ownership panel displays is read from chain
 * state at render time, and every private number is decrypted in the browser by the wallet that owns
 * it. A record that carried the aggregate would let the panel show what a script believed instead of
 * what the token holds, and those differ exactly when something is wrong.
 *
 * `providers` is a list of ADDRESSES. Provider participation in an epoch is already public — it is
 * the honest cost of a permissionless keeper, recorded in `NoxCurveEngine`'s own boundary note. What
 * stays private is whether any of them was eligible, at what rate, in what size, and what they now
 * own. None of that is representable here.
 */

import type { Deployment } from "./deployment.js";

export type SeriesContractName =
  | "KyrveCustodyVault"
  | "KyrveSeriesToken"
  | "SeriesOwnershipRegistry"
  | "SeriesAllocator"
  | "AggregateSolvencyVerifier"
  | "SeriesResidueAccount";

/** Mirrors `SeriesOwnershipRegistry.ClaimState`. */
export enum ClaimState {
  None = 0,
  Allocated = 1,
  Unwound = 2,
}

export const CLAIM_STATE_LABEL: Readonly<Record<ClaimState, string>> = {
  [ClaimState.None]: "no claim recorded",
  [ClaimState.Allocated]: "allocated",
  [ClaimState.Unwound]: "unwound",
};

export interface SeriesRecord {
  readonly addresses: Readonly<Record<SeriesContractName, `0x${string}`>>;
  readonly seriesId: `0x${string}`;
  readonly marketId: `0x${string}`;
  /** The series vault: the Midnight maker, and the public owner of the credit these claims are on. */
  readonly vault: `0x${string}`;
  /** The market's loan token — and, in Phase 5, the wrapper's underlying too. Delta T-10. */
  readonly loanToken: `0x${string}`;
  readonly loanTokenSymbol: string;
  readonly loanTokenDecimals: number;
  /** Seconds since the epoch. Public: it is a field of the Midnight `Market` struct. */
  readonly maturity: string;
  readonly quoteId: `0x${string}`;
  readonly epochId: `0x${string}`;
  readonly graphRoot: `0x${string}`;
  /** The `Midnight.take` that created the credit. */
  readonly settlementTx: `0x${string}`;
  /** The `SeriesAllocator.allocateChunk` that minted the claims. */
  readonly allocationTx: `0x${string}`;
  /** Every provider holding a claim on this quote. Addresses only — participation is public. */
  readonly providers: readonly `0x${string}`[];
  /** `https://sepolia.etherscan.io` on a public network, absent locally. */
  readonly explorer?: string;
}

export interface SeriesDeployment extends Deployment {
  readonly series?: SeriesRecord;
}

/** A block-explorer link, or nothing at all when there is no explorer for this chain. */
export function seriesExplorerLink(
  series: SeriesRecord | undefined,
  kind: "tx" | "address",
  value: string,
): string | undefined {
  if (series?.explorer === undefined) return undefined;
  return `${series.explorer}/${kind}/${value}`;
}

/** `0xabcdef…123456`. For identifiers only; never applied to an amount. */
export function abbreviate(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`;
}

/** The maturity as a date, in the viewer's locale. UTC, because a market's maturity is a timestamp. */
export function formatMaturity(secondsSinceEpoch: string): string {
  const millis = Number(BigInt(secondsSinceEpoch) * 1000n);
  if (!Number.isFinite(millis)) return secondsSinceEpoch;
  return new Date(millis).toISOString().replace("T", " ").slice(0, 16);
}

/**
 * The Phase 6 market layer, which is its own record.
 *
 * `KyrveRollBook` cannot exist until a SECOND complete series does (delta U-1), and a series
 * deployed with no market layer is a coherent state — so these addresses are optional, and a page
 * that cannot find one must say "not deployed here" rather than render a verdict about it.
 *
 * As with `SeriesRecord`, there is no amount in this type at all.
 */
export type MarketContractName = "KyrveCapsuleVault" | "KyrveCrossBook" | "KyrveRollBook";

export interface MarketRecord {
  readonly addresses: Partial<Readonly<Record<MarketContractName, `0x${string}`>>>;
  /** The series the Capsule vault and Cross book were deployed OVER. The Roll book spans two. */
  readonly seriesId: `0x${string}`;
}
