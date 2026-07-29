# P5-1 · A reservation becomes a capital lock

**Status: DECIDED. Option A — handle-native vault revision.**
**Rejected: Option B — ledger custody.**

This file is the whole of the decision. It is committed before any series ownership exists, because
every contract Phase 5 builds sits downstream of it and a decision recorded after the fact is not a
decision, it is a rationalisation.

Read `docs/phase4/PHASE-5-PREREQUISITES.md` §P5-1 first. It states the problem; this states the
answer, what the answer costs, and what it would have cost to be wrong.

---

## 1. The problem, restated exactly

Two quantities are supposed to be the same quantity and are currently independent:

| | where it lives | who controls it |
|---|---|---|
| `sum(reserved allocations)` | `ReservationLedger._reserved`, encrypted, per epoch | nobody — it is bookkeeping over a **snapshot** |
| the capital that actually pays Midnight | `KyrveSeriesVault`'s **public** loan-token balance | an operator, tracked in `committedFunding` |

They agreed on Sepolia because one address funded both. PRD invariant 3 — *the sum of encrypted
allocations equals the Midnight credit received* — is therefore **arithmetically true and
custodially unenforced**, which delta [S-6](../phase4/PRD-DELTA.md) already says in those words.

The mechanical blocker has two halves, and both are verified rather than recalled.

**Half one — the deployed vault cannot accept a curve allocation.**
`KyrveConfidentialAssetVault.openReservation` takes `(externalEuint256 encryptedAmount, bytes
inputProof)`. `Nox.fromExternal` requires a gateway proof minted for a value its owner knows in
plaintext. A curve allocation exists **only** as a handle — that is the entire point of the engine —
so no such proof can be minted for it, by anyone, ever. Delta [R-1](../phase3/PRD-DELTA.md).

**Half two — the deployed vault cannot lock anything at all, under any configuration.**
This is new, it is measured, and it removes an option that looked available:

```
$ cast call 0x07e7247726270f7d409580fe2a872ea333257e45 "reserver()(address)" --rpc-url $SEPOLIA_RPC_URL
0x0000000000000000000000000000000000000000
```

`reserver` is `immutable`, and `onlyReserver` reverts `ReserverNotConfigured` while it is zero. So on
the vault that is actually deployed on Sepolia, `openReservation` and `releaseReservation` are dead
code: `_locked` is permanently encrypted zero and `available` is permanently the whole balance. There
is no parameter, no grant and no privileged call that changes that. **Any path to a real lock
requires a newly deployed custody contract.** The only open question was *which* contract.

---

## 2. The two options, as narrowly as they can be stated

**Option A — handle-native vault revision.** A new confidential asset vault, `KyrveCustodyVault`,
identical to the Phase 2 vault in what it holds and how it fails, with one entry point replaced: the
reservation entry takes an `euint256` the sealed curve graph produced, not an external proof. Capital
lives in exactly one place, which is where it already lives. The engine reads eligibility balances
from the same contract that will lock them.

**Option B — ledger custody.** The Phase 2 vault stays as-is. Provider capital moves *sideways* into
a Kyrve-controlled confidential ledger before curve execution, and reservations operate entirely
inside that ledger. Capital lives in two places and every path reconciles both.

---

## 3. What the two options do **not** differ on

Two things were expected to separate them and do not. Recording them stops either from being used as
an argument later.

**Neither avoids redeploying the curve layer.** This was the reason to hope for Option B. It does not
survive contact with the code:

- Option A moves the balance the engine reads. `NoxCurveEngine.vault` is `immutable`
  (`NoxCurveEngine.sol:164`), so the engine must be redeployed.
- Option B moves the balance the **ledger seeds against**. Today `NoxCurveEngine._copyProviderSnapshot`
  reads `vault.confidentialAvailableOf(msg.sender)` and passes it to `ledger.seedProvider`
  (`NoxCurveEngine.sol:938-943`). For reservations to operate "entirely inside that ledger" the seed
  must be the ledger's own custody balance, which is a change to `ReservationLedger` — and
  `ReservationLedger.bindEngine` is one-shot, as are `QuoteEpochController.bindEngine` and
  `CurveGraphRegistry.bindEngine`, so a new ledger forces a new engine, controller and graph anyway.

Either way the redeployment set is the same: the four engine-bound curve contracts, `CurveResultVerifier`
(which holds `engine` immutable), and the settlement contracts that hold them transitively.
`CurveUniverseRegistry`, `EncryptedMandateBook`, `ConfidentialRequestBook`, `KyrveWrappedAsset` and
`KyrveEmergencyController` carry no engine or vault reference and are **reused**, which keeps the
registered universes and every live mandate in place. Full list and cost in §7.

