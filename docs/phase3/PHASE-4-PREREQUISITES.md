# Phase 4 prerequisites

Phase 4 is quote activation, Midnight settlement, series ownership, Cross, Roll and the Cloudflare
application. None of it starts before this file is read.

Most of what follows is ordinary carry-over. **Three entries are not.** P4-1, P4-2 and P4-3 are
constraints Phase 3 discovered by being caught out by them, and quote activation is precisely where
each recurs — at a point where the consequence is a settled trade rather than a failed test.

---

## P4-1 · The graph binding is now real, and `QuoteActivator` must use the real one

**This is the one that matters most.**

Phase 1 shipped `expectedAggregateHandle`, documented as "the handle this request's published
aggregate MUST be". It computes `keccak256(abi.encode(root, stage, outputIndex))`, and NoxCompute
derives a handle from the operator, the operand handles in order, its own address, a uniqueness seed
and the output index, packed with a version, chain id, TEE type and attribute byte. **The two share
no inputs.** It could never equal a real handle, so a check against it would have failed for every
honest quote — or, far more likely, would have been relaxed until it passed and stopped checking
anything. Nothing caught it because Phase 1 had no live gateway. Delta [R-4](PRD-DELTA.md).

`validateDecryptionProof` is still a pure EIP-712 signature check: no ACL, no nonce, no expiry, no
caller binding. A valid proof is replayable by anyone forever, and "a valid proof exists" is not
authorisation.

**Required before `QuoteActivator` accepts any proof:**

1. Bind through `CurveGraphRegistry.requireBoundResult` — registered for the role AND the graph
   sealed. The mid-epoch form, `requireRegisteredResult`, is deliberately weaker and is for the
   engine only; an outside consumer of a finished quote must require the seal, or a partially
   computed epoch verifies.
2. Predict handles with `deriveHandle` / `deriveIsolatedHandle` from `@kyrve/nox`, which are verified
   against handles a live NoxCompute returned — not with any formula that has never met a gateway.
3. Decode the plaintext with `DecryptedValue.toUint`, never `abi.decode`. The gateway returns the
   value at its **natural width**, so a published `euint16` is two bytes and `abi.decode` reverts
   with no reason string. Delta [R-5](PRD-DELTA.md).
4. **Re-read the published handle set after the last stage that writes it.** `QuoteActivator` reads
   exactly such a set, and it is populated across two transactions — `publishWinner` sets four
   handles and `publishAggregate` sets the fifth. A stale read leaves the fifth as the undefined
   handle, whose embedded chain id is 0, and the gateway then answers `unknown_chain: chain_id 0 not
   configured` — a message that names neither the handle nor the mistake, on a path where the other
   four decrypt perfectly. Delta [R-14](PRD-DELTA.md).

## P4-2 · A reservation is not a lock, and Phase 4 is where that has to change

`ReservationLedger` reserves against a **snapshot** of the provider's vault balance. It does not
custody capital and cannot stop a provider withdrawing from the vault after the snapshot was taken.

That was the right scope for Phase 3, which proves the arithmetic, the conservation and the release.
It is **not** sufficient for settlement, where a reservation becomes a payment obligation.

The reason it is not already a lock: `KyrveConfidentialAssetVault.openReservation` takes
`(externalEuint256, bytes inputProof)` — a gateway proof for an amount the reserver knows in
plaintext. A curve allocation exists only as a handle, so no such proof can be minted. Delta
[R-1](PRD-DELTA.md).

**Required:** decide, deliberately and in its own commit, between

- a vault revision with a handle-native entry point, redeployed and re-verified, with the Phase 2
  record kept as the historical artefact it is; or
- settlement that funds from the ledger's own custody, which means providers hold capital in two
  places and both must be reconciled.

Either way, the invariant from Q-6 still binds: `sum(available) + sum(locked) <=
asset.confidentialBalanceOf(vault)`, and anything that credits the vault must preserve it.

## P4-3 · The local node is more permissive than production, in two ways that already bit

Both cost a real failure in Phase 3, and both are silent by construction.

**Contract size.** The Nox Hardhat plugin sets `allowUnlimitedContractSize: true`, so a 25,040-byte
`NoxCurveEngine` passed every demonstration, the whole attack suite and the full 16 × 128 benchmark
before Sepolia refused it with `CreateContractSizeLimit`. Setting the flag to `false` was tried and
reverted: the node then cannot deploy NoxCompute itself. **The local node cannot be made to enforce
EIP-170 without breaking the stack the contracts are tested against**, so `verify:contract-size` and
`verify:curve` carry the check instead. `NoxCurveEngine` has **943 bytes of headroom** — Phase 4 adds
to the settlement path, not to it. Delta [R-10](PRD-DELTA.md).

**Block time.** A Hardhat node advances `block.timestamp` per mined block, and once the chain clock is
more than 3,600 seconds ahead of wall clock every gateway proof looks expired.
`allowBlocksWithSameTimestamp: true` keeps them aligned. Any new long-running suite inherits this.
Delta [R-12](PRD-DELTA.md).

