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

// ── Measured transaction budget (Phase 3, delta R-3)
// ───────────────────────────────────────
// Day 0 derived these from isolated primitive costs. Phase 3 executed the full 16 x 128 universe
// against the real stack and measured what the CONTRACT actually pays, which is 1.7x to 3.6x more
// per stage: storage, external-call and calldata overhead that a primitive benchmark never sees.
// Raw data in `evidence/phase3/stage-gas.json`. The Day 0 conclusion is unchanged — the full
// universe is executable — but it takes about 30 transactions rather than 18.
uint256 constant CURVE_TRANSACTION_GAS_CEILING = 24_000_000;
// 311 x 72,226 + 166,954 = 22.6M, so the Day 0 ceiling of 311 SURVIVES the remeasurement — but
// only after stage C was restructured leaf-major. Before that the measured cell cost was 128,914
// and 311 cells would have been a 40M transaction, above a whole block.
uint256 constant CURVE_MAX_CELLS_PER_TRANSACTION = 311;
// 256 x 72,226 + 166,954 = 18.7M, about 22% margin. Deliberately under the maximum: this is a
// local-node measurement and testnet gas is UNVERIFIED (AS-1).
uint256 constant CURVE_RECOMMENDED_CELLS_PER_TRANSACTION = 256;

// ── Stage chunk widths, all derived from the measured per-unit cost
// ────────────────────────
// 468,047 gas per (provider, market), measured. 32 x 468k = 15.0M.
uint32 constant CURVE_CACHE_CHUNK_UNITS = 32;
// 294,800 gas per leaf, measured. 48 x 295k = 14.2M.
uint32 constant CURVE_FINALIZE_CHUNK_LEAVES = 48;
// 345,416 gas per leaf, measured. 32 x 345k = 11.1M.
uint32 constant CURVE_REDUCE_CHUNK_LEAVES = 32;
// 527,172 gas per provider, measured, including the ledger's reservation. 16 is the
// whole provider ceiling, so this stage is always one transaction.
uint32 constant CURVE_ALLOCATE_CHUNK_PROVIDERS = 16;
