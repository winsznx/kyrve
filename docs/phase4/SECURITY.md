# Phase 4 security

Quote activation and Midnight settlement. What was attacked, what the attacks found, and what is
still open.

---

## The composition, and why neither half can be dropped

`IRatifier.isRatified` is `view` and never receives `units`. Midnight permits partial fills —
`newConsumed <= offer.maxUnits`. So a ratifier can authenticate an offer and is *structurally
incapable* of enforcing its size, and `KyrveSeriesVault.onBuy` is the only point where an attempted
fill's actual `units` and `buyerAssets` reach maker code.

Neither is redundant:

| Removed | Consequence |
|---|---|
| the ratifier's offer-hash check | any offer for a known group settles, at any tick, any expiry, any callback |
| the ratifier's taker check | anyone with collateral takes the borrower's quote |
| `onBuy`'s `units` check | every quote is fillable at any size up to its maximum |
| `onBuy`'s `buyerAssets` check | the maker pays an amount the quote was never priced at |
| the registry's single status word | the two enforcement points can disagree about whether a quote is live |

Every row has a paired test that fails with the check removed.

## What was attacked, and by what

**122 Foundry tests** against real unmodified Midnight, and **21 demonstrations** against the real
Nox stack and real Midnight on one chain (17 headless, plus the 9-step Chromium flow which overlaps).

| Attack | Result | Where |
|---|---|---|
| partial fill | `WrongUnits` | `Settlement.t.sol`, lifecycle 6, side channel |
| oversized fill | `ConsumedUnits`, from Midnight's own accounting | `Settlement.t.sol`, lifecycle 8 |
| unauthorised taker | `UnauthorisedTaker` | `Settlement.t.sol`, lifecycle 5 |
| altered tick, market, callback, maxUnits | `AlteredOffer` | `Settlement.t.sol`, lifecycle 16 |
| altered group | `QuoteNotExecutable` — the substituted group has no quote | `Settlement.t.sol` |
| wrong deployment | `RatifierUnauthorized`, then `QuoteNotExecutable` with the maker's authorisation granted | `Settlement.t.sol` |
| replay | `QuoteNotExecutable` | `Settlement.t.sol`, lifecycle 13, Chromium 18h |
| callback spoofing, direct | `CallbackCallerNotMidnight` | `Settlement.t.sol` |
| callback spoofing with Midnight as caller and wrong numbers | `WrongUnits` | `Settlement.t.sol` |
| malicious callback data naming another quote | `QuoteNotExecutable` | `Settlement.t.sol` |
| re-entrancy from the taker's own `onSell`, after tokens moved | refused; group consumed once | `Settlement.t.sol` |
| re-entrancy from the loan token's `approve` | refused; quote consumed once | `Activation.t.sol` |
| false-returning `approve` | `ApprovalRejected` | `Activation.t.sol` |
| silent (void) `approve` | fails closed in the decoder | `Activation.t.sol` |
| allowance residue before approving | `AllowanceResidue` | by construction; settlement asserts zero after |
| duplicate activation, same terms | `QuoteAlreadyActivated` | `Settlement.t.sol` |
| duplicate activation, different terms | `EpochAlreadyQuoted` | `Settlement.t.sol` |
| stale epoch (not `Complete`) | `EpochNotComplete` | `Activation.t.sol` |
| unsealed graph | `GraphNotSealed` | `Activation.t.sol` |
| wrong graph root, request, universe | `GraphRootMismatch`, `RequestMismatch`, `UniverseMismatch` | `Activation.t.sol` |
| universe hash disagreeing with the epoch | `UniverseHashMismatch` | `Activation.t.sol` |
| tampered decryption proof | refused by the gateway's signature check | `Activation.t.sol`, lifecycle 17 |
| partial published-handle set (R-14) | `PublishedHandleMissing`, naming the role | `Activation.t.sol` ×3 |
| handle from another epoch | `PublishedHandleUnregistered` | `Activation.t.sol` |
| leaf index not carrying the selected pair | `UnselectedLeaf` | `Activation.t.sol` |
| grid price disagreeing with `TickLib` | `LeafPriceMismatch` | `Activation.t.sol` |
| market struct / market id substitution | `MarketStructMismatch`, `MarketIdMismatch` | `Activation.t.sol` |
| cancellation race, both orderings | exactly one wins, the other refused by name | `Settlement.t.sol` |
| expiry boundary | fillable at `expiry`, recoverable at `expiry + 1`, never both | `Settlement.t.sol` |
| recovery reaching committed capital | `FundingShortfall` | `Settlement.t.sol` |
| unauthorised activation, cancellation, retirement, recovery | `NotKeeper`, `NotOperator`, `NotExpiryController`, `NotActivator` | both suites |
| chunk width 193 and 256 | `ChunkOutOfBudget` | `08-chunk-width.ts` |

