# Phase 3 prerequisites

Phase 3 is the curve engine, quote activation, series, Cross, Roll and the Cloudflare application.
None of it starts before this file is read.

Most of what follows is ordinary carry-over. **Two entries are not.** P3-1 and P3-2 are constraints
Phase 2 discovered by being caught out by them, and the curve engine is precisely where each
recurs — at a scale where the same mistake would be much harder to see.

---

## P3-1 · Every encrypted aggregate must be proven non-colliding

**This is the one that matters most.**

A Nox handle is a pure function of the operator, the operand handles in order, the output index, and
a seed derived from those same operands (`modules/Compute.sol::_executeOperation`). Nothing else
enters it. Two logically distinct encrypted quantities computed the same way from the same inputs
are therefore **one handle with one permanent ACL entry** — and `allow` has no inverse.

Phase 2 hit this. An earlier vault draft kept an encrypted running total alongside each provider's
balance; on the first deposit into an empty vault both were `add(zeroHandle, received)`, so granting
a provider their own balance also granted them the protocol aggregate, permanently. It was caught by
a test asserting nobody could read the aggregate, not by review.

The curve engine accumulates capacity and provider counts across 16 providers and 128 leaves. It is
full of quantities that will coincide in value — every empty leaf, every disabled market, every
zeroed accumulator before the first contribution.

**Required before any accumulator is written:**

1. Enumerate every distinct stored encrypted quantity and its operation lineage.
2. For each pair that could coincide in value, show the lineages cannot coincide — different
   operator, different operand order, or a distinguishing operand. Value inequality is not enough.
3. Assert it executably. `confidential/contracts/test/HandleDeterminismProbe.sol` keeps the
   underlying property falsifiable; extend it rather than reasoning afresh.
4. Never grant a user a handle that any aggregate could equal.

Recorded as delta [Q-5](PRD-DELTA.md).

## P3-2 · Confidential failure must stay branch-free, and the ordering must stay safe

Every balance change in Phase 2 is `safeSub → select → select`, so a short balance contributes
encrypted zero, leaves state unchanged, emits the same event and succeeds publicly. A `safe` op
returns encrypted `false` **and an encrypted zero result** while the transaction succeeds; unsafe
`div` saturates to the type maximum rather than reverting. Neither can be branched on in Solidity.

The vault also debits before it pays, which is only safe because of an invariant the PRD never
stated:

```text
sum(available) + sum(locked)  <=  asset.confidentialBalanceOf(vault)
```

**Required:** any Phase 3 path that credits the vault must preserve that, and any that debits before
an encrypted transfer must justify the ordering the same way. `confidentialCoverage()` exposes the
right-hand side so `AggregateSolvencyVerifier` can check it on chain rather than by argument. The
suite asserts payment rather than debit — it decrypts the wallet balance before and after — and any
new recovery path should do the same.

Recorded as delta [Q-6](PRD-DELTA.md).

---

## Carried from Phase 1, still binding

1. **`OPERATION-BUDGET.md` as corrected by P-1** — 311 cells per transaction, 256 recommended, the
   epoch is the atomic unit, stage and chunk ids deterministic because Workflow step names are
   memoisation keys.
2. **Every Nox touchpoint goes through `@kyrve/nox`.** `scripts/verify/import-boundary.ts` enforces
   it. Phase 2 widened the allowlist to `confidential/contracts/` (Solidity importing the MIT
   Solidity SDK) and `confidential/test/` plus `confidential/hardhat.config.ts` (the plugin that
   boots the Docker stack, which ships nowhere). `confidential/scripts/` is deliberately **not**
   listed — it is product code.
3. **`QuoteActivator` must verify the decrypted handle is the one this request's sealed operation
   graph derives.** `@kyrve/nox` already refuses to return a value without it. A valid decryption
   proof establishes only that the gateway decrypted *some* handle to *some* value; it is replayable
   by anyone forever.
4. **Transient handles reach reviewed Kyrve contracts only.** Transient access carries full
   persistent-grant power — the recipient can publish the handle permanently inside that one
   transaction. `_assertReviewedTransientRecipient` is the only gate, and each contract's allowlist
   is immutable at deployment.