**Neither avoids a public unwrap at settlement.** Confidential capital cannot pay Midnight. Midnight
pulls a public ERC-20, so locked confidential capital must cross back through
`KyrveWrappedAsset.unwrap`, which calls `allowPublicDecryption` on the burn amount and is
**irreversible**. That is true in both options and it is not a leak: the amount unwrapped is exactly
the **published aggregate**, which `publishAggregate` already made public. PRD §19.2 states this
directly — *"sum encrypted provider reservations = publicly unwrapped quote funding"*. What stays
private is which providers contributed and in what proportions, which the unwrap does not touch.

---

## 4. The evaluation

Eleven criteria, each scored on what the code does rather than on which design reads better.

### 4.1 Provider custody

**A.** Capital never moves. It stays in the provider's own vault balance and a reviewed contract
moves it `available → locked` within that contract. `withdraw` remains non-pausable and remains
bounded by `available`, so a provider can always take back everything not locked against a live
epoch. The custodian is the vault the provider already chose.

**B.** Capital leaves the provider's balance and enters a Kyrve contract. Recovery is no longer "the
vault owes me my balance" but "the ledger owes me my custody position, and the vault owes me the
rest". Two owed amounts, two recovery paths, two ways to be short.

**A wins.** Not by preference: B introduces a custodian that does not exist today.

### 4.2 Permanent ACL risk

**A.** No new permanent grant to anyone. The lock computes `safeSub → select → select`, isolates its
two outputs, and grants each to the provider only — byte-for-byte the discipline
`KyrveConfidentialAssetVault.openReservation` and `ReservationLedger.reserve` already implement. The
count of permanent grants per provider per epoch is unchanged.

**B.** Moving an ERC-7984 balance into the ledger requires either a provider-signed transfer per
epoch, or an operator grant. Verified against `KyrveWrappedAsset` and the pinned `ERC7984Base`:
**ERC-7984 has no per-amount allowance** — there is no `allowance` and no `confidentialAllowance`
anywhere in the interface — so an operator can move the holder's **entire** confidential balance, and
on a wrapper can unwrap all of it to any address, for the whole window.
`.claude/rules/security.md` names this as the single largest ERC-7984 hazard, and
`KyrveWrappedAsset.MAX_OPERATOR_WINDOW` caps the window at seven days precisely because the blast
radius is total. B either asks every provider to sign a whole-balance operator grant every epoch, or
adds a per-epoch transfer transaction that has the same authority in a narrower window.

**A wins decisively.** This is the criterion that ends the argument.

### 4.3 Deterministic handle aliasing

**A.** One new isolation site. The vault must isolate the locked amount and the new available balance
under the epoch condition, exactly as `ReservationLedger.reserve` does, under
`isolationDomain(epochId, ROLE_*, provider)`. One custody accumulator, one coverage handle, whose
lineage runs through `Nox.transfer` at a distinct output index and is structurally incapable of
colliding with a provider's — the property `confidentialCoverage()`'s docstring already records.

**B.** Two custody accumulators — the vault's coverage and the ledger's coverage — and a solvency
statement that spans both. That is a second place where an aggregate can be computed identically to a
provider quantity, which is the exact mechanism of delta [Q-5](../phase2/PRD-DELTA.md): the vault
draft that handed its first depositor a permanent admin grant on the protocol aggregate, caught by a
test rather than a review. Adding a second aggregate to defend is the opposite direction of travel.

**A wins.**

### 4.4 Replay protection

**A.** Three layers already exist and compose: `KyrveConfidentialBase._consumeHandle` makes an
allocation handle fundable exactly once per contract; a `lockId` derived from
`(epochId, provider)` cannot be opened twice; and the epoch's stage machine admits the allocate stage
once. Nox supplies none of this — `validateInputProof` has no nonce and no consumption marker, delta
[Q-2](../phase2/PRD-DELTA.md) — so it is Kyrve's to supply, and it already is.

**B.** The same three, plus a fourth question with no clean answer: is a custody deposit bound to an
epoch, or does it float? If it floats, a deposit can back two epochs. If it is bound, providers must
deposit per epoch and B's cost in §4.2 recurs every epoch.

**A wins.**

### 4.5 Cancellation and recovery

**A.** `releaseLock` mirrors `releaseReservation`: restores `locked → available` in full, with no
pause flag, and none can be added because `KyrveEmergencyController`'s enum has no member for it and
must never gain one (delta [Q-6](../phase2/PRD-DELTA.md), PRD invariant 20). `NoxCurveEngine.cancelEpoch`
is already permissionless after the deadline and already walks every reserved provider.

