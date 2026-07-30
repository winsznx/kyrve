# Phase 6 prerequisites

Phase 6 is Cross, Roll, Capsule and the Cloudflare application. None of it starts before this file is
read.

Phase 5 made a curve reservation into a real capital lock, turned a settled Midnight position into
confidential ERC-7984 claims, and proved the ownership journey in a real browser. What it did **not** do is
finish on a public network: the series layer is not deployed on Sepolia, because the sequence is priced and
the deployer cannot cover it. That is P6-0, it is first, and it is open on a measured number rather than
half-built.

Five entries below are constraints Phase 5 established by measurement or by failure. Each recurs at a point
where the consequence is lost capital or a mispriced claim rather than a failed test.

---

## P6-0 · Phase 5 is not finished on a public network

One of the brief's PASS conditions is unmet, and `docs/phase5/GATE.md` records it as a distinct
`NOT FUNDED` verdict — never as a PASS — with the exact shortfall rather than folding it into the pass
count.

**The ownership view in real Chromium is DONE.** `apps/web` now carries an ownership band and
`confidential/test/101-series-browser.ts` drives it: provider A decrypts a balance equal to the plaintext
reference model and disconnecting removes it from the DOM; provider B, in a separate browser context with
a separate injected key, is refused A's balance with `not-authorised`, decrypts their own, and reads supply
equal to the published aggregate with a solvency verdict of true. A fourth test collects every origin the
page contacted and compares it against exactly three legitimate ones. The gate RUNS that demonstration
rather than reading its evidence file.

**Sepolia.** Nothing was broadcast, and no deploy, verify-on-chain or allocation script was written
either. That is deliberate: carry-over 8 says *"a verification command that has never run is worse than a
missing one"* (deltas R-11 and R-13), and a deploy script wired into a gate that cannot be executed against
anything is exactly that. The path becomes writable — and testable — the moment the deployer is funded.

The cost is **measured, not estimated**, and `pnpm test:sepolia-series-budget` runs on every gate
invocation. It calls `eth_estimateGas` against the live network with the real creation bytecode and the
real encoded constructor arguments for every contract, adds the transaction sequences from real measured
runs, prices the total at the live base and priority fee, and appends the prediction to an append-only
ledger.

| | measured |
|---|---|
| total sequence | **58,546,501 gas** |
| — the confidential epoch alone | 26,931,546 gas (46%) |
| — every deployment | 26,610,154 gas |
| effective gas price | 972,818,563 wei |
| predicted cost | 0.056955122971498063 ETH |
| required at a 35% margin | **0.076889416011522385 ETH** |
| deployer balance | 0.048735012281547763 ETH |
| **shortfall** | **0.028154403729974622 ETH** |

**Required:** fund `0x36C3d1AF18b9186A662B1e277c80Ab54bE2765C2` by at least the shortfall and re-run the
preflight. It reports FUNDED and names the deploy command, or it reports the new shortfall. The gate keeps
the three Sepolia steps as SKIP until a deployment record exists, and none of them may be downgraded to
PASS for a sequence nobody performed.

**Two things about that total that are not negotiable.** Nearly half of it is one confidential epoch,
dominated by 36 **permanent** ACL grants per provider that a new engine cannot inherit (deltas T-5 and
T-8). The deployment half is the whole curve and settlement stack, because `bindEngine` is one-shot on
`ReservationLedger`, `QuoteEpochController` and `CurveGraphRegistry` and `NoxCurveEngine` holds the vault
as an `immutable` — and P5-1 §3 shows the rejected option needed exactly the same set, so it is not a cost
the architecture choice introduced. `CurveUniverseRegistry`, `KyrveWrappedAsset`, `EncryptedMandateBook`,
`ConfidentialRequestBook` and `KyrveEmergencyController` are all reused, which keeps registered universes
and provider wrapper balances alive across the migration.

**And the Phase 4 settled position cannot be reused, which was checked rather than assumed.** It was
created by a quote in the Phase 4 `KyrveQuoteRegistry`, which a redeployed stack replaces.
`SeriesAllocator.allocateChunk` reads the quote from the registry it was constructed against and requires
`provenance.epochId` to name the epoch whose locks it consumed — and those locks live in the new custody
vault, created by the new ledger, driven by the new engine. There is no arrangement in which the old quote
and the new locks are the same funding round. So the sequence is a new connected epoch and a new exact
settlement, which is what the 26.9M component prices, and which is the fallback the brief itself names.

## P6-1 · A funded round whose quote never settles needs public tokens back, and Kyrve cannot compel it

`SeriesAllocator.unwindChunk` is permissionless and bounded by exactly what was consumed. What it cannot do
is return the loan tokens: they are in a Phase 4 `KyrveSeriesVault` whose `recoverFunding` is operator-only,
and Phase 5 reuses those vault instances deliberately so the Sepolia position stays owned.

If coverage has not returned, the wrapper's own `transfer` primitive moves **encrypted zero** rather than
reverting, so the restoration credits a balance that later pays nothing. `102-series-attacks.ts` A7 proves
the whole path with the operator's return transaction included, and ends with a withdrawal that really
moves — because only a real withdrawal distinguishes restored capital from a restored number.

**Required:** Cross and Roll each create *new* offers from existing claims, so each opens the same window
and each needs its own unwind. A residual-settlement adapter that funded from custody and then failed would
strand capital exactly here. Delta [T-4](PRD-DELTA.md). Closing it properly needs a series vault whose
retirement path returns funding without an operator — a settlement-layer revision, not a Phase 5 one.

