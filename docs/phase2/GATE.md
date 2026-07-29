# Phase 2 gate

```
PHASE 2 — CONFIDENTIAL LAYER                     PASS
PHASE 2 — PRIVACY                                PASS
PHASE 2 — QUALITY AND SECURITY                   PASS
PHASE 2 — SEPOLIA                                PASS

Overall: PASS
Branch:       phase/02-confidential-assets
Baseline:     437626f (Phase 1 completed)
Date:         2026-07-29
```

`pnpm verify:phase2` reports **22 passed, 0 failed, 0 skipped**.

Unlike Phase 1 this is an unconditional PASS, because the two things that made Phase 1 conditional
both cleared: the Nox runtime suite is no longer opt-in — it is the primary gate, and the gate exits
non-zero with the verdict `NOT VERIFIED` if Docker is unavailable rather than reporting green — and
Cloudflare application deployment is still deferred by owner decision but is out of Phase 2 scope by
instruction, so it is not a gate here at all.

---

## PHASE 2 — CONFIDENTIAL LAYER · PASS

| Gate | Status |
|---|---|
| workspace reproducibility (`--frozen-lockfile`) | **PASS** |
| TypeScript build across every package | **PASS** |
| web terminal typecheck | **PASS** |
| confidential contracts compile (solc 0.8.36, osaka) | **PASS** — 9 sources |
| vendored Nox stack matches the pinned plugin | **PASS** — 2 files byte-identical, 4 images pinned |
| Foundry substrate suite | **PASS** — 53 |
| unit and property tests | **PASS** — 230 (Phase 1: 213) |
| Worker tests under workerd | **PASS** — 32 |
| **Nox suite + local deployment + browser flow** | **PASS** — 50, against the real stack |

### What "against the real stack" means here

Every one of the 50 tests runs with the pinned iExec KMS, handle gateway, ingestor and runner at
0.6.0 in Docker. A handle is a real handle; a proof is a real gateway signature; a refused
decryption is a real refusal driven by a real on-chain ACL read. Nothing on the confidentiality path
is mocked, and `contracts/` still contains no mock of Midnight either.

### The contract layer

| Contract | Role |
|---|---|
| `KyrveEmergencyController` | the single pause authority; five activities, all entries |
| `KyrveWrappedAsset` | the OFFICIAL pinned `ERC20ToERC7984Wrapper`, narrowed twice |
| `KyrveConfidentialAssetVault` | confidential provider balances, locked handles, safe reservations |
| `EncryptedMandateBook` | 35 encrypted handles per mandate, replacement epochs |
| `ConfidentialRequestBook` | 19 encrypted handles per request, a public bond |
| `KyrveConfidentialBase` | direct-caller binding, one-shot handles, nonces, the exact ACL grant |

`KyrveWrappedAsset` does not reimplement or fork ERC-7984. It adds exactly two rules: a bounded
operator window, because an ERC-7984 operator has no per-amount allowance and can unwrap a holder's
entire balance to any address; and a pause on `wrap` only.

---

## The fifteen required demonstrations

Every one passes against the real stack. The suite file and case are named so each can be re-run
alone.

| # | Demonstration | Where | Result |
|---|---|---|---|
| 1 | Provider wraps public test USDC | `10-confidential-asset.ts` | **PASS** |
| 2 | The public transaction reveals the wrap amount | `10` — recovered from calldata | **PASS** |
| 3 | Provider decrypts the resulting private balance | `10` | **PASS** |
| 4 | Another wallet cannot decrypt it | `10` — ACL read + gateway refusal | **PASS** |
| 5 | Provider submits an encrypted multi-market mandate | `20-mandate-book.ts` | **PASS** — 35 handles |
| 6 | Provider decrypts the stored mandate | `20` — all 35 fields | **PASS** |
| 7 | Another wallet cannot decrypt it | `20` | **PASS** |
| 8 | Provider replaces the mandate | `20` | **PASS** — epoch 1 → 2 |
| 9 | Old epoch becomes unusable | `20` — `StaleMandateEpoch` | **PASS** |
| 10 | Borrower submits an encrypted request | `30-request-book.ts` | **PASS** — 19 handles |
| 11 | Borrower decrypts the request | `30` | **PASS** |
| 12 | Another wallet cannot decrypt it | `30` | **PASS** |
| 13 | Wrong-owner, wrong-contract, expired, malformed, replayed, tampered proofs fail | `40`, `95` | **PASS** — 7 cases, each on its own reason |
| 14 | Pause and recovery paths work | `50-pause-recovery.ts` | **PASS** — 8 cases |
| 15 | No private value in logs, API data, snapshots or repository files | `verify:privacy-scan` | **PASS** — falsifiable |

### Demonstration 2, stated precisely