**B.** Release restores the ledger's internal position, and the provider then needs a second,
separate withdrawal from the ledger back to the vault or the wallet. Two transactions, and a stalled
or paused second leg is capital held hostage — the failure PRD invariant 12 exists to forbid.

**A wins.**

### 4.6 Atomic settlement funding

Equal, and both are constrained the same way (§3). In both, the funding path is: lock the aggregate
confidentially, unwrap exactly the published aggregate into the series vault's public balance, settle.
A adds no hop; B adds one (ledger → vault) and therefore one more place the chain can break between
lock and payment.

**A wins narrowly**, on hop count rather than on principle.

### 4.7 Solvency proof

**A.** One contract, one inequality, and it is the inequality the vault already documents:

```
sum(available) + sum(locked)  <=  asset.confidentialBalanceOf(vault)
```

`confidentialCoverage()` already exposes the right-hand side, and its docstring already says it was
written so Phase 5's verifier could check this on chain rather than by argument.

**B.** The statement becomes a conjunction across two contracts whose states are observed at
different blocks, over two coverage handles, with the transfer path between them inside the bound.
Strictly harder to state, strictly harder to test, and the failure mode is a solvency proof that
passes while capital is missing from the leg nobody sampled.

**A wins decisively.** Invariant 13 is a Phase 5 deliverable; choosing the option that makes it two
proofs instead of one would be choosing to weaken a deliverable.

### 4.8 Upgrade risk

**A.** The Phase 2 vault is superseded. Its Sepolia record is kept as a historical artefact with a
`$superseded` note, exactly as Phase 4 kept `curve-superseded-phase3.json`, because it describes a
contract still on chain. Providers migrate (§6). The migration is visible, one-way, and finite.

**B.** The Phase 2 vault survives, which reads as lower risk and is not: it survives as a *second*
live custody surface that every future path — Cross, Roll, Capsule, redemption — must reconcile
against. Phase 6 pays that cost again, and again.

**A wins**, and this is where the honest reading inverts the intuition. B defers a redeployment and
buys permanent structural debt.

### 4.9 Gas

Measured against `@kyrve/curve`'s `CURVE_STAGE_GAS`, asserted against `evidence/phase3/stage-gas.json`.

**A.** The lock is one external call per provider per epoch, inside stage G (`allocateChunk`), whose
measured peak is **8,439,036** against the 16,777,216 Osaka cap — 8,338,180 to spare. The added work
is `safeSub` + two `select` + one `isolate`, which is the same shape stage G already pays inside the
ledger. Stage B (`cacheProviderChunk`, 14,984,397, the tightest at **10.7%** margin) is untouched:
prerequisite P5-3 forbids adding work there and nothing here does.

**B.** The custody transfer is a `Nox.transfer` per provider, landing in stage A (`sealProvider`,
1,446,304 — abundant room) or in a separate provider transaction. Also fits.

**Neither is constrained.** Both re-measure rather than re-reason, and the widest stage is re-measured
in the Phase 5 gate either way. Tie.

### 4.10 Nox API reality

**A.** Needs `safeSub`, `select`, `add`, `sub`, `eq`, `toEuint256` and the ACL functions. Every one
exists in `sdk/Nox.sol@0.2.4`. No boolean composition, no `min`/`max`, no fused `mulDiv`, no batch
entry point — none of the things that do not exist.

**B.** Needs the same, plus `Nox.transfer` through `ERC7984Base`, which exists, plus the operator
semantics in §4.2, which exist and are the problem.

**Tie on availability. A wins on what it does not need.**

### 4.11 Sepolia feasibility

Equal, per §3 — the redeployment set is identical. A is one new contract (`KyrveCustodyVault`); B is
one new contract (a custody ledger) plus a modified `ReservationLedger`. Costed in §7.

**Tie, marginally A.**

### Scorecard

| criterion | A | B | decided by |
|---|---|---|---|
| provider custody | **win** | | B invents a custodian |
| permanent ACL risk | **win** | | whole-balance operator grant |
| deterministic handle aliasing | **win** | | second aggregate to defend (Q-5) |
| replay protection | **win** | | epoch binding of a custody deposit |
| cancellation and recovery | **win** | | one non-pausable path vs two |
| atomic settlement funding | win | | hop count |
| solvency proof | **win** | | one inequality vs two |
| upgrade risk | **win** | | B defers a redeploy, keeps the debt |
| gas | tie | tie | neither constrained |
| Nox API reality | tie | tie | both available |
| Sepolia feasibility | tie | tie | same redeployment set |

