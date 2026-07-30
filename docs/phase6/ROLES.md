# Operational roles

Through Phase 5 the keeper, the operator, the curator and the residue beneficiary were four
immutable constructor arguments holding **one** Sepolia address:
`0x36C3d1AF18b9186A662B1e277c80Ab54bE2765C2`. `docs/phase5/PHASE-6-PREREQUISITES.md` P6-0 named it
as the one thing Phase 5 left undone, and named it a *deployment* problem rather than a code one.

This is the resolution. Seven roles, seven addresses, refused in two independent places if they
collapse:

- `scripts/lib/roles.ts` throws before any transport is built.
- `KyrveRoleRegistry`'s constructor reverts `DuplicateRoleHolder(first, second, holder)`.

Both exist because the off-chain refusal can be bypassed by deploying by hand and the on-chain one
cannot. `contracts/test/RoleSeparation.t.sol` exercises **all twenty-one pairs**, not a sample: a
registry that caught only adjacent collisions would admit `curator == auditor`, which is exactly the
collapse Capsule cares about.

---

## The seven roles

| role | may do | may **not** do | signs? | key |
|---|---|---|---|---|
| **deployer** | deploy contracts; perform the twelve one-shot bindings | anything at runtime — every `onlyDeployer` function is a bind-once that reverts forever after | yes | `DEPLOYER_PRIVATE_KEY` |
| **keeper** | advance computation: curve stages, `activate`, `consumeChunk`, `unwrapFunding`, `allocateChunk`, `closeQuote` | choose an input, alter an outcome, move a token, retire a quote, create a series | yes | `KYRVE_KEEPER_PRIVATE_KEY` |
| **operator** | `cancelQuote` on a live quote; `recoverFunding` of **uncommitted** loan tokens | reach committed funding; activate; create a series; touch a confidential handle | yes | `KYRVE_OPERATOR_PRIVATE_KEY` |
| **curator** | register universes and markets; `createSeries`; `setRedemptionFactor`; `publishAggregateSupply` | move any funds; activate; cancel; mint a claim | yes | `KYRVE_CURATOR_PRIVATE_KEY` |
| **emergency authority** | `pause`/`unpause`/`pauseAll` over the five protocol *entries* | pause any recovery path — the enum has no member for one; seize, move or read a confidential balance | on demand | `KYRVE_GUARDIAN_PRIVATE_KEY` |
| **residue beneficiary** | receive the funding residue | *nothing*. It holds no privilege anywhere in the system | never | `KYRVE_RESIDUE_PRIVATE_KEY` |
| **auditor** | decrypt Kyrve Capsule snapshots addressed to it | decrypt any live balance handle; call anything privileged | never | `KYRVE_AUDITOR_PRIVATE_KEY` |

Two rows deserve the emphasis.

**The residue beneficiary is a destination, not an authority.** `SeriesResidueAccount.distribute()`
takes no parameters and no privileges — anyone may call it, and it can only ever send the whole
balance to one `immutable` address fixed before any residue existed. A withdrawal function with a
`to` parameter would satisfy PRD §19.8 in prose and violate it in practice, because whoever held the
key would choose the destination at withdrawal time. That is a sweep to a developer wallet with
extra steps.

**The emergency authority cannot seize a confidential balance, structurally.** Every member of
`KyrveEmergencyController.Activity` is an *entry*: `WrapUnderlying`, `VaultDeposit`,
`MandateSubmission`, `RequestSubmission`, `ReservationOpening`. There is deliberately no member for
withdrawal, unwrapping, unwrap finalisation, mandate retirement, request cancellation, reservation
release, transfer, redemption or burning — so no configuration of that contract can stop a holder
taking their own assets back. The enum must never gain a recovery member: delta Q-6 and PRD
invariant 20.

---

## Where each role is actually enforced

Enforcement is an `immutable` on the contract that performs the action. The registry declares; it
does not enforce, and it could not — it makes no external call and holds no state that is not
`immutable`.

| role | enforcing getter |
|---|---|
| deployer | `SeriesOwnershipRegistry.DEPLOYER`, `KyrveSeriesToken.DEPLOYER`, `KyrveCustodyVault.DEPLOYER`, `SeriesAllocator.DEPLOYER` |
| keeper | `QuoteActivator.KEEPER`, `SeriesAllocator.KEEPER` |
| operator | `KyrveQuoteExpiryController.OPERATOR`, `KyrveSeriesVault.OPERATOR` |
| curator | `KyrveSeriesFactory.CURATOR`, `KyrveSeriesToken.CURATOR`, `CurveUniverseRegistry.curator` |
| emergency authority | `KyrveEmergencyController.guardian` |
| residue beneficiary | `SeriesResidueAccount.DECLARED_BENEFICIARY` |
| auditor | `KyrveRoleRegistry.AUDITOR`, and per-capsule `recipient` |

`pnpm verify:roles <env>` reads **every one of those getters from chain** and compares them against
each other and against the registry's declaration. It never trusts `deployments/<env>/series.json`
for an address — the manifest is used only to know which contracts to ask.

---

## Account kind