## P6-2 · Q-6 is maintained and tested, never proven on chain

`sum(available) + sum(locked) <= asset.confidentialBalanceOf(vault)` is **not** provable on chain, and the
reason is structural rather than an omission: it needs an encrypted `sum(available)`, and an aggregate
accumulated beside a provider's balance is precisely how the Phase 2 vault draft handed its first depositor
a permanent admin grant on the protocol total (delta Q-5, caught by a test rather than a review).

`AggregateSolvencyVerifier` proves the statement invariant 13 actually asks for —
`supply + pendingEntitlements <= credit + reserves - fees` — with a fully public right-hand side and a single
published `ebool` as the output, so a solvency check is not itself a permanent disclosure.

**Required:** Capsule snapshots and any Cross or Roll accounting must not add a second encrypted aggregate
to "make solvency checkable". The one Phase 5 keeps — `_consumedTotal`, needed because the funding unwrap
requires exactly one handle — is isolated on **every** fold under a quote-scoped domain before anything is
granted, transferred or published. Copy that discipline or do not add the aggregate. Delta
[T-7](PRD-DELTA.md).

## P6-3 · Series supply is principal, and the conversion is a public factor

Three numbers are distinct and must never be conflated. On the Phase 4 Sepolia fixture: capacity
300,000,000, published aggregate 299,999,999, units 300,000,599, buyer assets 299,999,998.

`KyrveSeriesToken`'s supply is the **published aggregate**. PRD §19.3's literal reading — supply equals the
Midnight units — over-issues by 600 on that fixture and makes invariant 5 false, because a unit already
carries the discount. The unit-to-asset conversion is `redemptionFactorWad`, computed on chain from two
public numbers so anyone can reproduce it. Delta [T-1](PRD-DELTA.md).

**Required:** Cross prices claims against each other and Roll moves them across maturities. Both need the
factor of the series they are leaving and the series they are entering, and neither may denominate a claim
in units. `MaturityRedemptionQueue` inherits the same rule: `redeem` already burns principal and accrues
the factor-adjusted entitlement, and the payout must not re-apply it.

## P6-4 · A real lock rewrites the balance handle, so a grant is per-epoch

A Nox ACL entry is per handle, not per storage slot. Locking rewrites `_available` to a new handle, so the
engine needs a fresh permanent grant each epoch. It surfaced as three Phase 4 test failures on the second
and third epochs of a suite whose first epoch passed — the signature of exactly this class of defect.

It cannot be designed away: a grant cannot be pre-made for a handle that does not exist, and `allow` is
gated on the caller already holding access. Letting the custody vault grant the engine itself was
considered and rejected — it would widen a third party's access to a provider's balance without the
provider's per-epoch consent.

**Required:** every new consumer of a live balance handle pays the same cost, and a Cloudflare keeper that
assumed one grant lasts forever would fail on the second epoch of every provider. Budget one permanent
grant per provider per epoch after the first, and re-grant only when the handle has actually moved. Delta
[T-8](PRD-DELTA.md).

## P6-5 · Two irreversible crossings, and both are in this phase's hot path

Nox has no `removeViewer`, no `removeAdmin` and no un-publish.

- `KyrveWrappedAsset.unwrap`, inside `KyrveCustodyVault.unwrapQuoteFunding`. The published plaintext is the
  epoch's aggregate, which was already public — but it *also* discloses whether the vault could cover it
  in total, because a short vault burns encrypted zero. That is a protocol solvency fault rather than a
  private fact, and no provider is identified. Finding F-9.
- `allowPublicDecryption`, inside `publishAggregateSupply` (once per token, then it reverts) and
  `proveSolvency` (once per snapshot, on the verdict bit only).

**Required:** Capsule is where this bites hardest — capsules use **fresh snapshot handles** and auditors
never receive access to a live portfolio handle, and the UI must never say "revoked" for a handle a viewer
could already decrypt. Use "live access ended", "future snapshots disabled", "this historical snapshot
remains available". Carry-over 10 from Phase 4, unchanged.

---

## Carried forward, still binding

Everything in `docs/phase4/PHASE-5-PREREQUISITES.md` remains in force. Three are discharged by this phase:

- **P5-1** — decided in its own commit before any code, implemented, and the decision is itself a gate.
  `docs/phase5/P5-1-DECISION.md`.
- **P5-2** — series ownership is minted against the published aggregate, and both residues are named,
  separated and tested from different sources. Deltas T-1 and T-2.
- **P5-4** — the published handle set is still read only after `publishAggregate`; the Phase 5 suite reads
  it through `collectPublicResult`, which is the same path the Phase 4 regression covers.

**P5-3 is not discharged and does not need to be.** `cacheProviderChunk` is still the tightest stage at
14,984,397 gas and 10.7% margin, and Phase 5 added no work to it. `verify:gas-cap` names it on every run.

And the three items Phase 4 listed as outside the dependency chain are all still outside it:

- **Key separation.** Keeper, operator and curator are three immutable constructor arguments that are one
  Sepolia address. Phase 5 adds a fourth role — the residue account's declared beneficiary — and it is
  also immutable. Separating them is a deployment, not a code change, and should happen before anything
  holds value.
- **The bond a borrower can still cancel after their request was sealed.** Unchanged from Phase 3.
- **A 16 × 128 epoch on a public network.** Still UNVERIFIED. Sepolia has only ever run a four-cell epoch.