**Option A, on eight criteria, none of which is implementation convenience.** The one criterion where
B looked ahead — not redeploying — turned out to be false (§3), and the one where it genuinely is
ahead (fewer new contracts) is worth less than a second custody surface costs.

---

## 5. Threat model for the chosen design

Every entry is a thing an adversary does, what stops it, and what breaks if the defence is removed.
`security-adversary` findings that survive review land in `docs/phase5/SECURITY.md`; these are the
threats the *architecture* must answer, decided now rather than discovered later.

| # | threat | defence | if removed |
|---|---|---|---|
| T-A | the reserver locks a provider's capital against an epoch the provider never joined | `lockAllocation` is `onlyReserver`, and the reserver is bound once to Kyrve's allocation path, which can only reach a provider whose own wallet called `sealProviderSnapshot` — `snapshot.provider = msg.sender`, no keeper substitution | any provider's balance becomes lockable by the keeper |
| T-B | the reserver is set to an attacker's contract | bind-once by the deployer, matching `ReservationLedger.bindEngine`, and reverting `ReserverAlreadyBound` thereafter. No setter, no upgrade, no proxy | the vault becomes an arbitrary-spend surface over every balance |
| T-C | a provider's short balance is discovered by watching the lock revert | there is no revert. `safeSub → select → select` locks encrypted zero and writes the same slots and the same event either way. A confidential shortfall is never a public reason | the vault becomes a public oracle for private balances — the exact failure the product exists to prevent |
| T-D | one allocation handle funds two locks | `_consumeHandle` on the allocation handle, plus a one-shot `lockId` per `(epochId, provider)` | double-locking, or double-minting downstream |
| T-E | a lock is replayed from a stale epoch, a cancelled epoch or a different graph root | the lock carries the epoch id, and the allocation path requires `Stage.Allocate` with a proven winner and a graph the epoch sealed | capital locked against a computation that never completed |
| T-F | the locked handle collides with another provider's | isolation under `isolationDomain(epochId, ROLE_*, provider)` before any grant, via `KyrveCurveBase._isolate`. Note [R-6](../phase3/PRD-DELTA.md): the obvious test for this **passes with the defence removed**, so the negative fixture is `IsolationProbe`, not a value comparison | one provider gets a permanent decrypt grant on another's balance, and there is no `removeAdmin` |
| T-G | locked capital is unwrapped for more than the published aggregate | the unwrap amount is the published aggregate read from the sealed graph, and the series vault asserts `buyerAssets <= aggregate` as `QuoteActivator` already does | the maker pays out more than providers committed; PRD invariant 19.2 breaks |
| T-H | a pause traps locked capital | release has no flag in `KyrveEmergencyController` and the enum has no member for it. **The enum must never gain a recovery member** — Q-6, PRD invariant 20 | capital held hostage by an emergency state |
| T-I | the vault's coverage is drained while claims stand | `sum(available) + sum(locked) <= confidentialBalanceOf(vault)` proven by `AggregateSolvencyVerifier` against `confidentialCoverage()` | insolvency invisible until a withdrawal silently pays encrypted zero |
| T-J | a locked handle is handed to a contract that publishes it | transient recipients are an immutable single-address allowlist per contract via `_assertReviewedTransientRecipient`. Transient access carries **full** persistent-grant power | any recipient can `allowPublicDecryption` a provider's balance, permanently |

Two threats are explicitly **not** answered by this decision and are carried:

- **T-K — the gateway sees plaintext on the way in.** `encryptInput` sends the value to the handle
  gateway, which encrypts inside a TEE. Kyrve claims only that no *Kyrve* component receives a
  decrypted value (delta [Q-10](../phase2/PRD-DELTA.md)). Nothing here changes that and nothing may
  claim otherwise.
- **T-L — gas is not indistinguishable.** Prerequisite carry-over 6: Phase 4 measured that the
  settlement path has no confidential branch. Confidential ownership minting **does** touch encrypted
  state, so any statement about it is a new experiment. No indistinguishability is claimed here.

---

## 6. Migration impact

Stated in full, because a migration discovered by a provider is a migration that failed.

**What is superseded.** `KyrveConfidentialAssetVault` at
`0x07e7247726270f7d409580fe2a872ea333257e45`, and the four engine-bound curve contracts plus
`CurveResultVerifier` and the settlement set that hold them transitively. Records are kept, not
deleted, each with a `$superseded` note — they describe contracts that are still on chain and the
repository must not stop describing what is on chain.

**What is reused, and why that matters.** `CurveUniverseRegistry` (registered universes and rate
grids survive), `EncryptedMandateBook`, `ConfidentialRequestBook`, `KyrveWrappedAsset` (wrapper
balances survive — providers do **not** re-wrap) and `KyrveEmergencyController`.

