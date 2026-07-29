/**
 * The shapes the curve engine computes over, in plaintext.
 *
 * Every field here has an encrypted counterpart on chain. Nothing in this package ever touches a
 * handle, a gateway or a key — it is the reference model, and its only job is to say what the
 * confidential engine SHOULD produce so that a test can assert the engine produced exactly that.
 *
 * The field names deliberately match `EncryptedMandateBook.EncryptedMandateInput` and
 * `ConfidentialRequestBook.EncryptedRequestInput` one for one. A rename on either side that is not
 * mirrored here shows up as a type error rather than as a reference model that quietly drifts from
 * the thing it is meant to check.
 */

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

/** Fixed slot counts. A mandate always has all of them, filled with encrypted zero if unused. */
export const MARKET_SLOTS = 8;
export const COLLATERAL_FAMILY_SLOTS = 4;
export const MATURITY_BUCKET_SLOTS = 4;

export interface MarketSpec {
  readonly marketId: Hex;
  readonly marketStructHash: Hex;
  readonly maturity: bigint;
  /** Index into a mandate's `collateralFamilyCaps`. */
  readonly collateralFamily: number;
  /** Index into a mandate's `maturityBucketCaps`, and what the borrower's preference is compared to. */
  readonly maturityBucket: number;
  readonly tickSpacing: number;
  readonly settlementFeeFloorWad: bigint;
  /** Selection criterion 5. Lower sorts first. At most 7 — the rank tail is three bits wide. */
  readonly publicPriority: number;
}

/** One (market, rate) cell of the universe. */
export interface Leaf {
  readonly marketIndex: number;
  readonly rateIndex: number;
  readonly tick: number;
  readonly priceWad: bigint;
}

export interface Universe {
  readonly id: Hex;
  readonly label: string;
  readonly maxProviders: number;
  /** Minimum eligible providers before a leaf may be selected. Never below 2 (PRD §8.3). */
  readonly privacyFloor: number;
  /** The threshold the three capacity predicates test against. */
  readonly minTicketAssets: bigint;
  readonly cellsPerChunk: number;
  readonly markets: readonly MarketSpec[];
  readonly leaves: readonly Leaf[];
}

/** PRD §11.3, exactly. Thirty-five encrypted fields on chain. */
export interface Mandate {
  readonly totalBudget: bigint;
  readonly marketCaps: readonly bigint[];
  /** The LOWEST rate index this provider will lend at. Rate index 0 is the cheapest borrowing. */
  readonly minRateIndexes: readonly number[];
  readonly enabledFlags: readonly number[];
  readonly collateralFamilyCaps: readonly bigint[];
  readonly maturityBucketCaps: readonly bigint[];
  readonly maxDurationIndex: number;
  readonly allocationWeight: number;
}

/** PRD §11.4, exactly. Nineteen encrypted fields on chain. */
export interface CurveRequest {
  readonly desiredAssets: bigint;
  readonly minimumAssets: bigint;
  /** The HIGHEST rate index this borrower will accept, per market. */
  readonly maxRateIndexes: readonly number[];
  readonly enabledFlags: readonly number[];
  readonly preferredMaturityIndex: number;
}

export interface Provider {
  readonly address: Address;
  readonly mandate: Mandate;
  /** The provider's confidential vault balance as sealed into the epoch. */
  readonly balance: bigint;
}

/** Stage B output for one (provider, market). */
export interface CachedCell {
  readonly capacity: bigint;
  readonly count: number;
  /** Which of the six leaf-invariant predicates held. Reference-model only — never on chain, and
   *  never derivable from anything the engine publishes. Exists so a test can say WHY a provider
   *  was excluded without the engine having to leak it. */
  readonly predicates: {
    readonly providerEnabled: boolean;
    readonly borrowerEnabled: boolean;
    readonly marketCapAvailable: boolean;
    readonly collateralFamilyCapAvailable: boolean;
    readonly maturityBucketCapAvailable: boolean;
    readonly balanceSufficient: boolean;
  };
}

/** Stages C and D output for one leaf. */
export interface LeafResult {
  readonly leafIndex: number;
  readonly marketIndex: number;
  readonly rateIndex: number;
  /** Raw stage C accumulation, before the borrower's rate ceiling and the privacy floor. */
  readonly accumulatedCapacity: bigint;
  readonly accumulatedCount: number;
  /** After the borrower's rate ceiling and the privacy floor. The pro-rata denominator. */
  readonly capacity: bigint;
  readonly fill: bigint;
  readonly floorPassed: boolean;
  readonly publicRank: number;
  readonly score: number;
  readonly effectiveScore: number;
}

export interface Winner {
  readonly leafIndex: number;
  readonly marketIndex: number;
  readonly rateIndex: number;
  readonly fill: bigint;
  readonly capacity: bigint;
  readonly floorPassed: boolean;
}

export interface ProviderOutcome {
  readonly slot: number;
  readonly address: Address;
  /** Contribution to the winning leaf, recomputed exactly as stage F does. */
  readonly contribution: bigint;
  readonly allocation: bigint;
  /** What the ledger actually took. Encrypted zero if the snapshot was short. */
  readonly reserved: bigint;
  readonly remaining: bigint;
}

export interface CurveResult {
  readonly cached: readonly (readonly CachedCell[])[];
  readonly leaves: readonly LeafResult[];
  readonly winner: Winner | null;
  readonly providers: readonly ProviderOutcome[];
  /** The five values that become public, and nothing else. */
  readonly published: {
    readonly selectedMarketIndex: number;
    readonly selectedRateIndex: number;
    readonly privacyFloorPassed: boolean;
    readonly quoteReady: boolean;
    readonly aggregateFillAmount: bigint;
  };
  /** `winner.fill - aggregate`. Private: it would disclose the winning leaf's total capacity. */
  readonly dustResidue: bigint;
}
