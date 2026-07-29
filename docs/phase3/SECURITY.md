# Phase 3 security

What the curve engine defends, what it does not, and what an observer actually learns.

Everything here is either enforced by code with a named test, or stated as a limit. There is no third
category.

---

## 1 · The public/private boundary, exactly

| Value | State | Enforced by |
|---|---|---|
| the universe: markets, maturities, the whole tick grid, the privacy floor | **public from creation** | `CurveUniverseRegistry`, frozen on activation |
| that an epoch exists, for which request, which providers were sealed in | **public from sealing** | `QuoteEpochController` |
| which stage and chunk ran, and the graph root | **public** | `CurveGraphRegistry` |
| every provider's budget, caps, minimum rates, enabled markets | **private forever** | never granted, never published |
| the borrower's desired size, minimum, maximum rates, maturity preference | **private forever** | ” |
| every leaf's capacity, including the winner's | **private forever** | ” |
| the exact provider count for any leaf | **private forever** | ” |
| whether a given provider was eligible, included or allocated | **private forever** | ” |
| the second-best leaf | **never materialised** | the fold carries only the running best |
| the dust residue | **private forever** | it would disclose the winning leaf's capacity |
| provider allocations, reservations, remaining balances | **private to their owner** | isolated, then `allow(owner)` |
| selected market index, selected rate index, aggregate fill, privacy-floor boolean, quote-ready boolean | **public on publication** | five `allowPublicDecryption` calls, one private helper |

`84-curve-public-surface.ts` enumerates **every** handle an epoch produced — a count derived from the
universe's own shape, not a sample — and asserts exactly five are publicly decryptable. It carries a
negative control, because `allowPublicDecryption` is irreversible and a scan that cannot fail is
worse than no scan.

---

## 2 · Provider participation is public, and that is the honest cost

An observer of the chain learns that a given address was **sealed into** an epoch. They do not learn
whether that provider was eligible on any market, at any rate, in any size, or whether they were
allocated anything.

This is the price of a permissionless keeper: someone has to be able to see which mandates an epoch
covers in order to drive it, and the sealing transaction is signed by the provider themselves.

Hiding it would need the provider set itself to be encrypted, which would make the chunk schedule
encrypted, which would make the number of transactions leak it anyway. It is stated rather than
engineered around.

---

## 3 · Confidential failure is never a public reason

Every private rejection contributes **encrypted zero** and leaves the public surface identical.

| Private outcome | What the chain shows |
|---|---|
| a provider's market is disabled | the same `StageChunkExecuted` event |
| their cap or balance is below the minimum ticket | ” |
| the leaf's rate is below their minimum | ” |
| the borrower rejects the leaf's rate | ” |
| the leaf is below the privacy floor | ” |
| the fill is below the borrower's minimum | ” |
| **no quote at all** | all five results published, `quoteReady` decrypts to 0 |

That last row is the one worth stating twice. "No quote" and "a quote" are indistinguishable in
**shape**: the same stages run, the same chunk counts, the same five publications. Only a decrypted
value differs.

Public reverts are reserved for public faults: a wrong stage, a missing chunk, a replayed handle, a
stale mandate epoch, an unauthorised caller, a proof that does not bind.

---

## 4 · What an observer can measure, and what it tells them

### Gas

Measured against the curve engine, two groups differing in exactly one encrypted comparison, six
samples each, interleaved over one universe and one pair of providers:

| | |
|---|---:|
| noise floor across identical inputs | **12 gas** |
| fillable range | 738,942 – 738,954 |
| no-fill range | 738,942 – 738,954 |
| separated | **no** |

**Kyrve must not claim gas indistinguishability.** This falsifies a leak claim for one branch. It
cannot establish the absence of one, and the limits are recorded in the evidence file: local node,
local stack, one contract, six samples per group, gas only — no timing, no memory, no network
observation. `verify:phase3` fails if the recorded verdict stops saying so.

### Transaction count and shape

Fully determined by the universe's public shape and the sealed provider count. It carries no private
information — which is why the chunk plan is public and deterministic in the first place.

