# Phase 5 deltas

Where the PRD, the plan or a prior phase's evidence disagrees with verified reality, reality wins and
the correction is recorded here. The three immutable documents are never edited.

Prior deltas: `docs/day0/PRD-DELTA.md` (A-*), `docs/phase1/PRD-DELTA.md` (P-*),
`docs/phase2/PRD-DELTA.md` (Q-*), `docs/phase3/PRD-DELTA.md` (R-*), `docs/phase4/PRD-DELTA.md` (S-*).
Phase 5's are **T-***.

---

## T-1 · §19.3 cannot be read literally: series supply is the aggregate, not the units

**Severity: would have over-issued every claim. Corrected before implementation.**

PRD §19.3 states the allocation invariant as

```text
sum encrypted series allocations = exact Midnight units received
```

Taken literally that is wrong, and the Phase 4 fixture shows the size of the error. Four numbers, all
distinct, all measured on Sepolia (delta [S-4](../phase4/PRD-DELTA.md)):

| | value | what it is |
|---|---|---|
| leaf capacity | 300,000,000 | what the winning (market, rate) *could* carry — **private** |
| **published aggregate** | **299,999,999** | the exact sum of successfully reserved allocations — public |
| units settled | 300,000,599 | `floor(aggregate * WAD / price)` — Midnight's denomination |
| buyer assets paid | 299,999,998 | `floor(units * price / WAD)` — what the maker actually paid |

A provider's reservation is denominated in **loan-token assets**. A Midnight *unit* is not an asset:
for a buy offer at a tick whose price is below WAD, `units > assets` by exactly the discount, and at
maturity `withdraw` pays `units` 1:1 in loan token. So units already carry the yield.

Minting series 1:1 against units would denominate a provider's claim in the redemption face value
while their contribution was principal. Every downstream statement then has to carry the conversion
implicitly, and the two that matter break:

- **invariant 5** (allocations sum to supply) becomes false, because reservations sum to 299,999,999
  and units are 300,000,599;
- **invariant 13** (supply ≤ real credit and reserves) becomes a comparison between two different
  denominations, which is not a comparison.

**The correction.** Series supply is the **published aggregate**. The unit-to-asset conversion is
expressed as a **public redemption factor** applied at redemption, not baked into the mint:

```text
supply                = published aggregate                        (299,999,999)
redemption factor     = units withdrawn / supply                   (public, per series)
provider redeemable   = confidential balance * factor              (applied to every claim alike)
```

This is what PRD §19.7 already requires of loss — *"the confidential ledger must apply the public
series loss factor consistently to every private claim"* — and a redemption factor above 1 (yield) and
below 1 (loss) are the same mechanism in opposite directions. Denominating the mint in principal is
what makes one mechanism serve both.

**Guard.** `SeriesAllocator` never reads `exactUnits` or `expectedBuyerAssets` as a mint quantity, and
`AggregateSolvencyVerifier` compares supply against reserves in assets with the factor stated
explicitly. The Phase 5 suite pins 299,999,999 as the minted supply against the fixture whose units
are 300,000,599, so an implementation that reverted to §19.3's literal reading fails on the 600.

---

## T-2 · There are TWO residues in this fixture, both equal to 1, and they are not the same residue

**Severity: an accounting confusion that reads as consistent. Named before implementation.**

Both are 1 in the Phase 4 Sepolia run, which is exactly why they must be named apart — a test that
asserts "the residue is 1" passes against either and proves nothing about the other.

| residue | arithmetic | value | visibility | destination |
|---|---|---|---|---|
| **unreserved residue** | leaf capacity − published aggregate | 300,000,000 − 299,999,999 = 1 | **private, and must stay private** | none. No provider has a claim on it |
| **funding residue** | published aggregate − buyer assets | 299,999,999 − 299,999,998 = 1 | **public** — both terms are already public | the declared dust account |

The unreserved residue is `NoxCurveEngine._runtime[epochId].dustResidue`, computed as
`sub(best.fill, aggregate)` in `publishAggregate`. Its docstring already states the binding
consequence: it is **granted to nobody and published never**, because publishing it would disclose the
winning leaf's total capacity by subtraction, and capacity is private. It arises from `safeDiv`
flooring each pro-rata share — up to one unit per provider — and it stays where it is.

The funding residue is public arithmetic over two public numbers, arising from the second floor in
`units → buyerAssets`. It is the only one PRD §19.8's dust account can hold, and the only one a
public policy can dispose of.

**Consequences, enforced rather than documented.**

- The unreserved residue is never minted, never granted, never published, and never named as dust in
  a public surface. Doing so would make leaf capacity recoverable.
- The funding residue has an explicit destination, is never swept to a developer wallet (§19.8), and
  is never silently absorbed into supply — invariant 15.
