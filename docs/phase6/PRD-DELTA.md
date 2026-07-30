# Phase 6 — PRD delta

Where the PRD and verified reality disagree, reality wins and the delta is recorded here. The three
immutable documents are never edited.

Numbering continues the series: Day 0 `D-`, Phase 1 `P-`, Phase 2 `Q-`, Phase 3 `R-`, Phase 4 `S-`,
Phase 5 `T-`. Phase 6 is `U-`.

---

## U-1 · A Kyrve deployment serves exactly ONE series, and a roll needs two

**Status:** confirmed by execution. **Severity:** architectural.

Nothing before Phase 6 needed two series, so nothing had noticed that a deployment cannot have them.
The chain is mechanical:

```
KyrveCustodyVault.bindSettler          one-shot
  └─ settler is a SeriesAllocator
       └─ holds SERIES_ID, TOKEN, OWNERSHIP, VAULT, MARKET_ID as immutables
            └─ a second series needs a second allocator
                 └─ which needs a second custody vault to be the settler of
                      └─ NoxCurveEngine holds the custody vault as an immutable
                           └─ bindEngine is one-shot on QuoteEpochController,
                              CurveGraphRegistry and ReservationLedger
                                └─ and KyrveQuoteRegistry.bindActivator is one-shot,
                                   so the settlement layer follows
```

This is the same cascade `scripts/deploy/series.ts` documents for a new engine, arrived at from the
opposite direction. The first attempt at the Roll suite failed with `SettlerAlreadyBound` — the
correct refusal, naming nothing about the cause.

**Consequence.** A Cross book operates within one series and is unaffected. A **Roll book spans two,
so a roll between maturities requires two complete confidential layers**, sharing the emergency
controller, the wrapped asset, both books, the universe registry and the Midnight substrate.
`confidential/test/market-helpers.ts::deployParallelCurveLayer` is that cascade, and
`confidential/test/130-roll.ts` runs the whole Phase 3–5 lifecycle twice.

**Not a defect.** Every one-shot binding in the chain exists for a reason recorded in its own
contract — a rebindable settler is an arbitrary-spend surface over every locked balance (threat
T-B), a mutable allocator is a second route to minting. What is wrong is only that the cost was
undocumented.

---

## U-2 · A roll TRANSFERS. "Source burn, target mint" over-issues the target series

**Status:** corrected in the implementation. **Severity:** would have broken invariant 5.

PRD §13.18 and the Phase 6 brief describe a roll as burning the source claim and minting the target
claim. Taken literally that mints target claims backed by nothing: `KyrveSeriesToken`'s supply is the
published aggregate of capital providers actually committed, every unit of it backed by a real
settled Midnight position. A minted roll would make invariant 5 (allocations sum to supply) false by
exactly the rolled amount, and `AggregateSolvencyVerifier` would report the target series insolvent
— correctly.

**This is delta [T-1](../phase5/PRD-DELTA.md) again, in a new place.** T-1 corrected "supply equals
the Midnight units", which over-issued by 600 on the measured fixture. The same literalism here
over-issues by the whole roll.

`KyrveRollBook` therefore transfers on both legs, out of target inventory a supplier escrowed. It
could not do otherwise anyway: `mintClaim` is `onlyAllocator` and takes an `euint256` rather than a
number, so there is no overload that mints from a quantity.

**The resulting claim is stronger than the one the brief asked for.** Neither series' live
`confidentialTotalSupply` handle moves across a roll — `Nox.mint` and `Nox.burn` are the only
operations that touch it and both produce a new handle, so an unchanged handle says the operation
never happened rather than that it netted to zero. Demonstrations 19, 20 and 23.

---

## U-3 · Capsule expiry is not revocation, and no UI may say otherwise

**Status:** structural, permanent. **Severity:** disclosure semantics.

`Nox.allow` has no inverse. `sdk/Nox.sol` version 0.2.4 has no `removeViewer`, no `removeAdmin` and
no way to un-set public decryption — only `disallowTransient` exists.