The wrap amount is read back out of the transaction's calldata rather than asserted. It is public,
permanently, and no amount of care changes that — it is the honest cost of entering the confidential
layer from a public ERC-20. The privacy scan classifies it as public by construction and **refuses
to let a private value be reclassified into that set**, so the classification cannot become an
escape hatch.

### Demonstration 9, stated honestly

Epoch 1 stops authorising activity. Its handles are **not destroyed and cannot be** — Nox has no way
to delete a ciphertext or withdraw a grant, and the suite asserts that the provider can still
decrypt the superseded epoch. A user interface must therefore never call a replacement a revocation,
and the terminal's copy is asserted against that wording in the browser flow.

### Demonstration 13, by enforcer

Four of these hold against any application; two hold only because Kyrve implements them. That
distinction is the point of Q-2.

| Attack | Refused by | Reason asserted |
|---|---|---|
| wrong owner | NoxCompute | `Owner mismatch` |
| wrong application contract | NoxCompute | `App mismatch` |
| expired proof | NoxCompute | `Proof expired` |
| tampered signature body | ECDSA or NoxCompute | either, reported |
| tampered recovery byte | OpenZeppelin ECDSA | `ECDSAInvalidSignature` |
| **replayed handle** | **Kyrve** | `HandleAlreadyConsumed` |
| **relayed caller** | **Kyrve** | `RelayedCallerRefused` |

### Demonstration 14, and why invariant 20 holds structurally

`pauseAll()` is the strongest state a guardian can reach. Under it, a provider still withdraws from
the vault, a holder still unwraps to the public ERC-20, a borrower still cancels and recovers the
whole bond, and a provider still retires their mandate.

That is not a promise about configuration. `KyrveEmergencyController` can only express pauses over
an enum of five members, all of which are entries; **no member exists for withdrawal, unwrapping,
unwrap finalisation, cancellation, expiry, retirement or reservation release.** The suite asserts
the enum's shape, and `verify:confidential` asserts on chain that a sixth activity does not exist.

---

## PHASE 2 — PRIVACY · PASS

| Gate | Status |
|---|---|
| no private value in any file, log or code path | **PASS** — falsifiable, proven |
| import boundary (Nox isolation, A-15) | **PASS** — 139 tracked files, 0 violations |
| gas side-channel evidence recorded and not overclaimed | **PASS** |

### The privacy scan has two halves, and both are proven falsifiable

**Empirical.** The plaintext the suite actually decrypts lives in one file, in high-entropy form so
a match cannot be coincidence, and is searched for across every tracked and untracked file plus the
captured suite output.

**Structural.** The empirical half can only catch values a run happened to decrypt, so the code is
checked too: the decryption path must hold no `console`, `fetch`, file or storage sink, and no
Worker or script may import it.

Both were verified to fail on a real violation — a planted value in a captured log, and a planted
`console.log` on the decrypt path — each exiting non-zero. A check that cannot fail proves nothing.

### Gas side channel — the required repeat

| Measure | Result |
|---|---:|
| noise floor, 8 identical inputs | 12–36 gas |
| predicate gap, covered vs short, interleaved | **0 gas** |
| groups separated by gas | **no** |
| mandate shape (1 vs 8 markets) separable by gas | **no** |
| calldata length | constant, 292 and 9,092 bytes |
| public status, log count, event topic | identical across every branch |

**Kyrve still must not claim gas indistinguishability.** This falsifies a leak claim; it cannot
establish the absence of one. Local node, local stack, one contract, small sample. `verify:phase2`
fails if the recorded verdict ever stops disclaiming that.

