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

// ── Transaction budget (Phase 3 delta R-3, corrected by Phase 4 delta S-2) ──────────────────
/**
 * EIP-7825: an Osaka chain refuses any transaction specifying more than 2^24 gas, whatever the
 * block limit is. Phase 3's 24,000,000 was a judgement measured on a node with no such cap; this is
 * a protocol rule and has no override. Measured on both sides of the boundary by
 * `confidential/test/09-osaka.ts`.
 */
export const CURVE_TRANSACTION_GAS_CEILING = 16_777_216;
/**
 * 192 x 71,068 = 13,645,056 — 18.7% under the Osaka cap.
 *
 * Was 311, with 256 advised, and 256 measured at 18,193,386: the only stage width over the cap. The
 * largest chunk that would fit is about 236; 192 carries margin instead, because this is a local
 * measurement and testnet gas remains UNVERIFIED (AS-1). Maximum and recommendation now coincide —
 * a universe created at the maximum must be executable, and nothing else enforces that.
 */
export const CURVE_MAX_CELLS_PER_TRANSACTION = 192;
export const CURVE_RECOMMENDED_CELLS_PER_TRANSACTION = 192;

// ── Stage chunk widths ──────────────────────────────────────────────────────────────────────
export const CURVE_CACHE_CHUNK_UNITS = 32;
export const CURVE_FINALIZE_CHUNK_LEAVES = 48;
export const CURVE_REDUCE_CHUNK_LEAVES = 32;
export const CURVE_ALLOCATE_CHUNK_PROVIDERS = 16;

/** The lowest privacy floor a universe may declare. A floor of 1 is not a privacy floor. */
export const CURVE_MIN_PRIVACY_FLOOR = 2;

/**
 * Stage gas, MEASURED against the real local Nox stack by the Phase 3 benchmark.
 *
 * These REPLACE the Day 0 figures rather than refining them. Day 0 measured isolated Nox
 * primitives and summed them; the contract additionally pays for storage, external calls,
 * calldata and the graph commitment, which is 1.7x to 3.6x more per stage. Stage B moved for a
 * second, independent reason: its unit is (provider, market), not provider, because every
 * predicate it caches varies by market and a leaf carries a market. Both recorded as delta R-3.
 *
 * Raw data: `evidence/phase3/stage-gas.json`. `verify:phase3` fails if the recorded measurement
 * and these values disagree, so a future optimisation has to be reflected here deliberately.
 *
 * Local node, local stack. Testnet gas remains UNVERIFIED (AS-1).
 */
export const CURVE_STAGE_GAS = {
  /** Per (provider, market). Day 0 recorded 256,553 per PROVIDER. */
  cacheUnit: 468_047,
  /**
   * Per (provider, leaf) cell. Day 0 recorded 76,402 from summed primitives.
   *
   * The first Phase 3 measurement was 128,914 — 69% worse — because stage C was paying three
   * per-LEAF costs once per CELL: a `toEuint16` of the leaf's public rate index, two `allowThis`
   * calls persisting an accumulator about to be overwritten, and two SSTOREs of an intermediate
   * nobody would read. Restructuring the loop leaf-major brought it to 72,226, which is where it
   * should have been all along and is what makes the Day 0 ceiling of 311 cells survive.
   */
  accumulateCell: 72_226,
  accumulateChunkOverhead: 166_954,
  /** Per leaf. Day 0 recorded 158,847. */
  finalizeLeaf: 294_800,
  /** Per leaf. Day 0 recorded 94,649 for a three-value fold; this one carries six. */
  reduceLeaf: 345_416,
  /** Once per epoch, including four isolations and four irreversible publications. */
  publishWinner: 830_000,
  /** Per provider, including the ledger's safe subtraction and two isolations. */
  allocateProvider: 527_172,
  publishAggregate: 345_000,
  /** Per provider, paid once at seal rather than once per epoch. */
  sealProvider: 1_450_000,
  prepareEpoch: 3_100_000,
} as const;
