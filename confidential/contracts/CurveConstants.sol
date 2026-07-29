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
// ════════════════════════════════════════════════════════════════════════════════════════════
// THE CEILING IS A PROTOCOL RULE NOW, NOT A LOCAL MEASUREMENT — Phase 4 delta S-2
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// Phase 3 set this to 24,000,000: a judgement about what a sensible transaction should cost,
// measured on a local node the Nox plugin had configured as an OP chain at Isthmus, which enforces
// no per-transaction gas limit at all.
//
// EIP-7825, introduced in Osaka, caps a single transaction at 2^24 = 16,777,216 gas regardless of
// the block gas limit — 60,000,000 on that same node, which is exactly why the cap is invisible
// unless you look for it. Ethereum Sepolia is on Osaka and Kyrve compiles for Osaka, so this is not
// a preference any more and there is no override. Measured on both sides of the boundary by
// `confidential/test/09-osaka.ts`: 16,777,216 is accepted, 16,777,217 is refused.
uint256 constant CURVE_TRANSACTION_GAS_CEILING = 16_777_216;
// 192 x 71,068 = 13,645,056, which is 18.7% under the Osaka cap.
//
// The old bound was 311 (22.6M at the old ceiling) with a recommendation of 256, measured at
// 18,193,386 — 1,416,170 OVER the cap, and the only stage width that was. The measured cost is
// dominated by the per-cell term, so the largest chunk that FITS is about 236; 192 is chosen
// instead, for the same reason 256 sat under 311: this is a local-node measurement and testnet gas
// is UNVERIFIED (AS-1), so the bound carries margin rather than sitting on the limit.
//
// The maximum and the recommendation now coincide. Under a 24M ceiling there was room for a
// permitted maximum and a smaller advised width; under 16.7M the margin belongs in the maximum,
// because a universe created at the maximum must be executable and nothing else enforces it.
uint256 constant CURVE_MAX_CELLS_PER_TRANSACTION = 192;
uint256 constant CURVE_RECOMMENDED_CELLS_PER_TRANSACTION = 192;

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
