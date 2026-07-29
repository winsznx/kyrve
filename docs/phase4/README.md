# Phase 4 — quote activation and Midnight settlement

One confidential curve result becomes one executable Midnight offer, and settles exactly once or not
at all.

```
a sealed, complete confidential epoch
        -> KyrvePublicResultVerifier   binds five gateway proofs to one sealed graph
        -> QuoteActivator              the public/private boundary crossing, once per epoch
        -> KyrveQuoteRegistry          one status word, read by both enforcement points
        -> KyrveSettlementRatifier     authenticates WHICH offer and WHOSE fill
        -> KyrveSeriesVault.onBuy      enforces HOW MUCH — the only place fill size reaches maker code
        -> unmodified Morpho Midnight  take()
        -> public credit and public debt
```

## What is here

| File | Role |
|---|---|
| `KyrveQuoteTypes.sol` | the shape of one activated quote, split hot from cold |
| `KyrveQuoteId.sol` | the fold that makes every binding structural rather than nominal |
| `KyrveQuoteRegistry.sol` | the quote lifecycle, and the one state both enforcement points read |
| `KyrvePublicResultVerifier.sol` | turns a replayable gateway proof into a statement about one epoch |
| `QuoteActivator.sol` | the boundary crossing; derives everything it can rather than accepting it |
| `KyrveSettlementRatifier.sol` | `IRatifier` — offer identity, bound terms, taker, expiry, chain |
| `KyrveSeriesVault.sol` | the Midnight maker, the callback, and exact-fill enforcement |
| `KyrveSeriesFactory.sol` | one series, one vault, one deterministic address |
| `KyrveQuoteExpiryController.sol` | who may end a live quote, and when |
| `interfaces/ICurveLayer.sol` | the confidential layer's ABI, declared across a compiler boundary |

Plus `packages/quote` (the same sizing rule and quote-id fold in TypeScript, differentially tested
against the Solidity) and the settlement band in `apps/web`.

## The three things worth knowing before changing anything

**Exact fill is composed and cannot be collapsed.** `isRatified` is `view` and never receives `units`;
Midnight permits `newConsumed <= offer.maxUnits`. Weakening either half makes partial fill possible.
`docs/phase4/SECURITY.md` has the table of what each removal costs.

**`aggregateFill` is the sum of RESERVED provider allocations, never the winning leaf's capacity.**
They differ by floor-division dust — a leaf that could carry 300,000,000 reserves 299,999,999. Units
round down from the aggregate and buyer assets round down from the units, so the maker never owes more
than providers committed. Nothing anywhere reconstructs a fill from capacity.

**A single transaction may not exceed 16,777,216 gas.** EIP-7825, Osaka. Delta S-2, and the reason the
universe chunk width is 192 rather than 256.

## Reading order

1. `docs/phase4/GATE.md` — what is proven, what is not, and what a reader should not conclude.
2. `docs/phase4/PRD-DELTA.md` — the nine Phase 4 corrections, S-1 through S-9.
3. `docs/phase4/SECURITY.md` — every attack, the Slither triage, the gas measurement.
4. `docs/phase3/PHASE-4-PREREQUISITES.md` — what Phase 3 said had to be true first, and which of it
   this phase discharged.
5. `docs/phase4/PHASE-5-PREREQUISITES.md` — what must be true before confidential series ownership,
   and the four constraints Phase 4 established by measurement.

## Commands

```
pnpm verify:phase4                     every gate, with an honest summary
pnpm verify:gas-cap                    the Osaka per-transaction limit, as a regression gate
pnpm verify:basenames                  no two compiled sources may share a basename
pnpm verify:curve-abi                  ICurveLayer against the compiled confidential layer
pnpm verify:settlement [local|sepolia] the deployed layer, read back from chain state
pnpm deploy:settlement [local|sepolia] deploy and bind, reading every binding back
pnpm verify:etherscan:settlement       Etherscan V2, including every vault instance
pnpm exec tsx scripts/test/sepolia-settlement-budget.ts   price the flow before broadcasting
pnpm test:sepolia-settlement           one real quote, activated and settled on Sepolia
```

The confidential settlement suite needs Docker. Without it `verify:phase4` reports **NOT VERIFIED**
and exits non-zero rather than reporting green over an unexercised confidentiality path.

## What Phase 4 deliberately does not do

No confidential series ownership, no Cross, no Roll, no Cloudflare resource of any kind. The vault
settles from **public** funding: a curve reservation is still not a capital lock, prerequisite P4-2 is
open on purpose, and delta S-6 says so in those words rather than leaving it to be discovered.
