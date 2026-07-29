// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

// The universe shape and the chunk widths, in one place.
//
// File-level constants rather than per-contract ones, deliberately. The registry, the epoch
// controller and the curve engine all need the same numbers, and Solidity cannot read another
// contract's constants without an external call — so the alternative is three copies that drift.
// A chunk width that disagreed between the contract sizing a stage and the contract executing it
// would produce an epoch whose last chunk silently processed nothing.
//
// Each contract still exposes the ones it is responsible for as `public constant`, so
// `verify:phase3` reads them back from chain state rather than from this file.
//
// Every width below is derived from `docs/day0/OPERATION-BUDGET.md` sections 3 and 4 as corrected
// by Phase 3 delta R-3, and the arithmetic is written out so a change can be checked, not trusted.
//
// Plain `//` comments rather than natspec: solc rejects documentation tags on file-level variables.

// ── Universe shape (PRD section 9.1)
// ────────────────────────────────────────────────────────
uint256 constant CURVE_MAX_PROVIDERS = 16;
// Matches `EncryptedMandateBook.MARKET_SLOTS`. A mandate always has exactly this many market
// slots, because a variable-length submission would leak how many markets a provider serves.
uint256 constant CURVE_MAX_MARKETS = 8;
uint256 constant CURVE_MAX_RATES_PER_MARKET = 16;
uint256 constant CURVE_MAX_LEAVES = 128;
uint256 constant CURVE_COLLATERAL_FAMILY_SLOTS = 4;
uint256 constant CURVE_MATURITY_BUCKET_SLOTS = 4;

// ── Selection-policy packing (see CurveUniverseRegistry.publicLeafRank)
// ─────────────────────
// The rank tail is exactly 7 bits: 3 of market priority, 4 of market index.
uint16 constant CURVE_MAX_PUBLIC_PRIORITY = 7;
// The stride the encrypted maturity distance is multiplied by: one step above the 7-bit tail.
uint16 constant CURVE_MATURITY_RANK_STRIDE = 128;
// 4 maturity buckets x the stride. One step above the whole maturity field.
uint16 constant CURVE_RATE_RANK_STRIDE = 512;
// The largest reachable rank is 15*512 + 3*128 + 119 = 8,183, where 119 = (7<<4)|7 is the widest
// tail the three priority bits and four market-index bits can produce. 8,192 therefore sits above
// every reachable score and is what a leaf with no fill is pushed to. It must never be reachable,
// or an empty leaf could win.
uint16 constant CURVE_RANK_CEILING = 8_192;

// ── Measured transaction budget (OPERATION-BUDGET section 4)
// ────────────────────────────────
uint256 constant CURVE_TRANSACTION_GAS_CEILING = 24_000_000;
// floor((24,000,000 - 166,954) / 76,402). Derived from measurement, not chosen.
uint256 constant CURVE_MAX_CELLS_PER_TRANSACTION = 311;
// 256 x 76,402 + 166,954 = 19.7M, about 18% margin.
uint256 constant CURVE_RECOMMENDED_CELLS_PER_TRANSACTION = 256;

// ── Stage chunk widths
// ──────────────────────────────────────────────────────────────────────
// Stage B costs about 344k gas per (provider, market) unit, not the 256,553 the Day 0 spike
// recorded for a single-market universe (delta R-3). 48 x 344k = 16.5M, about 31% margin.
uint32 constant CURVE_CACHE_CHUNK_UNITS = 48;
// Stage D costs about 160k per leaf. 96 x 160k = 15.4M.
uint32 constant CURVE_FINALIZE_CHUNK_LEAVES = 96;
// Stage E costs about 130k per leaf, above the 94,649 Day 0 figure because the fold carries six
// values rather than three — the winning leaf's total capacity and its privacy-floor flag are
// both needed downstream. 64 x 130k = 8.3M.
uint32 constant CURVE_REDUCE_CHUNK_LEAVES = 64;
// Stage F costs about 210k per provider including the ledger's reservation. 16 x 210k = 3.4M.
uint32 constant CURVE_ALLOCATE_CHUNK_PROVIDERS = 16;