- No test asserts "residue == 1" without saying **which** residue, and the suite asserts them from
  different sources so a single-value coincidence cannot satisfy both.

---

## T-3 · The Phase 2 vault cannot lock capital under any configuration, so both P5-1 options need a new custody contract

**Severity: removed an option that appeared to exist. Measured.**

`docs/phase4/PHASE-5-PREREQUISITES.md` §P5-1 offers two routes and frames only the first as requiring
a redeployment — *"a vault revision with a handle-native entry point — redeployed, re-verified"* — against
*"settlement funded from the ledger's own custody"*. That framing implies the second route leaves the
deployed contracts in place. It does not, for two independent reasons, both verified:

**One.** `KyrveConfidentialAssetVault.reserver` is `immutable` and, on the vault actually deployed on
Sepolia, it is zero:

```
$ cast call 0x07e7247726270f7d409580fe2a872ea333257e45 "reserver()(address)" --rpc-url $SEPOLIA_RPC_URL
0x0000000000000000000000000000000000000000
```

`onlyReserver` reverts `ReserverNotConfigured` while it is zero, so `openReservation` and
`releaseReservation` are unreachable **forever**. `_locked` is permanently encrypted zero. There is no
parameter, no grant and no privileged call that changes it. Any lock at all needs a new deployment.

**Two.** The ledger-custody route needs the reservation to draw against the ledger's own custody
balance, but the seed comes from the vault: `NoxCurveEngine._copyProviderSnapshot` reads
`vault.confidentialAvailableOf(msg.sender)` and passes it into `ledger.seedProvider`
(`NoxCurveEngine.sol:938-943`). Changing that means a new `ReservationLedger`, and
`ReservationLedger.bindEngine`, `QuoteEpochController.bindEngine` and `CurveGraphRegistry.bindEngine`
are each one-shot — so a new ledger forces a new engine, controller and graph.

**So the redeployment set is identical for both options** and cannot be used to separate them. The
P5-1 decision is therefore made entirely on custody, ACL blast radius, aliasing, recovery and solvency
— see [`P5-1-DECISION.md`](P5-1-DECISION.md) §3 and §4. Recording this stops a future reader
reconstructing the rejected option's cost incorrectly and concluding it was cheaper.

---

## T-4 · A funded quote that never settles needs public tokens back before custody can be restored

**Severity: honest limit. Bounded, tested, not eliminated.**

The allocation order is forced: funding must precede settlement because Midnight pulls a public ERC-20
inside `take`, and allocation must follow settlement because a claim minted against a quote that then
fails to settle is a claim on nothing (PRD §12.8 states the same ordering).

So there is a window in which a provider's capital has left custody and no claim exists yet.
`SeriesAllocator.unwindChunk` closes it from both sides — burn the claim if one was minted, restore the
lock — and it is **permissionless**, because a retired quote is a public fact and a stalled keeper must
not be able to hold a provider's capital hostage (PRD invariants 12 and 20).

**What it cannot do.** The unwrapped loan tokens are in the series vault, and
`KyrveSeriesVault.recoverFunding` is Phase 4 code, deployed, and **operator-only**. This phase reuses
those vault instances deliberately — the P5-1 decision keeps the Phase 4 vault and its 300,000,599
units of Sepolia credit — so the restoration depends on an operator returning tokens that
`KyrveCustodyVault` cannot compel.

Two consequences, both stated rather than mitigated:

- if coverage has not returned, the wrapper's own `transfer` primitive moves encrypted zero rather
  than reverting, so `restoreLock` would credit a balance that later pays nothing. That is what
  `AggregateSolvencyVerifier` exists to make observable, and it is why the restore path is tested with
  the operator's return transaction included rather than assumed;
- if a holder transferred their claim onward before the unwind, `Nox.burn` takes encrypted zero and
  the unwind is short by that much. `SeriesOwnershipRegistry.isFullyUnwound` reports it; nothing
  pretends the burn succeeded.

Closing this properly needs a series vault whose retirement path returns funding without an operator,
which is a settlement-layer revision and is not Phase 5's.

## T-5 · Making the lock real removed one permanent provider grant, and added one per later epoch

**Severity: correction to the Phase 3 grant count. Measured.**

Phase 3 required a provider to grant **two** contracts access to their vault-balance handle — the
engine, which reads it as the sixth eligibility predicate, and the ledger, which subtracted from it.
`NoxCurveEngine._copyProviderSnapshot` proved both on chain before sealing.

Phase 5 moved the subtraction into `KyrveCustodyVault`, which computed the balance itself and already
holds `allowThis` on it. **The ledger grant is gone**, and `_requireLedgerAccess` was deleted rather
than left as a no-op — every grant a provider makes is permanent, there is no `removeAdmin`, and an
irreversible grant nothing needs is worth removing.

