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
