# Phase 2 PRD delta

Corrections found while building the confidential asset, mandate and request layer.

`hack.md` and `kyrve-production-prd.md` are **never edited**; `kyrve-production-prd-v1.1.md` is the
Day 0 normative amendment. This file records what Phase 2 found on top of both, and on top of
[`docs/phase1/PRD-DELTA.md`](../phase1/PRD-DELTA.md).

Grading matches Day 0 and Phase 1:

- **CONFIRMED** — the document was right, and it is now proven rather than assumed.
- **GAP** — silent on something load-bearing. Additive.
- **CORRECTION** — states something that verification contradicts. Must change.
- **RISK** — unresolved, with a required action.

Every finding below is backed by executable output, not by argument. The suite it comes from is
named in each entry and runs against the real local Nox stack — real handles, real gateway proofs,
no mocked confidentiality path.

---

## Q-1 · §3.1 / `.claude/rules/contracts.md` — the confidential layer cannot compile at solc 0.8.34 · CORRECTION

*Source proof: `nox-protocol-contracts@0.2.4`, all nine sources.*

The contracts rule requires solc **0.8.34** with `evm_version = "osaka"` so Kyrve's bytecode stays
comparable with the pinned Midnight release. Every source in `@iexec-nox/nox-protocol-contracts`
declares:

```solidity
pragma solidity ^0.8.35;
```

The two constraints are mutually exclusive. Anything importing `sdk/Nox.sol` — which is every
confidential contract — cannot be built by the Midnight compiler profile.

**Applied as:** the confidential layer is a separate compilation unit. `confidential/` is a Hardhat
project at solc **0.8.36**, and `contracts/` stays at 0.8.34 under Foundry. `evmVersion` remains
`osaka` on both, so one artifact deploys locally and on Sepolia and the Osaka pin is not weakened.
The divergence and its reason are exported from `packages/config` as `CONFIDENTIAL_COMPILER`, so a
deployment manifest cannot omit it.

**Why Hardhat and not a second Foundry profile:** every Nox primitive is an external call into
NoxCompute, whose results are computed off chain by the KMS, ingestor and runner. Foundry cannot
drive that stack, and `vm.etch`-ing a NoxCompute would be a mocked confidentiality path.

---

## Q-2 · §11.1 / v1.1 A-12 — input proofs are replayable, and Nox does not stop it · CORRECTION

*Source proof: `modules/Compute.sol::validateInputProof`, 0.2.4. Executable proof:
`confidential/test/40-proof-attacks.ts`, case 13f.*

Day 0 finding D-2 established that `fromExternal` binds owner, application contract, chain id and a
3600-second expiry, and concluded the binding surface was sound. It is — but it is not a replay
guard, and the PRD treats it as though it were.

`validateInputProof` checks, in full: the handle's embedded chain id, the TEE type, a 137-byte proof
length, `createdAt + proofExpirationDuration`, `app == msg.sender`, `owner`, and the gateway
signature. **There is no nonce and no consumption marker.** A proof therefore stays valid to
NoxCompute, for its own owner against its own app, until it expires. Anything that accepts the same
handle twice within the hour accepts it twice.

**Required change:** the replay guard is the application's responsibility and must be stated as
such. Kyrve supplies both halves in `KyrveConfidentialBase`: every input handle is consumed exactly
once per contract, and every submission carries a strictly increasing per-owner nonce.

Proven by attack rather than asserted — a mandate is submitted, then the identical handle set is
offered again through a path with no lifecycle guard and a correct nonce, so the **only** thing that
can reject it is the consumed-handle check. It reverts `HandleAlreadyConsumed`.

---

## Q-3 · v1.1 A-15 — the handle-readiness endpoint returns a shape `@kyrve/nox` did not parse · CORRECTION

*Measured against `nox-handle-gateway` 0.6.0. Executable proof: `packages/nox/test/phase2.test.ts`.*