## Slither

`pnpm verify:slither`, scoped to the seven deployed contract paths: **0 High/Medium findings**.

One Medium was found and **fixed rather than suppressed**: `unused-return` on
`QuoteActivator._resolveLeaf`, which called `CurveUniverseRegistry.requireActive` and discarded the
universe hash it returns. The fix uses the value — the hash is now compared against the one the epoch
sealed, with `UniverseHashMismatch` and a paired negative test. A universe is frozen at activation so
this cannot drift in production; asserting it costs one comparison and turns "cannot" into something
checkable.

Low-impact `reentrancy-events` findings remain, on nine functions across both the Phase 1 and Phase 4
contracts. Triaged individually: in every case the state write precedes the external call and only
the `emit` follows, so checks-effects-interactions holds and event ordering carries no security
property. The state guard is what prevents double settlement, and the two re-entrancy tests
demonstrate it. `naming-convention` findings on `SCREAMING_CASE` immutables are accepted, as Phase 1
accepted them: an immutable is a constant in every sense that matters to a reader.

## The gas side channel

Measured across nine outcomes with calldata, storage warmth, order, token state, approval state and
quote state controlled. `evidence/phase4/gas-side-channel.json`, `pnpm --filter @kyrve/confidential
test`.

**The conclusion is narrower than Phase 3's, because the question is different.** Nothing on the
settlement path is confidential: the market, rate, amount, borrower, expiry, offer and registry
status are all public from activation. A gas difference between "settled" and "refused" leaks nothing
`eth_getLogs` does not already give away, and presenting a measurement of it as a privacy result
would be dishonest.

What was established:

- all eight refusals are **named public reverts**, resolved against deployed ABIs, producing six
  distinct errors — `WrongUnits`, `ConsumedUnits`, `UnauthorisedTaker`, `OfferExpired`,
  `QuoteNotExecutable`, `AlteredOffer`. They do not collapse to one reason;
- **refusal gas is unavailable on this node** and is recorded as `null`, not as zero: EDR validates a
  transaction before including it and refuses a reverting one at submission, so no receipt exists. A
  comparison across refusals is not part of this result and is not claimed;
- the two successful settlements differ by **75,667 gas** because the first pays cold-storage costs
  the second does not. Reported rather than smoothed — it is exactly why a single-pass gas comparison
  here would be unsound;
- activation gas is uniform to within 24 gas across eight cases, which is unsurprising: the outcome
  is not known at activation.

**No claim of gas indistinguishability is made, here or anywhere.**

## Key material and privilege

Three immutable roles, all currently one address on Sepolia, and that is stated rather than hidden:

| Role | Can | Cannot |
|---|---|---|
| keeper | activate a quote | change its terms, choose its vault, choose its borrower, cancel, settle |
| operator | cancel a live quote, withdraw **uncommitted** funding | activate, settle, touch committed capital |
| curator | create a series | activate, cancel, settle, move a token |

Separating them is a key-management change, not a contract change: all three are constructor
arguments. Nothing has an owner, a pause, an upgrade path or an arbitrary-call surface. The three
one-shot bindings revert forever after the first call.

The Sepolia deployer key is a hot wallet in the sense `.claude/rules/security.md` means: anyone with
repository access and the `.env` can spend it. It holds testnet ETH and testnet tokens only.

## Still open

- **P4-2 — a reservation is not a capital lock.** Phase 4 settles from public funding and mints no
  confidential series ownership. Delta S-6. This is the largest open item and it is deliberate.
- **`cacheProviderChunk` at 14,984,397 gas** is 10.7% under the Osaka cap and is the next width that
  will need attention. `verify:gas-cap` names it as tight on every run.
- **The bond a borrower can still cancel after their request was sealed.** Carried from Phase 3; the
  request book cannot consult `QuoteEpochController.sealedInto` because it predates it.
- **Public-network confidential latency at scale.** One four-cell epoch has run on Sepolia. The
  16 × 128 universe has only ever run locally, and now fits the cap — but "fits" is a measurement, not
  an execution.
