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