So a capsule's `expiry` bounds exactly one thing: how long the capsule **asserts** its scope. The
recipient can decrypt the snapshot they were given forever, including after expiry, and no state on
`KyrveCapsuleVault` changes that.

The accessor is named `assertsValidAt`, not `isValid`, for this reason, and demonstration 7c proves
it rather than implying it: after the capsule stops asserting, the recipient still decrypts the
snapshot. The UI must say **"live access ended"**, **"future snapshots disabled"** or **"this
historical snapshot remains available"**, never "access revoked". Carry-over 10 from Phase 4, P6-5
from Phase 5, `.claude/rules/security.md`.

The same wording applies to auditor rotation: rotating the declared auditor revokes nothing, and
`docs/phase6/ROLES.md` says so in the rotation table.

---

## U-4 · Separating the roles found a latent confusion the suite could not have caught

**Status:** fixed. **Severity:** test integrity.

Through Phase 5 the deployer, the curator and the emergency guardian were all local wallet 0, so the
suite could not distinguish a contract that gated the right role from one that gated the wrong one.
Splitting them surfaced three real defects in the harness, all of which had been passing:

- `deployCurveHarness` sent three `onlyDeployer` bindings (`bindEngine` on the epoch controller,
  graph registry and ledger) and `bindReserver` **as the curator**. They now revert `NotDeployer` if
  that recurs.
- `81-curve-attacks` asserted `UniverseIsActive` on `activateUniverse` and `addMarket` from a wallet
  that would now be refused `NotCurator` first. Both tests would have kept passing while proving
  nothing about universe immutability.

**The general form.** A test suite whose privileged callers are one address cannot detect
role confusion, and 148 passing tests did not. This is why the suite's role indices now mirror
`scripts/lib/roles.ts` exactly rather than being chosen per file.

---

## U-5 · Slither does not cover the confidential layer, and could not be made to here

**Status:** UNVERIFIED. **Severity:** coverage gap, compensating controls named.

`verify:slither` scopes to `contracts/kyrve/`, `contracts/registry/` and four integration files —
the Foundry compilation unit at solc 0.8.34. It has **never** covered `confidential/contracts/`,
which is where `KyrveCustodyVault`, `KyrveSeriesToken`, `SeriesAllocator` and now
`KyrveCapsuleVault`, `KyrveCrossBook` and `KyrveRollBook` live. That was true before Phase 6 and is
recorded here because Phase 6 is the phase that put three new value-bearing contracts there.

Extending it was attempted and **failed in this environment**. `crytic-compile` cannot be made to
use solc 0.8.36 for these sources: with the pragma pinned exactly at `0.8.36`, every route tried —
`--compile-force-framework solc`, `--solc <0.8.36 binary>`, `--solc-solcs-select 0.8.36`,
`SOLC_VERSION=0.8.36` — reported `current compiler is 0.8.34`, while a direct `solc --version` in
the same shell reported 0.8.36. Reproduction:

```
cd confidential && solc-select use 0.8.36 && solc --version   # 0.8.36
slither contracts/KyrveCapsuleVault.sol --compile-force-framework solc \
  --solc-remaps "@iexec-nox/=node_modules/@iexec-nox/ @openzeppelin/=node_modules/@openzeppelin/"
# Error: Source file requires different compiler version (current compiler is 0.8.34...)
```

**What stands in its place, stated rather than implied.** The confidential layer's assurance comes
from the adversarial suites (`40-proof-attacks`, `81-curve-attacks`, `102-series-attacks`, and the
refusal halves of demonstrations 5, 7, 12, 14 and 21–22), from `verify:contract-size`,
`verify:gas-cap`, `verify:curve-abi`, `verify:settlement-abi` and `verify:basenames`, and from the
handle-lineage discipline that Slither has no detector for anyway. **None of that is a substitute
for a static analyser and this delta does not claim it is.**

---

## U-6 · The Midnight fixture's market 3 is a collateral PAIR, not a single token