Day 0 identified `POST {gateway}/v0/public/handles/status` as the only way to discover readiness —
correctly, and it is absent from both the SDK and the documentation. But the parser written for it
guessed the response shape from the endpoint's name and never met a live gateway. It handled
`{state}`, `{status}`, `{handleStatus}` and `{ready}`.

The gateway actually returns:

```json
{ "payload": { "statuses": [ { "handle": "0x…", "resolved": true } ] } }
```

Every real response fell through to `unknown`, so **every wait would have run to its full timeout
and then thrown**, on every handle, forever. Nothing caught it because no test had ever spoken to a
gateway.

**Applied as:** `parseHandleState` reads the measured shape first, selects the entry matching the
handle asked about rather than the first one, and matches handles case-insensitively. The guessed
shapes are kept, because the endpoint remains unstable and undocumented, but they are no longer the
only thing under test.

---

## Q-4 · v1.1 A-15 — `@iexec-nox/handle` ignores the account its client was built with · CORRECTION

*Source proof: `services/blockchain/ViemBlockchainService.ts`, `WalletClientAdapter.getAddress`,
`@iexec-nox/handle@0.1.0-beta.13`.*

```ts
async getAddress(): Promise<EthereumAddress> {
  const addresses = await this.walletClient.getAddresses();
  const address = addresses[0];
```

`walletClient.account` is ignored. `getAddresses()` is an `eth_accounts` round trip, so against any
node exposing more than one account — every local development node, and any wallet with several
accounts unlocked — **every client resolves to account zero** regardless of which account it was
constructed with.

The consequences are not cosmetic, and both were observed against the real stack before the fix:

- input proofs are minted for the wrong owner, so submission reverts `Owner mismatch`;
- decryption authorises as the wrong account, so **a holder is refused their own balance while
  account zero is offered it**.

**Applied as:** `createHandleClient` wraps the wallet client in a proxy overriding exactly one
method, `getAddresses`, and forwards everything else untouched — so the SDK's `signTypedData` path,
which does prefer `walletClient.account`, is unaffected. Every multi-wallet test in the suite
depends on this being right, which is why it was found within minutes rather than in production.

---

## Q-5 · §11.13 / v1.1 A-16 — Nox handles are deterministic, so ACL grants can collide · CORRECTION

*Source proof: `modules/Compute.sol::_executeOperation` and `_generateHandleUniqueSeed`. Executable
proof: `confidential/test/10-confidential-asset.ts`, "Q-5: identical operands produce one handle".*

**This is the most consequential finding in Phase 2, and it was found by a test, not by reading.**

A Nox handle is a pure function of the operator, the operand handles in order, the output index, and
a seed derived from those same operands. Nothing else enters it — not the caller, not the block, not
a counter. Two logically distinct encrypted quantities computed identically from identical inputs
are therefore **not merely equal in value; they are the same handle, sharing one permanent ACL
entry.**

An earlier draft of `KyrveConfidentialAssetVault` kept an encrypted running total alongside each
provider's balance. On the first deposit into an empty vault both were `add(zeroHandle, received)`,
so `allow(balance, provider)` silently handed that provider an admin grant on the protocol
aggregate. Permanently — there is no `removeAdmin`.

In that specific case the aggregate genuinely equalled the provider's own balance, so nothing new
was disclosed. **The mechanism does not care.** Any path where two distinct quantities coincide in
value and lineage leaks one to the owner of the other, silently and irreversibly.

**Required change:** §11.13's ACL rules are necessary but not sufficient. A contract must also
guarantee that no two logically distinct stored handles can share a lineage, and that guarantee must
be proven rather than assumed.

**Applied as:** the vault keeps no encrypted aggregate at all. Phase 2 does not need one — comparing
claims against coverage is `AggregateSolvencyVerifier`, which is Phase 3 — so rather than carry a
hazard for a capability nothing uses, coverage is read from the wrapper balance, whose lineage runs
through `Nox.transfer` at a distinct output index and is structurally incapable of colliding with a
provider's. The reason is written into the contract at the point where an aggregate would go, and a
probe contract keeps the underlying property falsifiable.

