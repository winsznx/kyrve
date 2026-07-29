/**
 * The mirror of `confidential/contracts/CurveConstants.sol`.
 *
 * These are duplicated across a language boundary, which is exactly the situation that produces
 * drift, so they are not left to trust: `packages/curve/test/constants.test.ts` parses the Solidity
 * file and asserts every value here matches it, and `verify:phase3` reads the same numbers back
 * from the deployed contracts' public getters. Three independent sources have to agree.
 */

// ── Universe shape (PRD §9.1) ───────────────────────────────────────────────────────────────
export const CURVE_MAX_PROVIDERS = 16;
export const CURVE_MAX_MARKETS = 8;
export const CURVE_MAX_RATES_PER_MARKET = 16;
export const CURVE_MAX_LEAVES = 128;
export const CURVE_COLLATERAL_FAMILY_SLOTS = 4;
export const CURVE_MATURITY_BUCKET_SLOTS = 4;

// ── Selection-policy packing ────────────────────────────────────────────────────────────────
export const CURVE_MAX_PUBLIC_PRIORITY = 7;
export const CURVE_MATURITY_RANK_STRIDE = 128;
export const CURVE_RATE_RANK_STRIDE = 512;
/** Above every reachable rank (15*512 + 3*128 + 119 = 8,183), so a leaf with no fill never wins. */
export const CURVE_RANK_CEILING = 8_192;

// ── Measured transaction budget ─────────────────────────────────────────────────────────────
export const CURVE_TRANSACTION_GAS_CEILING = 24_000_000;
export const CURVE_MAX_CELLS_PER_TRANSACTION = 311;
export const CURVE_RECOMMENDED_CELLS_PER_TRANSACTION = 256;

// ── Stage chunk widths ──────────────────────────────────────────────────────────────────────
export const CURVE_CACHE_CHUNK_UNITS = 48;
export const CURVE_FINALIZE_CHUNK_LEAVES = 96;
export const CURVE_REDUCE_CHUNK_LEAVES = 64;
export const CURVE_ALLOCATE_CHUNK_PROVIDERS = 16;

/** The lowest privacy floor a universe may declare. A floor of 1 is not a privacy floor. */
export const CURVE_MIN_PRIVACY_FLOOR = 2;

/**
 * Stage gas, MEASURED against the real local stack in Phase 3 and corrected from the Day 0 figures.
 *
 * Day 0 measured stage B on a single-market spike and recorded it per PROVIDER. The predicates it
 * caches — enabled, the market cap, the portfolio caps — all vary by MARKET, and a leaf carries a
 * market, so the real unit is (provider, market). Recorded as delta R-3. The stage-E figure grew
 * for a different reason: the fold carries six values rather than three, because the winning leaf's
 * total capacity and its privacy-floor flag are both needed downstream.
 *
 * These are what `planCurveEpoch` sizes against. `evidence/phase3/stage-gas.json` is the raw
 * measurement and `verify:phase3` fails if the two disagree by more than the recorded tolerance.
 */
export const CURVE_STAGE_GAS = {
  /** Per (provider, market). Day 0 recorded 256,553 per provider. */
  cacheUnit: 344_000,
  /** Per (provider, leaf) cell. Unchanged from Day 0 and re-confirmed. */
  accumulateCell: 76_402,
  accumulateChunkOverhead: 166_954,
  /** Per leaf. Day 0 recorded 158,847. */
  finalizeLeaf: 160_000,
  /** Per leaf. Day 0 recorded 94,649 for a three-value fold. */
  reduceLeaf: 130_000,
  /** Once per epoch. Day 0 recorded 90,076, before handle isolation existed. */
  publishWinner: 400_000,
  /** Per provider, including the ledger's reservation. Day 0 recorded 166,423. */
  allocateProvider: 210_000,
  publishAggregate: 120_000,
  /** Per provider, paid once at seal rather than once per epoch. */
  sealProvider: 800_000,
  prepareEpoch: 900_000,
} as const;