**And a third, in the toolchain rather than the chain.** `scripts/` is in no project reference, so
`tsc --build` never typechecked the deployment, verification and gate tree — `tsx` strips types
without checking them, so a broken script runs anyway. `pnpm typecheck:scripts` now covers it and is
in the gate. Every new `verify:*` or deploy script must be typechecked and gate-wired in the commit
that adds it. Delta [R-13](PRD-DELTA.md).

---

## Carried from Phase 2, still binding

1. **Every encrypted aggregate must be proven non-colliding** (P3-1, Q-5). Phase 3 discharged it with
   `KyrveCurveBase._isolate` and `docs/phase3/HANDLE-LINEAGE.md`. Every handle Phase 4 grants or
   publishes must go through the same primitive, under a domain that names its role and subject.
   And note R-6: **the obvious test for this passes with the defence removed.** Use `IsolationProbe`,
   which makes the hazard reachable.
2. **Confidential failure stays branch-free** (P3-2, Q-6) — with the correction in
   [R-8](PRD-DELTA.md): the guarantee holds over AMOUNTS, for an INITIALISED balance. An account whose
   ERC-7984 balance was never initialised is a public `ERC7984ZeroBalance` revert.
3. **Replay protection is the application's job** (Q-2). `KyrveConfidentialBase` supplies one-shot
   handle consumption and a per-owner nonce; every new entry point must use both.
4. **Transient handles reach reviewed Kyrve contracts only.** Transient access carries full
   persistent-grant power. The engine's allowlist is one immutable address; the ledger's is one.
5. **No UI or API may claim a Nox grant was revoked, or that confidential failure is
   gas-indistinguishable.**
6. **`@kyrve/nox` is the only module that may touch iExec.** `scripts/verify/import-boundary.ts`
   enforces it.

## New in Phase 3

7. **A provider must grant the engine ACL on their own handles**, one `INoxCompute.allow` per handle
   from their own wallet — 35 for a mandate, 19 for a request, 1 for a vault balance. There is no
   batch entry point and no delegation path. The grant is permanent and makes the engine an admin.
   Phase 4's interface work must say this before the first signature, in those words. Delta
   [R-2](PRD-DELTA.md).

8. **The measured operation budget replaces the Day 0 one.** Every stage costs more, stage B's unit
   is (provider, market) rather than provider, and the launch epoch is 22 transactions and ~297M gas
   rather than 18 and ~197M. Size any keeper, workflow or timeout against `@kyrve/curve`'s
   `CURVE_STAGE_GAS`, which is measured and asserted against `evidence/phase3/stage-gas.json`. Delta
   [R-3](PRD-DELTA.md).

9. **The off-chain runner falls minutes behind at launch scale.** Fifteen thousand Nox operations is
   not a five-second wait. A Workflow step timeout must scale with operation count, not be a
   constant. Delta [R-7](PRD-DELTA.md).

10. **The gateway's authorisation view lags the chain.** `@kyrve/nox` treats the chain as
    authoritative and retries only a refusal the chain contradicts. Any new decryption path must use
    the client rather than the SDK directly, or it will report indexer lag as a permission failure.
    Delta [R-9](PRD-DELTA.md).

11. **A verification command that has never run is worse than a missing one.** `verify:source-lock`
    sat in `package.json` since Day 0 pointing at a file nobody had written. Every new
    `verify:*` script must be wired into a gate in the same commit that adds it. Delta
    [R-11](PRD-DELTA.md).

---

## What Phase 4 must build, in dependency order

| Order | Component | Blocked on |
|---|---|---|
| 1 | `QuoteActivator` | **P4-1** — the real graph binding and the real handle derivation |
| 2 | Vault revision or ledger custody | **P4-2** — a deliberate decision, its own commit |
| 3 | `KyrveSeriesVault` / `KyrveSeriesFactory` | exact-fill harness (Phase 1); ratifier authorisation (D-7) |
| 4 | `AggregateSolvencyVerifier` | P3-1 and P3-2, and `confidentialCoverage()` |
| 5 | Cross and Roll | everything above |
| 6 | Cloudflare application | everything above; deferred by owner decision |

## What is deliberately absent from Phase 3, so nobody looks for it

- No quote activation, no Midnight settlement, no series, no Cross, no Roll.
- No bond forfeiture. `QuoteEpochController` now exists and records `sealedInto`, so the flag
  `cancelUnsealedRequest` must consult is finally available — but the deployed Phase 2 request book
  cannot consult a contract that did not exist when it was written, so a borrower can still cancel a
  sealed request's bond. Phase 4 must close that with the request book revision or by making the
  epoch's outcome independent of it.
- No Cloudflare resource of any kind. Nothing was created.
- **No 16 × 128 epoch on Sepolia.** A four-cell epoch ran and verified there (`0xcf3e5c94…`), but
  the full universe is 2,048 cells and roughly 120 times the transactions, and has only run locally.