### Timing

Not measured, and not claimed. The off-chain runner's latency scales with operation count (R-7), and
whether that leaks anything about the *contents* of an epoch is an open question this phase did not
answer.

---

## 5 · Irreversible grants, and who makes them

Nox has no `removeAdmin`, no `removeViewer` and no un-publish. Three things are permanent:

**The provider's grant to the engine.** 35 mandate handles, plus a vault balance. Only the owner can
make it — `INoxCompute.allow` is gated on the caller already holding access — so it is 35 separate
transactions from their own wallet, with no batch entry point and no delegation path.

It makes the engine an **admin**, which means the engine *could* call `allowPublicDecryption` on a
provider's mandate. It does not: the only call site is one private helper, reachable from two stages,
for five handles. **That is a property of reviewed code, not of the ACL**, and any interface must say
so in those words rather than implying the cryptography prevents it.

**The five publications.** Isolated, registered in the sealed graph, then published. Irreversible by
design — that is what makes a quote a quote.

**The owner grants on allocations, reservations and remaining balances.** Each isolated first, so no
two are the same handle.

A user interface must never say a grant was revoked. A replaced mandate's old handles are still
decryptable by whoever could already decrypt them; what changed is that the epoch no longer
authorises them.

---

## 6 · Replay, and why a valid proof is not authorisation

`validateDecryptionProof` is a pure EIP-712 signature check — no ACL, no nonce, no expiry, no caller
binding. A proof is replayable by anyone, in any contract, forever.

`CurveGraphRegistry` commits, in order, to the whole computation and to the exact handle each result
must be. A proof authorises only if its handle is that handle, for that role, under a sealed root.

| Attack | Outcome |
|---|---|
| a real proof from another epoch | `UnboundHandle` |
| a real handle under the wrong role | `UnboundHandle` |
| a proof for this epoch's handle carrying a different value | `DecryptedValueMismatch` |
| a proof against a graph that is not sealed | `GraphNotSealed` |
| the same proof against its own epoch and role | **verifies** — so the refusals above are about the binding, not about rejecting everything |

Input handles are guarded separately: `KyrveConfidentialBase` consumes each exactly once per contract
and requires a strictly increasing per-owner nonce, because `validateInputProof` has neither.

---

## 7 · What Phase 3 does NOT defend

Stated plainly, because a threat model that only lists defences is marketing.

**A reservation is not a lock.** `ReservationLedger` reserves against a snapshot of the provider's
vault balance. It cannot stop the provider withdrawing afterwards. Delta R-1; P4-2 requires this be
resolved before settlement.

**The gateway sees plaintext.** `encryptInput` sends the value to the Nox handle gateway, which
encrypts it inside a TEE. The gateway is not an incidental server — it is the confidentiality
provider, and a gateway key compromise is a total confidentiality compromise. The rule is that no
*Kyrve* component receives a decrypted value.

**The hosted services are an operational dependency.** On Sepolia the KMS, ingestor and runner are
iExec's. `verify:curve` proves the deployment; it cannot prove their availability.

**An uninitialised ERC-7984 balance is a public revert.** Branch-freedom holds over amounts, for an
initialised balance. Delta R-8.

**The curator can define a universe badly.** The registry rejects an invalid grid, a floor below two,
a priority that would wrap, and a chunk width above the measured budget — but a curator can still
publish a universe with markets nobody wants. It is public and frozen, so this is visible rather than
hidden.

**Contract accounts cannot be providers.** `_assertDirectCaller` refuses `msg.sender != tx.origin`, so
a Safe cannot hold a mandate in this release. That is a Kyrve design choice, not a cryptographic
impossibility: `validateInputProof` takes `owner` as a parameter, so another application could
implement metatransactions. Kyrve does not, and says so rather than claiming relaying is impossible.

**Concurrent epochs are unverified.** The controller makes epochs independent by construction —
separate ids, separate progress, separate handles — but nothing has run two at once (AS-5).