**What a provider must do.**

1. `withdraw` from the Phase 2 vault into their own wrapper balance. Never pausable, always
   available, and the Phase 2 vault holds no lock so nothing can be stuck.
2. Grant a short operator window on the wrapper and `deposit` into `KyrveCustodyVault`, then set
   `until = 0`. Same three-step pattern as today, same seven-day cap, same warning at the point of
   action.
3. Grant the **new** engine ACL on their mandate handles — 36 `INoxCompute.allow` calls, the same
   count as the first time, because grants are per-handle-per-grantee and the old engine's grants do
   not transfer.

**What that grant costs, stated rather than glossed.** Those 36 grants are **permanent**: there is no
`removeAdmin`. The provider's mandate handles will be admin-accessible to both the old engine and the
new one, forever. The old engine can compute on them and cannot publish them, which is a property of
reviewed code and not of the ACL — and the interface must say exactly that, in those words, as
`HANDLE-LINEAGE.md` §5 already requires. A provider unwilling to grant a second engine keeps their
capital and stops participating; nothing is seized.

**What is NOT migrated.** The Phase 4 Sepolia settlement — quote, offer, `take`, and the vault's
300,000,599 units of Midnight credit — is a settled public position and is untouched. Phase 5's
Sepolia series allocation is tied to that same settled position rather than re-running an epoch, so
the demonstration is against real credit rather than a fresh fixture.

**Rollback.** There is none, and pretending otherwise would be worse than saying so. Deposits into
the new vault are withdrawable at any time, which is the only rollback that matters; the deployment
itself is one-way because every binding is one-shot by design.

---

## 7. The redeployment set and what it costs

| layer | contract | action | reason |
|---|---|---|---|
| confidential | `KyrveCustodyVault` | **new** | the handle-native lock. §1 half two: no configuration reaches it |
| confidential | `KyrveWrappedAsset`, `EncryptedMandateBook`, `ConfidentialRequestBook`, `KyrveEmergencyController` | reuse | no engine or vault reference |
| curve | `QuoteEpochController`, `CurveGraphRegistry`, `ReservationLedger`, `NoxCurveEngine` | redeploy | `bindEngine` is one-shot on three of them; the engine holds `vault` immutable |
| curve | `CurveResultVerifier` | redeploy | holds `engine` immutable |
| curve | `CurveUniverseRegistry` | reuse | no engine reference; keeps registered universes |
| settlement | `KyrveQuoteRegistry`, `KyrveSettlementRatifier`, `KyrveQuoteExpiryController`, `KyrvePublicResultVerifier`, `QuoteActivator`, `KyrveSeriesFactory` | redeploy | hold the curve addresses transitively |
| settlement | the deployed `KyrveSeriesVault` instances | reuse | per-series, created by the factory; the Phase 4 vault keeps its credit |
| phase 5 | `KyrveSeriesToken`, `SeriesAllocator`, `SeriesOwnershipRegistry`, `AggregateSolvencyVerifier` | **new** | this phase |

**Cost, from measurement rather than estimate.** Phase 4's curve redeploy was 11,580,178 gas for
0.01209 ETH and the settlement deploy 7,343,172 gas for 0.00787 ETH — an effective ~1.07 gwei. The
Phase 5 set is comparable plus four new contracts, so **~0.025–0.035 ETH**. The deployer holds
**0.048735 ETH** (measured, same block as the `reserver()` call above).

**The consequence, stated before it bites.** A fresh Sepolia curve epoch cost **0.029918 ETH**
(`evidence/phase3/sepolia-epoch-cost.json`, 27% above the local prediction). Deployment plus a fresh
epoch does not fit in the remaining balance. Phase 5's Sepolia demonstration therefore allocates
against the **already-settled Phase 4 position**, which is both cheaper and a stronger claim — real
credit, created by a real `take`, rather than a fixture. If the balance proves insufficient for even
that, the gate reports SKIP with the exact command and the exact shortfall. It does not report PASS
for something it did not run, and it does not substitute a local result for a public one.

---

## 8. What this decision commits Phase 5 to

1. A reservation moves real capital inside one custody contract, or it is not called a lock.
2. Confidential series ownership is minted against the **published aggregate**, never against leaf
   capacity and never against Midnight units. Delta [T-1](PRD-DELTA.md) records why the PRD's §19.3
   wording cannot be taken literally.
3. Both residues are named, distinct and tested. Delta [T-2](PRD-DELTA.md).
4. Solvency is one on-chain inequality over one coverage handle.
5. Nothing in §5's threat table is answered by a comment.
