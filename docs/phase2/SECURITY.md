# Phase 2 security posture

What the confidential layer defends, what enforces each defence, and — the part that matters most —
what it does **not** defend.

Every claim here is backed by a named executable check. Where something is unproven it says so
rather than being omitted.

---

## The critical contract requirements, and what enforces each

| Requirement | Enforced by | Proven by |
|---|---|---|
| direct caller and proof binding | `KyrveConfidentialBase._assertDirectCaller` + `Nox.fromExternal` | `40-proof-attacks.ts` 13a, 13g |
| chain and application binding | NoxCompute `validateInputProof` | `40` 13b; chain id is embedded in the handle |
| proof expiry | NoxCompute, 3600 s | `95-proof-expiry.ts` 13c |
| one-shot proof and nonce policy | **Kyrve** — `_consumeHandle` + `_consumeNonce` | `40` 13f, `10` replay case |
| mandate version and epoch binding | `activeEpoch` + schema version in every commitment | `20-mandate-book.ts` 8+9 |
| old mandate handles cannot authorise new activity | `assertUsable` reverts `StaleMandateEpoch` | `20` 8+9 |
| encrypted safe balance updates | `safeSub → select → select`, success threaded | `10`, `50` |
| confidential failure without public reason | identical event, status, log count and calldata length | `10`, `60-gas-side-channel.ts` |
| exact ACL policy | `_grantOwnerOnly` — `allowThis` + `allow(owner)`, nothing else | `10` 4, `20` 7, `30` 12 |
| viewer permanence documented | `@kyrve/nox` `GRANT_SEMANTICS`, `endOfAccessWording` | `packages/nox/test`, terminal copy asserted in `70` |
| transient-access escalation blocked | `_assertReviewedTransientRecipient`, immutable allowlist | vault allowlists one address; both books allow none |
| bounded ERC-7984 operator expiry | `KyrveWrappedAsset.setOperator`, 7-day cap | `10` deposit case |
| public wrap and unwrap boundary documented | contract NatSpec + the terminal's reveal warning | `10` 1+2, `50` 14d |
| emergency pause cannot block user recovery | an enum with no recovery member | `50` 14c–14f |
| no server receives plaintext | there is no Kyrve server on this path | `70-browser-flow.ts`, `verify:privacy-scan` |

---

## The exact ACL policy

Kyrve grants **two things** for a value owned by one account, and nothing else:

```solidity
Nox.allowThis(handle);          // this contract may compute on it in a later transaction
Nox.allow(handle, owner);       // the owner, and only the owner, may decrypt it
```

It never calls `addViewer` on a live handle. It never calls `allowPublicDecryption` on a private
value. Both are **permanent**: `sdk/Nox.sol` (0.2.4) has no `removeViewer`, no `removeAdmin` and no
way to un-set public decryption. Only `disallowTransient` exists.

**One value crosses the boundary in Phase 2, and only one:** the burn amount produced by `unwrap`.
The official `ERC20ToERC7984WrapperBase._unwrap` marks it publicly decryptable so `finalizeUnwrap`
can pay out the plaintext. That is irreversible, the contract says so, and the terminal names it
before the user signs.

### Transient access is not a weaker grant

Within its transaction, a transient recipient can call `allowPublicDecryption` and publish the value
forever, or `allow` a third party permanently. So:

- `KyrveConfidentialAssetVault` hands transient handles to **exactly one** address — the wrapped
  asset it was deployed against, fixed at construction.
- `EncryptedMandateBook` and `ConfidentialRequestBook` hand out **none**. A provider's private curve
  or a borrower's price limit passed transiently to an unreviewed contract could be published
  permanently inside that same transaction.

### Handles are deterministic, and that is an ACL hazard