**Status:** fixture finding. **Severity:** test-only.

`LocalMidnightFixture` market 3 is `usdc-90d-multi` and its collateral is `_sortedPair()`.
`supplyCollateral` supplies index 0 of whatever the market declares, and pointing a second epoch at
market 3 produced a Midnight balance revert naming `(0, 1000e18)` and nothing about the cause.

Two maturities of the same collateral are markets **0** (`usdc-30d-weth`) and **1**
(`usdc-90d-weth`), which is also what a roll actually is. `130-roll.ts` uses those and says why.

---

## U-7 · A hand-written ABI with the wrong integer width reverts with no reason at all

**Status:** fixed where it bit; the general hazard is recorded. **Severity:** tooling.

`scripts/deploy/universe.ts` declared `createUniverse`'s `cellsPerChunk` as `uint16`. The contract
declares `uint32`. That is a **different selector**, so the call reached no function on
`CurveUniverseRegistry` and reverted with no data — which reads exactly like a rejected argument, and
sent the first diagnosis at the validation logic rather than at the signature.

The same shape appeared twice more in one sitting. `addMarket`'s grid is `int24[]` (signed Midnight
ticks), not `uint32[]`. And `KyrveRoleRegistry`'s constructor takes `address[7]`, which
`deployments/*.json` records as a comma-joined string, so `cast abi-encode` stopped at the first
comma with `expected [` — the first array argument any Kyrve constructor has taken.

**This is a cost of a deliberate choice, not an accident.** Several scripts declare ABI fragments
inline rather than importing `packages/generated` — `kyrve-verify` most importantly — precisely so a
generated-ABI regression cannot make a tool agree with a build that no longer matches the chain. The
price is that a hand-written fragment can be wrong, and a wrong one fails in the least informative
way the EVM has.

**Required:** any new hand-written fragment is checked against the compiled artifact before it is
broadcast against, and a revert with no data on a call that should have matched is diagnosed as a
selector mismatch FIRST. `verify:curve-abi` and `verify:settlement-abi` already do this for the two
cross-compiler interfaces; the script fragments are not covered and this delta says so rather than
implying they are.

---

## U-8 · A Phase 6 layer epoch must be settlement-grade, and one was not

**Status:** guarded. **Severity:** an epoch's gas, spent and unrecoverable.

`sepolia-curve-epoch` builds one of two universes. Without `KYRVE_SETTLEMENT_UNIVERSE=true` it builds
Phase 3's **synthetic** one, whose market id is a placeholder; with it, one whose market is a real
Midnight market. Both run identically.

Layer A's first epoch was run without the flag. It completed perfectly — 91 ACL grants, all six
stages, a sealed graph, and a published aggregate of **299,999,999** matching the plaintext reference
model exactly. Then `activateQuote` died on `toMarket(0x…01)` with `MarketNotCreated()`, because
Midnight has never heard of that market. **The epoch is unsettleable and its gas is spent.**

The failure is late by construction: nothing before activation needs the market to exist, so the
confidential half is fully exercised against a market that cannot receive a quote. Its records are
kept as `sepolia-epoch-a-synthetic-abandoned.json` rather than deleted — this repository records what
happened, and an abandoned epoch is part of what happened.

**Guarded rather than remembered.** `KYRVE_EVIDENCE_TAG` is only ever set for a Phase 6 layer run,
and every Phase 6 layer run exists to reach settlement, so the two flags are now required together.
The refusal names the exact failure that follows from omitting it.

**What it does not invalidate.** The abandoned epoch is real evidence of the confidential curve on a
public network against the hosted gateway — sealed graph, five published handles, aggregate matching
the model. It is not evidence of settlement, and it is not counted as any.

---

## Carried forward, still binding

Everything in `docs/phase5/PRD-DELTA.md` remains in force. Three Phase 5 items are exercised again
here and none needed correction:

- **T-1** — supply is the published aggregate. Capsule freezes it, Cross prices against it, Roll
  converts from it. No path in Phase 6 denominates a claim in units.