The per-epoch cost is therefore 35 mandate handles + 1 balance handle = **36 grants for a first
epoch**, unchanged, and see T-8 for what a second epoch costs.

## T-6 · The funding residue is recorded where it is produced and settled where it is held

**Severity: scope of the residue policy. Deliberate split.**

PRD §19.8 requires all rounding dust to belong to a public dust account and forbids sweeping it to a
developer wallet. `SeriesResidueAccount` satisfies the second requirement structurally — the
destination is `immutable`, visible in the verified constructor arguments, and `distribute()` takes no
parameters and no privileges, so anyone may trigger it and nobody may redirect it.

The first requirement is split across two contracts and the reason is the same as T-4: the residue is
loan tokens sitting in a Phase 4 series vault whose withdrawal is operator-only.
`SeriesAllocator.closeQuote` **records** the figure — derived on chain from two public numbers,
write-once per quote — and `SeriesResidueAccount.unsettledResidue()` names the gap until the tokens
arrive.

So the residue can never be *unrecorded*, and it can never be *redirected*. It can be late, and the
lateness is readable by anyone rather than discoverable by reconciling two contracts by hand.

## T-7 · Q-6 cannot be proven on chain without reintroducing the Q-5 hazard

**Severity: a limit on what the solvency verifier proves. Recorded rather than worked around.**

The custody vault's accounting invariant is

```text
sum(available) + sum(locked)  <=  asset.confidentialBalanceOf(vault)
```

and `AggregateSolvencyVerifier` does **not** prove it. Proving it needs an encrypted `sum(available)`,
and `KyrveCustodyVault` deliberately keeps none: an aggregate accumulated beside a provider's balance
is precisely how the Phase 2 vault draft handed its first depositor a permanent admin grant on the
protocol total — both were the same operation over the same operands, hence one handle with one
irreversible ACL entry (delta Q-5, caught by a test rather than a review). Adding two accumulators to
make the statement checkable would reintroduce the hazard the Phase 2 vault removed.

What Phase 5 does instead:

- **proves on chain** the statement invariant 13 actually asks for —
  `supply + pendingEntitlements <= credit + reserves - fees` — with an entirely public right-hand side
  and a single published `ebool` as the output, so no total is ever disclosed;
- **maintains** Q-6 by construction, with the argument carried in `KyrveCustodyVault.withdraw`'s
  docstring: every credit to `_available` is backed by a matching coverage increase and no path creates
  internal credit without one;
- **checks** Q-6 by decrypting every provider balance against the coverage in a bounded fixture.

That third item is test evidence, not an on-chain proof, and the difference is the whole point of
recording this. The one encrypted aggregate Phase 5 does keep — `_consumedTotal`, needed because the
funding unwrap requires exactly one handle — is isolated on every fold under a quote-scoped domain
before anything is granted, transferred or published.

## T-8 · A real lock rewrites the balance handle, so the engine's grant is per-epoch

**Severity: was a suite failure across three Phase 4 tests. Inherent, not fixed — paid for.**

Phase 3's reservation subtracted from a snapshot the ledger kept, so `confidentialAvailableOf` never
moved and the single grant a provider made at setup stayed valid for every later epoch.

Phase 5's reservation moves real capital. Locking rewrites `_available` to a **new handle**, and a Nox
ACL entry is per handle rather than per storage slot. A second epoch therefore fails at
`sealProviderSnapshot` with

```
EngineNotAuthorisedForHandle("0x0000007a6923…", "0xD429…")
```

naming a handle nobody has ever seen before. It surfaced as three failures in
`90-quote-settlement.ts`, all at the same call, all on the second and third epochs of a suite whose
first epoch passed — which is the signature of exactly this class of defect.

**It cannot be designed away.** Handles are immutable references, a grant cannot be pre-made for a
handle that does not exist yet, and `INoxCompute.allow` is gated on the caller already holding access —
so only the provider can make it, and only after the previous epoch has moved their balance.

The alternative was considered and rejected: `KyrveCustodyVault` is an admin on each new handle and
could grant the engine itself, removing the friction entirely. That would make a contract widen a third
party's access to a provider's balance without the provider's per-epoch consent, and "the provider
authorised this epoch's read" is worth one transaction.

So the cost is **one permanent grant per provider per epoch after the first** — which is the grant T-5
removed, spent differently. `openAndSeal` re-grants the current handle and skips the call when the
handle has not moved, so a first epoch pays nothing extra.

## T-9 · Funding must be keyed on the epoch, because activation refuses an unfunded vault

**Severity: was a design error that would have deadlocked the phase. Corrected.**

The obvious design keys confidential funding on the quote id: consume the locks for quote Q, unwrap into
Q's vault, allocate Q's claims. It cannot work, and the reason is one line of Phase 4 code.