Two logically distinct encrypted quantities computed identically from identical inputs are one
handle sharing one permanent ACL entry. The vault therefore keeps **no encrypted aggregate at all**.
Full analysis, including the leak an earlier draft had: delta
[Q-5](PRD-DELTA.md#q-5--1113--v11-a-16--nox-handles-are-deterministic-so-acl-grants-can-collide--correction).

---

## The public/private boundary, per value

| Value | Now | After settlement |
|---|---|---|
| wrap amount | **PUBLIC** — a plain `uint256` in calldata | public, permanently |
| confidential balance | private | private |
| vault available / locked | private | private |
| every mandate field (35) | private | private |
| every request field (19) | private | private |
| request bond, expiry, exact-fill flag, collateral reference, nonce | **PUBLIC** | public |
| mandate epoch, state, commitment hash | **PUBLIC** | public |
| unwrap amount | private until `unwrap` | **PUBLIC and irreversible** |

A commitment hash is a keccak over **handles**, not values. Handles are opaque references;
publishing one discloses nothing without an ACL grant, which the suite proves by having a second
wallet fail to decrypt a handle it can read straight out of a public getter.

---

## Emergency pause: why invariant 20 holds structurally

`KyrveEmergencyController` can express pauses over exactly five activities:

```
WrapUnderlying · VaultDeposit · MandateSubmission · RequestSubmission · ReservationOpening
```

All five are **entries**. There is no enum member for withdrawal, unwrapping, unwrap finalisation,
mandate pause, mandate retirement, request cancellation, request expiry or reservation release — so
no configuration of this contract can trap a user's assets. The guardian can stop new activity; it
cannot seize a claim, falsify an allocation, or read an encrypted value.

Proven under `pauseAll()`, the strongest state reachable: withdrawal, unwrapping, cancellation with
a full bond refund, and retirement all still succeed. `verify:confidential` asserts on chain that a
sixth activity does not exist, so adding one breaks the gate rather than passing quietly.

---

## What Phase 2 does NOT defend

Stated plainly, because a security document that lists only wins is marketing.

**Gas indistinguishability is not claimed.** The experiment was repeated against the real contracts
and found no separation above a 12–36 gas noise floor, with identical public surface and constant
calldata length. That falsifies a leak claim; it does not establish the absence of one. Local node,
local stack, one contract, small sample.

**The Nox gateway sees plaintext.** `encryptInput` sends the value to the handle gateway, which
encrypts it inside the TEE. The gateway is the confidentiality provider, not an incidental server,
and a gateway key compromise is a **total** confidentiality compromise. Kyrve's rule is that no
*Kyrve* component receives a decrypted value — and in this flow there is no Kyrve component to
receive one, which the browser flow proves by origin.

**The TEE trust assumption is unchanged.** Nothing here reduces it. Confidentiality rests on iExec's
KMS and gateway behaving as specified.

**Nothing on Sepolia has processed an encrypted input.** The Sepolia verification is entirely
read-only. AS-1 — testnet Nox latency and gas — remains UNVERIFIED. The confidential path is proven
end to end locally, against the same contract bytecode.

**Contract accounts cannot be Kyrve providers in this release.** `_assertDirectCaller` refuses
`msg.sender != tx.origin`, which implements PRD §11.1 and excludes Safes. EOAs with EIP-7702
delegated code are unaffected. This is a Kyrve design choice, not a cryptographic impossibility:
`validateInputProof` takes `owner` as a parameter, so another application could implement
metatransactions.

**No formal verification, and no external audit.** Slither reports 0 High/Medium in deployed paths.
That is a floor, not an assurance.

**The reservation path has never been driven by its real caller**, because the curve engine and
quote activator are Phase 3. The reserver is deployed unset, so every reservation entry point
reverts publicly; the safe-reservation mechanism is exercised by tests through a harness address.

---

## Key handling

Unchanged from Phase 1 and enforced by code rather than discipline. `scripts/lib/env.ts` reduces
every RPC URL to scheme and host before it can be logged, never reads the private key for display,
and `assertNoSecrets` inspects every artifact before it is written. Broadcast needs two independent
opt-ins.

The Nox stack's KMS and gateway keys in `confidential/nox-stack/dev.env` are **local-only
development material shipped inside the pinned plugin**. They control nothing on any public network
and are committed under the exception in `.claude/rules/git.md`, labelled in
`confidential/nox-stack/README.md`. `verify:secrets` still scans them and passes.