5. **No UI or API may claim a Nox grant was revoked, or that confidential failure is
   gas-indistinguishable.**

## New in Phase 2

6. **Replay protection is the application's job.** `validateInputProof` has no nonce and no
   consumption marker, so a proof stays valid for its own owner against its own app until it
   expires. `KyrveConfidentialBase` supplies one-shot handle consumption and a per-owner nonce;
   every new entry point must use both. Delta [Q-2](PRD-DELTA.md).

7. **Handle readiness must go through `waitForHandle`.** The gateway's status endpoint is absent
   from both the SDK and the documentation, and the shape it returns was measured rather than
   documented (delta [Q-3](PRD-DELTA.md)). The SDK's own retry gives up after roughly 7 seconds,
   which is not a policy a keeper can adopt when testnet latency is unmeasured.

8. **The confidential layer is a separate compilation unit and must stay one.** `nox-protocol-
   contracts` requires `^0.8.35`; the Midnight substrate is pinned at 0.8.34 for bytecode
   comparability. Curve-engine contracts import `sdk/Nox.sol` and therefore belong in
   `confidential/`, not in `contracts/`. Delta [Q-1](PRD-DELTA.md).

9. **`IERC7984Receiver`'s documented ACL contract is not honoured by the shipped
   `ERC7984Utils`** — a receiver invoked through `confidentialTransferAndCall` has no ACL on the
   amount it was handed. Any Phase 3 design that assumes otherwise will fail at runtime, not at
   compile time. Delta [Q-7](PRD-DELTA.md).

10. **Fixed-shape encrypted submissions are a privacy control.** A variable-length submission leaks
    how many markets a provider will lend into. Proven: 1-market and 8-market mandates produce
    identical calldata length and overlapping gas. Delta [Q-8](PRD-DELTA.md).

11. **The reserver is unset on every deployed vault**, and `verify:confidential` asserts it stays
    unset. Phase 3 wires the curve engine and quote activator into it. Until then every reservation
    entry point reverts `ReserverNotConfigured`, which is the correct public behaviour for a
    capability nothing can yet perform. Setting it is a deliberate act that changes the vault's
    trust model and belongs in its own commit with its own tests.

12. **`§6.9` should be restated as "no Kyrve component receives a decrypted value."** The Nox
    gateway does receive plaintext — that is how `encryptInput` works, and the gateway is the
    confidentiality provider. Disclose it as a trust assumption rather than implying it does not
    happen. Delta [Q-10](PRD-DELTA.md).

---

## What Phase 3 must build, in dependency order

| Order | Component | Blocked on |
|---|---|---|
| 1 | `CurveUniverseRegistry` | rate grids exist (Phase 1); the fee-floor rule from D-8 |
| 2 | `QuoteEpochController` | the request book (Phase 2); adds the seal flag `cancelUnsealedRequest` must consult |
| 3 | `NoxCurveEngine` | **P3-1**, the operation budget, and mandate epoch binding |
| 4 | `QuoteActivator` | the operation-graph binding (A-11), already in `@kyrve/nox` |
| 5 | `KyrveSeriesVault` / `KyrveSeriesFactory` | exact-fill harness (Phase 1); ratifier authorisation (D-7) |
| 6 | `AggregateSolvencyVerifier` | **P3-1** and **P3-2** |
| 7 | Cloudflare application | everything above; deferred by owner decision until the product works end to end |

## What is deliberately absent from Phase 2, so nobody looks for it

- No curve engine, no quote activation, no series, no Cross, no Roll.
- No epoch controller, so `cancelUnsealedRequest` cannot yet consult a seal flag — the function is
  named for the constraint so it is not lost.
- No bond forfeiture. Deciding when a bond is forfeit needs to know whether a quote was produced and
  ignored, which is `QuoteEpochController`. Until then the request book holds the bond, refunds it in
  full on cancellation or expiry, and has **no path that pays it anywhere else**. There is no
  operator discretion over a bond because there is no operator.
- No Cloudflare resource of any kind. Nothing was created, and no temporary production resource
  exists.