Full method, including the case that nearly produced a false finding, is delta
[Q-9](PRD-DELTA.md#q-9--v-24--threat-model-t-1--the-gas-experiment-repeated-against-real-contracts--confirmed).

---

## PHASE 2 — QUALITY AND SECURITY · PASS

| Gate | Status |
|---|---|
| lint and format | **PASS** — biome 0, `forge fmt --check` clean |
| secret scan | **PASS** — 307 files, per credential |
| licence matrix | **PASS** — Midnight described as source-available, never as open source |
| slither static analysis | **PASS** — 0 High/Medium in deployed paths |
| dependency advisories | **PASS** — 0 at moderate or above |
| generated artifacts byte-identical on regeneration | **PASS** — 6 paths |
| Worker bundles clean under workerd | **PASS** |
| vendored Midnight unmodified | **PASS** — 28 files, tree hash `7fb501e3…` |

Eleven transitive advisories arrived with the Hardhat toolchain. All eleven had published fixes, so
they are pinned forward with exact versions rather than excused as development-only — see
[Q-11](PRD-DELTA.md#q-11--claudeirulesgitmd--eleven-advisories-arrive-with-the-hardhat-toolchain--risk--resolved).

---

## PHASE 2 — SEPOLIA · PASS

Deployed at block **11375744**, deployer `0x36C3d1AF18b9186A662B1e277c80Ab54bE2765C2`,
**6,505,207 gas**. **6/6 contracts verified on Etherscan V2.**

| Contract | Address | Source |
|---|---|---|
| `KyrveEmergencyController` | `0x856d03263a96269a599bc7b1f6d6074a0e153da7` | verified |
| `TestUnderlyingERC20` | `0xd3f224ae2d32c386da0697aa920c9a9eb32df896` | verified |
| `KyrveWrappedAsset` | `0x9e1e5cb703194df3c22c0531bd15f04ec9de11c7` | verified |
| `KyrveConfidentialAssetVault` | `0x07e7247726270f7d409580fe2a872ea333257e45` | verified |
| `EncryptedMandateBook` | `0xbfe15b60ce998e0f19de3eb1d953aa09dd50bbf9` | verified |
| `ConfidentialRequestBook` | `0x96aa8b16ec3e91c5a3d8ce526f196a4934cb3b39` | verified |

`verify:confidential sepolia` reads all of this back from chain state rather than from the broadcast
log: six runtime hashes match what was recorded, six constructor wirings are confirmed through each
deployed contract's own getter, NoxCompute is live at `0x24Ef…77bF`, the reserver is unset, nothing
is paused, and a sixth pausable activity does not exist.

### What Sepolia does NOT prove

**No encrypted input has been submitted to the hosted iExec gateway.** The Sepolia verification is
entirely read-only. Handle computation depends on a KMS, an ingestor and a runner that this
repository cannot see and does not operate; on Sepolia those are iExec's hosted services, and their
availability is an operational dependency rather than a property of the deployment. AS-1 —
testnet Nox latency and gas — remains **UNVERIFIED**, exactly as it was after Phase 1.

The confidential path is proven end to end **locally**, against the same contract bytecode.

---

## Evidence

```
pnpm verify:phase2                             22 passed, 0 failed, 0 skipped
pnpm --filter @kyrve/confidential test         50 passed, 0 failed   (real Nox stack, needs Docker)
forge test                                     53 passed, 0 failed
pnpm test:unit                                230 passed, 0 failed
pnpm test:workers                              32 passed, 0 failed   (workerd)
pnpm exec tsc --build                           0 errors
pnpm exec biome check .                         0 errors
pnpm verify:confidential sepolia               6 contracts, 6 wiring checks, all live
pnpm verify:etherscan:confidential             6/6 verified
```

Reproduce, local only — needs Docker for the Nox stack:

```bash
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm --filter @kyrve/confidential build
pnpm verify:phase2
```

Drive the terminal by hand against the local stack:

```bash
pnpm --filter @kyrve/confidential test   # brings the stack up and tears it down
pnpm web:dev                             # after a deployment record exists
```

Read-only against the live Sepolia deployment (needs only `ALCHEMY_API_KEY`):

```bash
pnpm verify:confidential sepolia
```

Broadcast paths require two independent opt-ins and are not reachable by accident:

```bash
pnpm preflight:sepolia                   # read-only; signs nothing
DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true pnpm deploy:confidential sepolia
pnpm verify:etherscan:confidential
```

---

## New PRD deltas

Eleven, in [`PRD-DELTA.md`](PRD-DELTA.md). Three are worth reading even if the rest are not:

- **Q-5** — Nox handles are deterministic in their operands, so two logically distinct encrypted
  quantities can share one handle **and one permanent ACL entry**. An earlier vault draft leaked the
  protocol aggregate to the first depositor this way. Found by a test.
- **Q-2** — input proofs carry no nonce and no consumption marker, so replay protection is entirely
  the application's job. Kyrve supplies it; the PRD assumed Nox did.
- **Q-4** — `@iexec-nox/handle` ignores the account its client was constructed with, so on any
  multi-account node every proof is minted for account zero and every holder is refused their own
  balance.

---

## Residual risks

Unchanged unless noted: testnet Nox latency and gas (AS-1, **still unverified**), storage under load
(AS-4), concurrent epochs (AS-5), the Morpho licence grant (AS-10). Gas indistinguishability (T-1)
was re-measured against the real contracts and showed no separation, and the claim still must not be
made.

**AS-11 is further discharged:** 6,505,207 gas of deployment landed on live Sepolia across six
transactions, and the largest single confidential transaction measured anywhere is a 4,158,623 gas
mandate submission — comfortably inside the 24M ceiling, though only locally.

---

## Phase 3 prerequisites

Recorded in [`PHASE-3-PREREQUISITES.md`](PHASE-3-PREREQUISITES.md). The curve engine must not start
before those are read: two of them are constraints Phase 2 discovered the hard way, and the curve
engine is exactly where they recur.
