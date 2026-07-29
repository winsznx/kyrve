# Phase 5 prerequisites

Phase 5 is confidential series ownership, aggregate solvency, Cross, Roll, Capsule and the Cloudflare
application. None of it starts before this file is read.

Phase 4 settled one real quote through unmodified Midnight on a public network. What it did **not**
do is make the money confidential: the series vault funds from a public ERC-20 balance and mints no
ERC-7984 ownership at all. That gap is P5-1, it is the reason Phase 5 exists, and it was left open on
purpose rather than half-built.

Four entries below are not carry-over. **P5-1 through P5-4** are constraints Phase 4 established by
measurement, and each recurs in Phase 5 at a point where the consequence is a mispriced confidential
claim rather than a failed test.

---

## P5-1 · A reservation is still not a capital lock

**This is the one that matters most, and it is now two phases old.**

`ReservationLedger` reserves against a **snapshot** of the provider's confidential vault balance. It
takes no custody, and cannot stop a provider withdrawing after the snapshot. Phase 4 settled anyway —
from the series vault's **public** loan-token balance, committed by an operator, tracked in
`committedFunding`. Delta [S-6](PRD-DELTA.md) says so in those words.

So today, `sum(reserved allocations)` and `the capital that actually paid` are two independent
quantities that happen to agree because one operator funded both. PRD invariant 3 — *the sum of
encrypted allocations equals the Midnight credit received* — is **arithmetically true and
custodially unenforced.**

The blocker is unchanged from [P4-2](../phase3/PHASE-4-PREREQUISITES.md):
`KyrveConfidentialAssetVault.openReservation` takes `(externalEuint256, bytes inputProof)`, a gateway
proof for an amount the reserver knows in plaintext. A curve allocation exists only as a handle, so
no such proof can be minted. Delta [R-1](../phase3/PRD-DELTA.md).

**Required, as its own commit, before any series ownership is minted:** choose between

- a vault revision with a **handle-native** entry point — redeployed, re-verified, the Phase 2 record
  kept as the historical artefact it is; or
- settlement funded from the ledger's own custody, which means providers hold capital in two places
  and both must be reconciled on every path.

Either way Q-6 still binds: `sum(available) + sum(locked) <= asset.confidentialBalanceOf(vault)`.

## P5-2 · The series must mint the aggregate, and must account for the residue

Phase 4 established that three amounts are distinct and must never be conflated:

| | Sepolia run | What it is |
|---|---|---|
| leaf capacity | 300,000,000 | what the winning (market, rate) *could* carry |
| **published aggregate** | **299,999,999** | the exact sum of successfully reserved allocations |
| units settled | 300,000,599 | `floor(aggregate * WAD / price)` — Midnight's unit, not an amount |
| buyer assets paid | 299,999,998 | `floor(units * price / WAD)` — what the maker actually paid |

The aggregate is **not** the capacity (they differ by floor-division dust) and the assets are **not**
the aggregate (a second floor). Phase 4's residue was 1 unit and it is unreserved: no provider has a
claim on it. Delta [S-4](PRD-DELTA.md).

**Required:** confidential series ownership must be minted against the **published aggregate**, and
the residue must be an explicit, named, tested destination — not an unattributed balance that
`AggregateSolvencyVerifier` later has to explain. A confidential claim minted against capacity
over-issues by exactly the dust, silently, forever.

Nothing anywhere may reconstruct a fill from capacity. `packages/quote/src/sizing.ts` rounds down
twice and `QuoteActivator` asserts `buyerAssets <= aggregate`; new code must inherit both.

## P5-3 · `cacheProviderChunk` is 10.7% under the Osaka cap

EIP-7825 caps **one transaction** at 2^24 = 16,777,216 gas, independently of the block gas limit.
Phase 4 discovered this by watching a completed 256-cell epoch die inside `Midnight.take` with a bare
`invalid opcode`. Deltas [S-1](PRD-DELTA.md) and [S-2](PRD-DELTA.md).

The chunk width is now bounded at **192** in the contract, in the generated constants and in the
fixtures. At 192 the widest stage measures **14,984,397 gas — 1,792,819 under the cap**, and the
launch epoch is **25 transactions**.

**Required:** any new encrypted operation inside stage A consumes that headroom directly.
`pnpm verify:gas-cap` is a passing regression gate and names `cacheProviderChunk` as tight on every
run; it is not advisory. Size everything against `@kyrve/curve`'s `CURVE_STAGE_GAS`, which is
asserted against `evidence/phase3/stage-gas.json`, and re-measure rather than re-reason.

The negative fixture proving 256 cells exceeds the cap is retained deliberately. Do not delete it to
tidy up.

## P5-4 · Published handles are read after their producing stage, every time

[R-14](../phase3/PRD-DELTA.md) cost a Sepolia epoch. The published set is populated across two
transactions — `publishWinner` writes four handles, `publishAggregate` writes the fifth — so a read
taken before Stage F leaves the fifth as the undefined handle, whose embedded chain id is 0, and the
gateway answers `unknown_chain: chain_id 0 not configured` while the other four decrypt perfectly.

Phase 4 closed it on both sides and both must be preserved:

- on chain, `KyrvePublicResultVerifier.requireFreshHandles` re-reads `ENGINE.publishedOf` **at call
  time** and checks all five against `CurveGraphRegistry`, failing with `PublishedHandleMissing` and
  the role's name before any gateway request;
- off chain, `PublishedHandleSnapshot` binds the set to block number, epoch, request id and graph
  root, and `assertSettleableSnapshot` refuses a stale one.