- **T-2** — the two residues stay named apart. Cross and Roll each introduce a THIRD kind, the
  *unmatched remainder*, which is neither: it is the order owner's own capital, private until they
  choose to publish it, and returned in full by cancellation.
- **T-8** — a real lock rewrites the balance handle. Cross and Roll escrows are rewritten on every
  match, which is why `_writeEscrow` re-isolates and re-grants rather than assuming one grant lasts.

---

## U-9 · `SupplyState.Open` is public and says nothing about remaining inventory

**Status:** understood; drivers adapted. **Severity:** a keeper that reads public state alone nets
nothing and reports success.

`KyrveRollBook.supplyStatusOf` returns `SupplyState.Open` for a supply whose encrypted escrow has
already been drained to zero by an earlier netting. This is not an oversight — the escrow is an
`euint256` and the contract cannot publish "this supply is empty" without publishing a balance. The
public lifecycle and the private inventory are deliberately different things.

The consequence is operational. A keeper cannot decide from public state whether `netRoll` will move
anything; a supply that looks live may be spent. Worse, netting leaves floor-division **dust**, so
even "the escrow decrypts above zero" is not sufficient — the second netting against the residual
dust of the first moved nothing while every public check still passed.

The Sepolia driver therefore opens a fresh intent and a fresh supply on every run and never adopts
either. Only the supplier can read their own escrow, and the honest reading of the public state is
"this supply has not been cancelled and has not expired" — nothing more.

## U-10 · A bare `try/catch` around a simulation proved the wrong defence

**Status:** fixed. **Severity:** a passing test that demonstrated nothing.

The first complete Sepolia roll reported *"unwinding beyond the published residual is REFUSED"*. It
was refused. It was refused because the check ran **after** the residual was fully unwound and the
intent had reached `Completed`, so `settleResidual` reverted `IntentNotOpen(intentId, 3)` at the
state guard and never reached the ceiling at all. Decoding the revert data by hand is what surfaced
it: selector `0x25782cf8`, not `ResidualExceeded`'s `0x0c334f0f`.

Both refusals in the driver now assert the error **by name** through viem's
`ContractFunctionRevertedError`, and the over-unwind attempt was moved into the only window where the
ceiling can bind — while the intent is still `ResidualDeclared`. The stale-netting refusal has the
same hazard in mirror image and is asserted the same way.

This is `.claude/rules/testing.md` exactly: *"when asserting a revert, confirm you asserted the right
revert — a test passing for the wrong reason is worse than no test."* The rule was already written
down and the test was written anyway.

## U-11 · The Roll's conversion opens redemption before maturity, and says so

**Status:** recorded, not hidden. **Severity:** none if stated; a false claim if not.

`KyrveRollBook.conversionWad` is `sourceRedemptionFactorWad * WAD / TARGET_PRICE_WAD` and reverts
`SourceRedemptionNotOpen` rather than defaulting to par, because a roll accidentally priced at par
moves value between holder and supplier on every netting, silently and in one direction.

But `KyrveSeriesToken.setRedemptionFactor` documents `unitsWithdrawn` as *the loan assets the series
vault actually received from Midnight*, and no withdrawal has happened: the source series has not
matured and `MaturityRedemptionQueue` is out of scope by owner decision. The Sepolia roll therefore
opens redemption **early**, against the credit Midnight has already recorded for the series —
`VAULT.positionOf(MARKET_ID)`, 300,000,599 — over the published aggregate, 299,999,999.

Both operands are read live from chain by the driver rather than copied from an evidence file, the
contract emits `RedemptionFactorSet(factor, unitsWithdrawn, supplyReference)` so the derivation is
reproducible by anyone from public data, and `evidence/phase6/sepolia-roll.json` carries the caveat
in `sourceRedemptionOpenedEarly`. A factor derived from recorded credit is not the same statement as
a factor derived from a completed withdrawal, and the record must not blur them.