**PHASE 3 REQUIREMENT:** the curve engine accumulates across providers and leaves and is exactly the
place this recurs. Every aggregate it introduces must be proven non-colliding.

---

## Q-6 · §11.9, §13.3 — the vault debits before it pays, and only an invariant makes that safe · GAP

*Executable proof: `confidential/test/50-pause-recovery.ts`, case 14c.*

`withdraw` debits the provider's internal balance and then calls `confidentialTransfer`. If the
vault's own wrapper balance were short, that transfer moves encrypted zero — burning the claim and
paying nothing, silently. Nothing about the transfer's success is branchable in Solidity, so the
ordering cannot be defended by a check.

It is defended by an accounting invariant the PRD never states:

```text
sum(available) + sum(locked)  <=  asset.confidentialBalanceOf(vault)
```

It holds because `deposit` credits exactly the handle the token returned — encrypted zero if the
provider was short — `withdraw` debits at most what is available, and reservations only move value
between `available` and `locked`.

**Action:** state the invariant normatively alongside §19.1, and require that any future path
crediting the vault preserve it. `confidentialCoverage()` exposes the right-hand side so Phase 3's
solvency verifier checks it on chain rather than by argument. The suite now asserts payment rather
than debit: it decrypts the wallet balance before and after and requires the difference to equal the
amount withdrawn.

---

## Q-7 · §11.14 / v1.1 A-17 — `IERC7984Receiver`'s documented ACL contract is not honoured · GAP

*Source proof: `token/utils/ERC7984Utils.sol` and `interfaces/IERC7984Receiver.sol`, 0.2.2.*

`IERC7984Receiver` documents:

> NOTE: The `amount` handle is accessible to this contract via the ACL.

The shipped `ERC7984Utils.checkOnTransferReceived` does not grant it. `_executeOperation` grants
transient access to `msg.sender` only, which is the token — so a receiver invoked through
`confidentialTransferAndCall` has **no ACL on the amount it was just handed** and cannot compute on
it.

**Consequence for Kyrve:** the obvious deposit design — `confidentialTransferAndCall` into a vault
implementing `IERC7984Receiver` — cannot work with the official implementation unchanged, and Kyrve
does not fork it.

**Applied as:** deposits are operator-based. The provider grants the vault a short ERC-7984 operator
window, the vault validates the encrypted amount itself and calls `confidentialTransferFrom`. This
exercises the bounded-operator rule rather than routing around it: the grant is all-or-nothing
because ERC-7984 has no per-amount allowance, which is why `KyrveWrappedAsset` caps the window at
seven days and why the honest pattern is grant, deposit, `until = 0`.

---

## Q-8 · §11.5 / v1.1 A-9 — encrypted-zero padding is a privacy control, not an encoding detail · GAP

*Executable proof: `confidential/test/60-gas-side-channel.ts`, case C.*

§11.3 says "unused slots are encrypted zero". It reads as an encoding convenience. It is a privacy
control: a variable-length submission would leak how many markets a provider is willing to lend
into, which is precisely the shape inference §8.3 exists to prevent.

Proven, rather than asserted: a mandate enabling one market and a mandate enabling eight produce
**identical calldata length** — 9,092 bytes — and gas ranges that overlap.

**Action:** state the fixed shape as normative in §11.3, and treat any future variable-length
encrypted submission as a privacy regression rather than an optimisation.

---

## Q-9 · V-24 / THREAT-MODEL T-1 — the gas experiment, repeated against real contracts · CONFIRMED

*Executable proof: `confidential/test/60-gas-side-channel.ts`. Raw data:
`evidence/phase2/gas-side-channel.json`.*

Phase 1 reclassified T-1 from OPEN-FAIL to NOT SUPPORTED BY EVIDENCE and required Phase 2 to repeat
the measurement against the real curve-path contracts. Done, against
`KyrveConfidentialAssetVault.withdraw` — the Phase 2 contract that genuinely contains a confidential
branch.

