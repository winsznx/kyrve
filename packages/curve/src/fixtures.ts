/**
 * Deterministic fixtures shared by the unit tests, the property tests and the real-Nox suite.
 *
 * One definition, used from both sides. If the reference model and the encrypted engine were fed
 * fixtures written separately, demonstration 20 — "Nox output matches the plaintext reference model
 * exactly" — would be comparing two things that were never given the same inputs, and the most
 * likely way for it to pass would be for both to be wrong in the same place.
 *
 * Nothing here is secret. These are test values, not the private fixtures the privacy scan tracks
 * (`confidential/test/private-fixtures.json`), and they are deliberately NOT high-entropy: they are
 * chosen so that a failing assertion is readable.
 */

import type { CurveRequest, Mandate, MarketSpec } from "./types.js";
import { COLLATERAL_FAMILY_SLOTS, MARKET_SLOTS, MATURITY_BUCKET_SLOTS } from "./types.js";
import type { MarketGrid, UniverseDraft } from "./universe.js";

const WAD = 10n ** 18n;
/** 1 unit = 1e6, matching the six-decimal test USDC the confidential suite wraps. */
export const UNIT = 1_000_000n;

function pad<T>(values: readonly T[], size: number, filler: T): T[] {
  const out = values.slice(0, size);
  while (out.length < size) out.push(filler);
  return out;
}

/**
 * A descending price grid, generated rather than transcribed.
 *
 * Rate index 0 is the HIGHEST tick and the HIGHEST price, which is the CHEAPEST borrowing — the
 * ordering `docs/phase1/RATE-GRIDS.md` locks and `CurveUniverseRegistry` enforces. Prices step down
 * by a widening amount so the grid is strictly descending in both tick and price, which is what the
 * registry checks.
 */
export function makeGrid(
  spec: MarketSpec,
  rateCount: number,
  topTick = 4_656,
  spacing = 4,
): MarketGrid {
  const ticks: number[] = [];
  const pricesWad: bigint[] = [];
  for (let r = 0; r < rateCount; r += 1) {
    ticks.push(topTick - r * spacing * 8);
    // Starts just under par and falls away; every value stays above the fee floor below.
    pricesWad.push(WAD - BigInt(r) * BigInt(r + 3) * 10n ** 14n - 10n ** 15n);
  }
  return { spec, ticks, pricesWad };
}

export function makeMarket(index: number, overrides: Partial<MarketSpec> = {}): MarketSpec {
  return {
    marketId: `0x${(index + 1).toString(16).padStart(64, "0")}` as MarketSpec["marketId"],
    marketStructHash:
      `0x${(index + 101).toString(16).padStart(64, "0")}` as MarketSpec["marketStructHash"],
    maturity: 2_000_000_000n + BigInt(index) * 86_400n,
    collateralFamily: index % COLLATERAL_FAMILY_SLOTS,
    maturityBucket: index % MATURITY_BUCKET_SLOTS,
    tickSpacing: 4,
    settlementFeeFloorWad: 4n * 10n ** 14n,
    publicPriority: index % 8,
    ...overrides,
  };
}

/** A universe draft of `markets` markets x `ratesPerMarket` rates. 8 x 16 is the launch shape. */
export function makeUniverseDraft(options: {
  readonly label?: string;
  readonly chainId?: number;
  readonly registry?: `0x${string}`;
  readonly markets: number;
  readonly ratesPerMarket: number;
  readonly maxProviders?: number;
  readonly privacyFloor?: number;
  readonly minTicketAssets?: bigint;
  readonly cellsPerChunk?: number;
}): UniverseDraft {
  const grids: MarketGrid[] = [];
  for (let m = 0; m < options.markets; m += 1) {
    grids.push(makeGrid(makeMarket(m), options.ratesPerMarket));
  }
  return {
    label: options.label ?? `kyrve-test-${options.markets}x${options.ratesPerMarket}`,
    chainId: options.chainId ?? 31337,
    registry: options.registry ?? "0x00000000000000000000000000000000000000ce",
    maxProviders: options.maxProviders ?? 16,
    privacyFloor: options.privacyFloor ?? 2,
    minTicketAssets: options.minTicketAssets ?? UNIT,
    cellsPerChunk: options.cellsPerChunk ?? 256,
    markets: grids,
  };
}

/**
 * A mandate with sane defaults: every market enabled, generous caps, minimum rate index 0.
 *
 * Every array is padded to its FIXED length. That is a privacy control, not an encoding
 * convenience — a variable-length submission would leak how many markets a provider serves, which
 * is the shape inference PRD §8.3 exists to prevent (delta Q-8).
 */
export function makeMandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    totalBudget: overrides.totalBudget ?? 1_000n * UNIT,
    marketCaps: pad(overrides.marketCaps ?? [], MARKET_SLOTS, 500n * UNIT),
    minRateIndexes: pad(overrides.minRateIndexes ?? [], MARKET_SLOTS, 0),
    enabledFlags: pad(overrides.enabledFlags ?? [], MARKET_SLOTS, 1),
    collateralFamilyCaps: pad(
      overrides.collateralFamilyCaps ?? [],
      COLLATERAL_FAMILY_SLOTS,
      800n * UNIT,
    ),
    maturityBucketCaps: pad(overrides.maturityBucketCaps ?? [], MATURITY_BUCKET_SLOTS, 800n * UNIT),
    maxDurationIndex: overrides.maxDurationIndex ?? 3,
    allocationWeight: overrides.allocationWeight ?? 1,
  };
}

/** A borrower request that fits inside {makeMandate}'s envelope. */
export function makeRequest(overrides: Partial<CurveRequest> = {}): CurveRequest {
  return {
    desiredAssets: overrides.desiredAssets ?? 600n * UNIT,
    minimumAssets: overrides.minimumAssets ?? 100n * UNIT,
    maxRateIndexes: pad(overrides.maxRateIndexes ?? [], MARKET_SLOTS, 15),
    enabledFlags: pad(overrides.enabledFlags ?? [], MARKET_SLOTS, 1),
    preferredMaturityIndex: overrides.preferredMaturityIndex ?? 0,
  };
}

/** Deterministic test addresses, so a failing assertion names a slot rather than a random hex. */
export function providerAddress(slot: number): `0x${string}` {
  return `0x${(slot + 1).toString(16).padStart(40, "0")}` as `0x${string}`;
}