`KyrveRoleRegistry.ACCOUNT_KIND_BITMAP` records, per role, whether the holder had code **at
declaration time**. `wasContractAtDeclaration(role)` reads the snapshot; `isContractNow(role)` reads
the live answer. They are separate accessors because they can disagree, and the registry claims only
the snapshot — an address with no code today can gain code tomorrow through CREATE2 at a
pre-computed address, or behave like a contract through an EIP-7702 delegation.

On this release every role is an **EOA**, and that is a limitation rather than a design goal. The
intended end state gives the emergency authority and the curator to hardware or multisig accounts:
the curator can publish the aggregate supply snapshot, which is **irreversible** (Nox has no
`removeViewer`, no `removeAdmin` and no un-publish), and a single hot key holding an irreversible
disclosure authority is the weakest point of this role model. It is recorded here rather than
mitigated.

The keeper is the deliberate exception. It signs constantly, it cannot be a cold key, and its blast
radius is bounded on purpose: it advances computation, and it can neither choose the inputs nor
change the outcome. That bound is what makes a hot keeper key acceptable at all.

---

## Rotation

**There is no rotation function, anywhere.** Every role is an `immutable`, and `KyrveRoleRegistry`
has no setter, no owner and no upgrade path. A registry that could reassign a role would be a role
of its own — the most powerful one in the system — and it would make "the keeper cannot alter
outcomes" false by construction.

So rotation is redeployment, and the cost differs sharply by role:

| role | to rotate | cost |
|---|---|---|
| **keeper** | redeploy `QuoteActivator` and `SeriesAllocator`, rebind | `KyrveQuoteRegistry.bindActivator` is one-shot, so a new activator needs a new registry — and the ratifier, expiry controller and factory all hold the registry. In practice: the whole settlement layer. |
| **operator** | redeploy `KyrveQuoteExpiryController` and every `KyrveSeriesVault` | a vault's operator is fixed by `createSeries`, and `createSeries` is one-shot per series. A rotated operator means a **new series**. |
| **curator** | redeploy `KyrveSeriesFactory` and `KyrveSeriesToken`; register a new universe | existing universes keep the old curator: `CurveUniverseRegistry.curator` is immutable and the registry is deliberately not redeployed. |
| **emergency authority** | redeploy `KyrveEmergencyController` and everything that holds it | which is every confidential contract. The controller is deliberately never redeployed (Q-6), so in practice the guardian is fixed for the life of the layer. |
| **residue beneficiary** | redeploy `SeriesResidueAccount` | cheap, and the old account keeps whatever it already holds — `distribute()` still works and still sends to the old declared address. Nothing is stranded; the destination simply changes going forward. |
| **auditor** | redeploy `KyrveRoleRegistry`; issue future capsules to the new address | **existing capsules stay decryptable by the old auditor forever.** Nox has no `removeViewer`. |

That last row is the one to say out loud. Rotating the auditor does not revoke anything. The correct
language is "live access ended", "future snapshots disabled", "this historical snapshot remains
available" — never "access revoked" for a handle a viewer could already decrypt. Carry-over 10 from
Phase 4, P6-5 from Phase 5.

---

## Loss

| lost key | immediate effect | recovery |
|---|---|---|
| **deployer** | none at runtime. Every bind-once it was needed for has already been used | none needed. A future deployment needs a new deployer, which is expected anyway |
| **keeper** | the protocol **stalls**: no epoch advances, no quote activates, no chunk allocates | provider capital is *not* stranded. `NoxCurveEngine.cancelEpoch` is permissionless after its deadline, `KyrveQuoteExpiryController.expireQuote` is permissionless after expiry, and `SeriesAllocator.unwindChunk` is permissionless. Every one of those exists because capital that only a keeper can release is capital hostage to that keeper's uptime — PRD invariants 12 and 20 |
| **operator** | live quotes can no longer be cancelled *early*, and uncommitted funding cannot be recovered from a series vault | expiry still works and is permissionless. This is P6-1: `SeriesAllocator.unwindChunk` cannot return the loan tokens, and closing it properly needs a series vault whose retirement path returns funding without an operator. Open, and recorded as such |
| **curator** | no new series, no new universe, and **redemption cannot be opened** for a series whose factor was never set | the severe one. `setRedemptionFactor` is curator-only, and without it `redeem` reverts `RedemptionNotOpen`. Holders keep their claims and keep every recovery path, but the series cannot mature. A production deployment must not hold this key hot |
| **emergency authority** | the protocol can no longer be paused | it also cannot be *stuck* paused, because unpausing is the same key. If the layer is unpaused at the time of loss, nothing degrades |
| **residue beneficiary** | residue accumulates at an address nobody controls | `distribute()` still sends it there, permissionlessly. The tokens are testnet dust and the destination is public and immutable. No user value is affected |
| **auditor** | capsules addressed to it become undecryptable | issue new capsules to a new auditor. Nothing is lost that was not already disclosed |

---

## What this does **not** claim

- It does not claim the roles are held by different *people*. On this release one owner holds all
  seven keys on one machine. What is separated is the on-chain authority, which is what bounds the
  blast radius of a single compromised key.
- It does not claim the deployment is production-safe. Six of the seven keys are plaintext in a
  git-ignored `.env`, generated by `pnpm roles:generate`, and that is acceptable for Ethereum
  Sepolia and for nothing else.
- It does not claim rotation is cheap. The table above is deliberately explicit that rotating the
  keeper or the emergency authority means redeploying the layer.