**Required:** every new consumer of a published handle — Cross, Roll, Capsule, any Worker — goes
through those two, not around them. `Activation.t.sol` has three regression tests including the
four-valid-one-undefined case; a new path needs its own.

---

## Carried forward, still binding

1. **`isRatified` cannot enforce fill size, and never will.** It is `view` and receives no `units`.
   Exact fill is composed across the ratifier and `onBuy`, and `docs/phase4/SECURITY.md` tabulates
   what each half's removal costs. A Cross or Roll offer is a *new* offer and needs the same
   composition — it does not inherit the original's enforcement.
2. **Credit and debt are cumulative market positions, not per-quote amounts.** Measure them as
   deltas across the settlement block. Phase 4's borrower already carried 3,000,000 units of Phase 1
   debt and an absolute assertion failed on a correct settlement. Delta [S-8](PRD-DELTA.md).
3. **The activated offer exists in exactly one log and cannot be simulated.** `offer.start` is
   `block.timestamp`, so a re-simulation produces a different hash. Record the activation transaction
   hash the moment it lands — the free-tier RPC caps `eth_getLogs` at a 10-block range. Delta
   [S-9](PRD-DELTA.md).
4. **No two compiled Solidity sources may share a basename.** Foundry writes
   `out/<basename>/<Contract>.json` and silently drops one artifact on a collision, on a *successful*
   build. `pnpm verify:basenames` runs before compilation, with the two vendored `IERC20.sol` files
   triaged by exact path pair. The production ratifier is named `KyrveSettlementRatifier` for this
   reason and must keep that name; the deployed Phase 1 `KyrveQuoteRatifier` is untouched. Delta
   [S-3](PRD-DELTA.md).
5. **The two compiler pins are mutually exclusive** — `contracts/` at 0.8.34 for bytecode
   comparability with Midnight, `confidential/` at 0.8.36 for `nox-protocol-contracts`. Cross the
   boundary by declaring the interface, never importing it, and let `verify:curve-abi` compare
   selectors *and* return shapes. Q-1.
6. **No gas indistinguishability is claimed, anywhere.** Phase 4's nine-outcome measurement answers a
   narrower question on purpose: the settlement path has no confidential branch. Phase 5 does —
   confidential ownership minting is exactly where a branch on encrypted state could appear — so any
   measurement there is a new experiment, not an extension of this one.
7. **Refusal gas is unmeasurable on the local node.** EDR validates a transaction before inclusion
   and refuses a reverting one at submission, so no receipt and no gas figure exist. It is recorded
   as `null`, never as zero. A refusal-cost comparison needs a node that includes reverting
   transactions, or a public network.
8. **A verification command that has never run is worse than a missing one.** Every new `verify:*`
   or deploy script is typechecked (`pnpm typecheck:scripts`) and wired into a gate **in the commit
   that adds it**. Deltas [R-11](../phase3/PRD-DELTA.md) and [R-13](../phase3/PRD-DELTA.md).
9. **`@kyrve/nox` is the only module that may touch iExec**, and no decrypted value reaches a server,
   log, metric, database or error message. `verify:privacy` and `verify:import-boundary` enforce
   both.
10. **Nox grants and public-decryption marks are permanent.** No `removeViewer`, no `removeAdmin`, no
    way to un-set `allowPublicDecryption`. Capsules use fresh snapshot handles; auditors never receive
    access to a live portfolio handle. The UI never says "revoked".
11. **Everything granted or published goes through `KyrveCurveBase._isolate` first.** Handles are
    deterministic in their operands, so two logically distinct quantities computed identically are one
    handle with one permanent ACL entry. Note [R-6](../phase3/PRD-DELTA.md): the obvious test for this
    passes with the defence removed — use `IsolationProbe`.
12. **The pause enum has no recovery member and must never gain one.** Q-6, PRD invariant 20.

## What Phase 5 must build, in dependency order

| Order | Component | Blocked on |
|---|---|---|
| 1 | the P5-1 decision — handle-native vault, or ledger custody | nothing. It gates everything else and belongs in its own commit |
| 2 | confidential series ownership (ERC-7984) minted at settlement | P5-1, P5-2 |
| 3 | `AggregateSolvencyVerifier` — invariant 4, aggregate claims vs vault coverage | 2, and `confidentialCoverage()` |
| 4 | the residue destination, named and tested | P5-2 |
| 5 | Capsule — snapshot handles, auditor grants | 2; the permanence rules in carry-over 10 |
| 6 | Cross and Roll | everything above, plus a fresh exact-fill composition per new offer |
| 7 | Cloudflare application | everything above; deferred by owner decision |

Three separate items sit outside that chain and can proceed independently:

- **Key separation.** Keeper, operator and curator are three immutable constructor arguments that are
  currently one Sepolia address. Separating them is a deployment, not a code change, and should happen
  before anything holds value.
- **The bond a borrower can still cancel after their request was sealed.** Carried from Phase 3.
  `QuoteEpochController.sealedInto` now exists, but the deployed Phase 2 request book predates it and
  cannot consult it. Close it with the request-book revision, or make the epoch's outcome independent
  of the bond.
- **A 16 × 128 epoch on a public network.** It now *fits* the Osaka cap at 192 cells, and fitting is a
  measurement rather than an execution. Sepolia has only ever run a four-cell epoch. Public-network
  latency at 2,048 cells and 25 transactions is UNVERIFIED.

## What is deliberately absent from Phase 4, so nobody looks for it

- No confidential series ownership, no aggregate solvency verifier, no Capsule, no Cross, no Roll.
- No Cloudflare resource of any kind. Nothing was created.
- No confidential funding path. The series vault holds and pays a **public** ERC-20 balance, and the
  UI says so at the point of action.