`QuoteActivator.activate` calls `KyrveSeriesVault.prepareQuote`, which requires
`balance >= committedFunding + expectedBuyerAssets` and reverts `FundingShortfall` otherwise. So the
vault must ALREADY hold the money at the moment the quote is activated — and the quote id does not
exist until activation returns. Quote-keyed funding is therefore circular: funding waits for the id,
and the id waits for the funding.

Phase 4 never met this because it minted public USDC into the vault immediately before activating
(delta S-6). Phase 5 has no such shortcut, and the failure is loud: `activate` reverts
`FundingShortfall(600000509, 0)` on a run where every confidential step succeeded.

**The correction.** Funding is keyed on the **epoch**; allocation is keyed on the **quote**.

- `SeriesAllocator.consumeChunk(epochId, …)` and `unwrapFunding(epochId)` run before activation.
  `KyrveCustodyVault`'s per-round state and `Lock.fundingKey` carry the epoch id, not a quote id.
- `allocateChunk(quoteId, …)` runs after settlement, reads `provenance.epochId` from the quote itself,
  and refuses any quote whose epoch is not the round it draws on. The first allocation writes the
  quote id into the round, so a second quote can never reuse consumed capital.

**Why that is not a weakening.** Activation is terminal and there is one quote per epoch: the registry
refuses a second quote for an epoch id it has already seen, forever. So the epoch identifies the
funding round uniquely. The unwrap recipient is also strictly *stronger* than before — it is
`SeriesAllocator.VAULT`, an `immutable` checked against the series id at construction, rather than an
address derived from a quote. Threat T-G.

## T-10 · The wrapper must wrap the market's own loan token, or the unwrap moves the wrong asset

**Severity: was a silent test-harness fault producing a correct-looking failure. Fixed.**

Phase 5's funding path unwraps confidential capital back into a public ERC-20 and hands it to the
series vault, which pays Midnight in the market's `loanToken`. The wrapper's underlying and that loan
token must therefore be **the same ERC-20**.

Phases 2 to 4 could keep them apart because nothing ever crossed back: `KyrveWrappedAsset` wrapped its
own `TestUnderlyingERC20` and the vault was funded by minting `LocalMidnightFixture`'s USDC. The two
tokens coexisted harmlessly for three phases.

In Phase 5 they cannot. `finalizeUnwrap` moved the wrapper's underlying to the vault, the vault's
balance in the token it actually pays in stayed zero, and `activate` reverted
`FundingShortfall(600000509, 0)` — a message that names the shortfall but says nothing about the two
tokens, on a run where every encrypted step had succeeded.

`LocalMidnightFixture` hardcodes its own USDC as the loan token of every market it builds, so the fix
is an ordering one: `deployCurveHarness({ substrate: true })` deploys the Midnight substrate **before**
the wrapper and wraps its USDC, and `deploySettlement` reuses that substrate rather than deploying a
second Midnight. In production the identity is obvious — providers wrap the same asset the market lends
— which is exactly why a harness that quietly used two was worth catching.

## T-11 · A funded round with no minted claims could be unwound from under a live quote

**Severity: was a real hole. Found by a test, closed, with the residual risk recorded.**

The first `unwindChunk` read the quote id from `SeriesAllocator.Allocation.quoteId`, which is written at
the FIRST allocation. So a round that had been funded and activated but not yet allocated carried a zero
there, the retirement check was skipped entirely, and a keeper could reclaim provider capital from under
a quote a borrower could still settle. `102-series-attacks.ts` A7 caught it: *"unwinding a live quote:
expected a revert, but the call succeeded"*.

**The fix.** The quote is now DISCOVERED rather than supplied: `IKyrveQuoteRegistry.quoteOfEpoch` is the
registry's own index, and it is total because the registry refuses a second quote for an epoch id it has
already seen, forever. A live quote can therefore always be found, and cannot be hidden by passing a
different id.

**The case with no quote at all.** A round can be funded and never activated, and providers must not be
stuck behind a keeper that simply stopped. So `unwindChunk` permits it after `UNWIND_GRACE` — seven days
against `QuoteActivator.MAX_QUOTE_LIFETIME` of one day, long enough that an activation inside the window
is an operational fact rather than a race.

**The residual risk, stated rather than argued away.** An unwind after the grace, followed by an
activation and a settlement, would create credit no claim owns, paid for by tokens meant to go back. It
requires the keeper to act adversarially after a week of silence, and the keeper is an immutable,
non-open role in this release for exactly that reason (`docs/phase4/SECURITY.md`). Closing it fully needs
the activator to consult the allocator, which would make activation depend on the confidential layer —
a coupling Phase 4 deliberately does not have.