| Measure | Result |
|---|---:|
| noise floor, 8 **identical** inputs | 12–36 gas |
| predicate gap, covered vs short, interleaved | **0 gas** |
| groups separated by gas | **no** |
| mandate shape (1 vs 8 markets) separable by gas | **no** |
| calldata length | constant — 292 and 9,092 bytes |
| public status, log count, event topic | identical across every branch |

The noise floor is calldata byte composition: handles are pseudorandom and the EVM charges 16 gas
per non-zero byte against 4 per zero byte.

**Method note, because it nearly produced a false finding.** The first version of case C compared a
single 1-market mandate against a single 8-market one, saw 72 gas of difference, and would have
reported a leak. That difference is the same byte-composition jitter, multiplied by 35 handles. The
case now samples both shapes repeatedly and asks whether the ranges **separate**, which is the only
shape in which an observer could classify a single transaction.

**Unchanged, and stated in the same words as Phase 1: Kyrve must not claim gas
indistinguishability.** This falsifies a leak claim; it cannot establish the absence of one. Local
node, local stack, one contract, small sample — all four limits are recorded in the evidence file,
and `verify:phase2` fails if the recorded verdict ever stops disclaiming them.

---

## Q-10 · §6.9 — "no server receives a decrypted value" needs the gateway named · CORRECTION

*Executable proof: `confidential/test/70-browser-flow.ts`, last case.*

§6.9 and `.claude/rules/security.md` say no decrypted value reaches a server. Taken literally that is
false, and a test written to make it literally true would have to be weakened until it proved
nothing: **`encryptInput` sends the plaintext to the Nox handle gateway**, which encrypts it inside
the TEE. The gateway is not an incidental server — it is the confidentiality provider, and a gateway
key compromise is a total confidentiality compromise.

**Required change:** state the rule as *no **Kyrve** component receives a decrypted value*, and
disclose the gateway as a trust assumption rather than an implementation detail (§20.1 already
requires the disclosure; §6.9 should point at it).

**Proven by origin, not by substring.** Every character of a decimal amount is also valid hex, so
searching request bodies matches coincidentally inside signed transactions — an earlier version of
this test failed exactly that way. What holds without a statistical argument: the application origin
receives **no request body at all**, browser storage stays empty, and the terminal talks to exactly
two things — the gateway and the chain.

---

## Q-11 · `.claude/rules/git.md` — eleven advisories arrive with the Hardhat toolchain · RISK → resolved

Adding the Hardhat 3 toolchain needed to drive the real Nox stack introduced eleven transitive
advisories: six in `undici`, three in `lodash-es`, one in `adm-zip`, plus one duplicate. All arrive
through `hardhat` or `@nomicfoundation/hardhat-toolbox-viem`, all are development-only, and none
reaches a bundle or a deployed artifact.

"It is only a dev dependency" is how a supply-chain compromise gets in, and every one of these had a
published fix. **Applied as:** exact overrides in `pnpm-workspace.yaml`, pinned like every other
dependency in the repository, each naming the advisories it closes. `pnpm audit --audit-level
moderate` now reports zero.

---

## Residuals carried forward

| Item | Status after Phase 2 |
|---|---|
| Gas indistinguishability (V-24 / T-1) | **RE-MEASURED against the real contracts — see Q-9.** No separation observed. The claim still must not be made. |
| Testnet Nox latency and gas (AS-1) | **STILL UNVERIFIED.** The Sepolia deployment is verified by read-only calls; no encrypted input has been submitted to the hosted iExec gateway. |
| Storage under realistic load (AS-4) | **STILL UNVERIFIED.** |
| Concurrent epochs (AS-5) | **STILL UNVERIFIED.** No epoch controller exists yet. |
| Morpho BUSL Additional Use Grant (AS-10) | **STILL EMPTY.** External, non-technical, unchanged. |
| 24M gas ceiling on live Sepolia (AS-11) | **PARTIALLY DISCHARGED.** A 6,505,207 gas deployment landed on Sepolia in six transactions; the largest single confidential transaction measured anywhere is a 4,158,623 gas mandate submission, locally. |
