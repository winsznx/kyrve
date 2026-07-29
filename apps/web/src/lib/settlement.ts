/**
 * The settlement half of the served deployment record.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS OPTIONAL, AND WHY THE PANEL DISAPPEARS RATHER THAN GUESSES
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A quote exists only after a confidential epoch has run, been publicly decrypted and been
 * activated. That is minutes of off-chain computation, not something a page can bootstrap. So the
 * flow driver writes this block into `deployment.json` once it holds a real activated quote, and the
 * panel renders only when it is there.
 *
 * The alternative — rendering the panel with placeholder terms — is exactly what
 * `.claude/rules/frontend.md` forbids: no fake metrics, no placeholder proofs. An absent quote shows
 * as an absent quote.
 *
 * Every field here is PUBLIC FROM ACTIVATION. The selected market, the selected rate, the aggregate
 * fill, the borrower, the expiry and the whole offer became public the moment the quote was
 * activated, and the panel says so at the point of action. Nothing private is representable in this
 * type: there is no provider, no allocation, no leaf capacity and no provider count.
 */

import type { Deployment } from "./deployment.js";

export type SettlementContractName =
  | "KyrveQuoteRegistry"
  | "KyrveSettlementRatifier"
  | "KyrvePublicResultVerifier"
  | "QuoteActivator"
  | "KyrveQuoteExpiryController"
  | "KyrveSeriesFactory";

/** Mirrors `QuoteStatus`. */
export enum QuoteStatus {
  None = 0,
  Executable = 1,
  Consumed = 2,
  Cancelled = 3,
  Expired = 4,
}

export const QUOTE_STATUS_LABEL: Readonly<Record<QuoteStatus, string>> = {
  [QuoteStatus.None]: "no quote",
  [QuoteStatus.Executable]: "executable",
  [QuoteStatus.Consumed]: "settled",
  [QuoteStatus.Cancelled]: "cancelled",
  [QuoteStatus.Expired]: "expired",
};

/** The `Market` struct, exactly as Midnight orders it. */
export interface SettlementMarket {
  readonly chainId: string;
  readonly midnight: `0x${string}`;
  readonly loanToken: `0x${string}`;
  readonly collateralParams: readonly {
    readonly token: `0x${string}`;
    readonly lltv: string;
    readonly liquidationCursor: string;
    readonly oracle: `0x${string}`;
  }[];
  readonly maturity: string;
  readonly rcfThreshold: string;
  readonly enterGate: `0x${string}`;
  readonly liquidatorGate: `0x${string}`;
}

/**
 * A finished epoch that has NOT been activated yet, and everything needed to activate it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * A CANDIDATE, NOT A QUOTE — AND THE DIFFERENCE IS THE POINT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The panel must be able to ACTIVATE, which means the record has to describe the epoch before a
 * quote exists. So nothing here is a claim about a quote: the identity fields are what the epoch
 * sealed, the proofs are what the gateway signed, and the market struct is what will be presented to
 * Midnight. Everything about the resulting quote — units, buyer assets, expiry, status, the offer
 * itself — is read from CHAIN STATE after activation, never from this file.
 *
 * That ordering is deliberate. A panel that displayed terms from a served JSON would be showing what
 * a script believed rather than what the registry holds, and the difference between those two is the
 * entire class of bug `KyrveSettlementRatifier` exists to catch.
 *
 * The four verified public results are here because the panel shows them BEFORE activation, under a
 * "verify" action that re-runs the read-only verification on chain. They are public from the moment
 * the epoch published them.
 */
export interface QuoteCandidateRecord {
  readonly epochId: `0x${string}`;
  readonly requestId: `0x${string}`;
  readonly universeId: `0x${string}`;
  readonly graphRoot: `0x${string}`;
  readonly marketId: `0x${string}`;
  readonly market: SettlementMarket;
  readonly leafIndex: number;
  readonly lifetimeSeconds: number;
  readonly maxPendingFee: string;
  /** The selected leaf, as the gateway decrypted it. Public from publication. */
  readonly marketIndex: number;
  readonly rateIndex: number;
  readonly tick: number;
  /** The published aggregate: the sum of reserved provider allocations, exactly. */
  readonly aggregateFillAmount: string;
  readonly borrower: `0x${string}`;
  readonly expectedVault: `0x${string}`;
  readonly maturity: string;
  readonly loanTokenDecimals: number;
  readonly loanTokenSymbol: string;
  readonly proofs: {
    readonly market: `0x${string}`;
    readonly rate: `0x${string}`;
    readonly floor: `0x${string}`;
    readonly ready: `0x${string}`;
    readonly aggregate: `0x${string}`;
  };
}

export interface SettlementRecord {
  readonly midnight: `0x${string}`;
  readonly loanToken: `0x${string}`;
  readonly addresses: Readonly<Record<SettlementContractName, `0x${string}`>>;
  readonly deploymentId: `0x${string}`;
  readonly candidate: QuoteCandidateRecord;
  /** `https://sepolia.etherscan.io` when the record is for a public network, absent locally. */
  readonly explorer?: string;
}

export interface SettlementDeployment extends Deployment {
  readonly settlement?: SettlementRecord;
}

/** A block-explorer link, or nothing at all when there is no explorer for this chain. */
export function explorerLink(
  settlement: SettlementRecord | undefined,
  kind: "tx" | "address",
  value: string,
): string | undefined {
  if (settlement?.explorer === undefined) return undefined;
  return `${settlement.explorer}/${kind}/${value}`;
}

/** Whole units of the loan token, for display only. Never used in a calculation. */
export function formatUnits(raw: string, decimals: number): string {
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === 0n) return whole.toLocaleString("en-GB");
  const padded = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-GB")}.${padded}`;
}
