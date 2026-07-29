# Phase 3 gate

```
PHASE 3 — LOCKS AND BOUNDARIES                   PASS
PHASE 3 — CURVE ENGINE                           PASS
PHASE 3 — PRIVACY                                PASS
PHASE 3 — QUALITY AND SECURITY                   PASS
PHASE 3 — SEPOLIA                                PASS

Overall: PASS
Branch:       phase/03-curve-engine
Baseline:     5039e9e (Phase 2 completed)
Date:         2026-07-29
```

`pnpm verify:phase3` reports **27 passed, 0 failed, 0 skipped**.

It did not start there. The gate stood at CONDITIONAL PASS with one SKIP — a real curve epoch on
Sepolia — for as long as the deployer was unfunded, and that skip was reported with a priced
shortfall rather than folded into the pass count. It is now run, and the section below records what
it cost, including where the estimate was wrong.

---

## PHASE 3 — CURVE ENGINE · PASS

| Gate | Status |
|---|---|
| workspace reproducibility (`--frozen-lockfile`) | **PASS** |
| source lock | **PASS** — 9 pins |
| toolchain lock | **PASS** — 12 pins, all dependencies exact |
| Nox import boundary | **PASS** — only `@kyrve/nox` reaches iExec |
| vendored Midnight unmodified | **PASS** |
| TypeScript build across every package | **PASS** |
| confidential contracts compile (solc 0.8.36, osaka) | **PASS** |
| **every deployable contract fits EIP-170** | **PASS** — 16 contracts |
| unit, property and reference-model tests | **PASS** — 339 |
| Foundry substrate suite | **PASS** — 53 |
| Worker tests under workerd | **PASS** — 32 |
| **Nox suite against the real stack** | **PASS** — 90 |
| 16 × 128 benchmark recorded, planner sized against it | **PASS** |

### What "against the real stack" means here

All 90 tests run with the pinned iExec KMS, handle gateway, ingestor and runner at 0.6.0 in Docker.
A handle is a real handle, a proof is a real gateway signature, a refused decryption is a real
refusal driven by a real on-chain ACL read, and a published value is a real `allowPublicDecryption`.
Nothing on the confidentiality path is mocked.

### The contract layer

| Contract | Role | Bytes |
|---|---|---:|
| `CurveUniverseRegistry` | the public universe, frozen on activation | 6,820 |
| `QuoteEpochController` | the epoch state machine, chunk ids, idempotence | 7,827 |
| `CurveGraphRegistry` | the consensus-critical graph commitment | 3,182 |
| `ReservationLedger` | handle-native encrypted reservations | 4,667 |
| `NoxCurveEngine` | the seven stages | 23,633 |
| `CurveResultVerifier` | read-only proof binding | 5,312 |
| `KyrveCurveBase` | handle isolation — the P3-1 discharge | abstract |
| `DecryptedValue` | natural-width plaintext decoding | library |

---

## The twenty required demonstrations

Every one passes against the real stack. The suite file and case are named so each can be re-run
alone.

| # | Demonstration | Where | Result |
|---|---|---|---|
| 1 | Four providers submit different mandates | `80-curve-epoch.ts` | **PASS** |
| 2 | One borrower submits a request | `80` | **PASS** |
| 3 | At least 64 leaves are evaluated | `80` — 64, each carrying a handle | **PASS** |
| 4 | One provider is privately excluded | `80` — a real below-minimum balance | **PASS** |
| 5 | The public surface does not reveal which provider or why | `80` | **PASS** |
| 6 | Privacy floor passes | `80` | **PASS** |
| 7 | One winning leaf is selected | `80` | **PASS** |
| 8 | Selected market, rate and aggregate decrypt publicly | `80` — real gateway proofs | **PASS** |
| 9 | Losing leaves remain private | `80` — all 63, not a sample | **PASS** |
| 10 | Provider allocations decrypt only to their owners | `80` | **PASS** |
| 11 | Reservations sum to the public aggregate | `80` — exactly | **PASS** |
| 12 | Dust reconciliation is exact | `80` | **PASS** |
| 13 | Re-running a completed chunk is idempotent | `81-curve-attacks.ts` | **PASS** |
| 14 | Skipping a chunk prevents finalisation | `81` — `StageIncomplete` | **PASS** |
| 15 | A stale mandate cannot participate | `81` — `StaleMandateEpoch` | **PASS** |
| 16 | A replayed proof or handle fails | `81` — `UnboundHandle` | **PASS** |
| 17 | Equal-valued logical fields do not leak ACL authority | `81` — 3 cases, see R-6 | **PASS** |
| 18 | Cancellation releases every reservation | `81` — restored in full | **PASS** |
| 19 | A 16 × 128 epoch completes | `82-curve-benchmark.ts` | **PASS** |
| 20 | Nox output matches the plaintext reference model exactly | `80` — public and private | **PASS** |

### Demonstration 4, stated precisely

The excluded provider holds a **real confidential balance that is simply too small** — half the
universe's minimum ticket — so the exclusion happens under encryption where the demonstration claims
it does. An earlier fixture used a zero balance, which is a different situation entirely: a provider
who never deposited has an UNDEFINED vault handle, which resolves to the type's public zero, has no
ACL, and cannot be granted or computed on. `sealProviderSnapshot` refuses that by name, and case 15b
asserts it.

### Demonstration 16, by enforcer

| Attack | Refused by | Reason asserted |
|---|---|---|
| a real proof from ANOTHER epoch | Kyrve | `UnboundHandle` |
| a real handle under the WRONG ROLE | Kyrve | `UnboundHandle` |
| the same proof against its own epoch | — | **verifies**, so the refusals above are about the binding |

That last row matters. Without it the test would pass on a verifier that rejected everything.

### Demonstration 17, and why it is three cases

The obvious test — two providers with identical mandates, assert distinct allocation handles —
**passes with the isolation primitive removed entirely**, because gateway input handles are distinct
per encryption so every intermediate differs anyway. `IsolationProbe` removes the confound by feeding
the SAME operand handles into both branches. Recorded as delta R-6.

### Demonstration 19, measured

| | |
|---|---:|
| providers × markets × rates | 16 × 8 × 16 |
| leaves | 128 |
| eligibility cells | 2,048 |
| transactions | **22** |
| epoch gas | **297,216,601** |
| peak transaction | **18,193,386** against a 24,000,000 ceiling |
| accumulate, per cell | **71,068** |

---

## PHASE 3 — PRIVACY · PASS

| Gate | Status |
|---|---|
| no private value in any file, log or code path | **PASS** — falsifiable |
| exactly five values publicly decryptable | **PASS** — exhaustive, not sampled |
| gas side-channel measured against the curve engine | **PASS** — no separation |

### The public surface, enumerated rather than sampled

`84-curve-public-surface.ts` gathers **every** handle an epoch produced — leaf capacities, fillables,
provider counts, cached predicates, allocations, ledger seeds, remainings, reservations and the dust
residue — from a count derived from the universe's own shape, and asserts that exactly the five
published results are publicly decryptable. It carries its own negative control, because
`allowPublicDecryption` is irreversible and a scan that cannot fail would be worse than no scan.

### Gas side channel — the required repeat

| Measure | Result |
|---|---:|
| noise floor, 6 identical inputs | **12 gas** |
| fillable range | 738,942 – 738,954 |
| no-fill range | 738,942 – 738,954 |
| groups separated by gas | **no** |
| log count, public shape across branches | identical |

Two groups differing in exactly one encrypted comparison, sampled interleaved over one universe and
one pair of providers so that provider state, mandate handles and ACL grants are identical in every
sample.

**Kyrve still must not claim gas indistinguishability.** This falsifies a leak claim for one branch;
it cannot establish the absence of one. Local node, local stack, one contract, six samples per group,
gas only. `verify:phase3` fails if the recorded verdict ever stops disclaiming it.

---

## PHASE 3 — QUALITY AND SECURITY · PASS

| Gate | Status |
|---|---|
| Git identity and a clean working tree | **PASS** — winsznx, no co-author trailers |
| lint and format | **PASS** — biome 0, `forge fmt --check` clean |
| secret scan | **PASS** — 385 files |
| licence matrix | **PASS** |
| slither static analysis | **PASS** — 0 High/Medium in deployed paths |
| dependency advisories | **PASS** — 0 at moderate or above |
| generated artifacts byte-identical on regeneration | **PASS** — 6 paths |

---

## PHASE 3 — SEPOLIA · CONDITIONAL

### AS-1 is discharged

The first encrypted input this repository has ever submitted to the **hosted** iExec stack. Block
11376417.

| Measure | Result |
|---|---:|
| handles encrypted through the hosted gateway | 19, in 15,453 ms (813 ms each) |
| proof size | 137 bytes |
| submitted, every proof validated by NoxCompute | 2,302,299 gas, confirmed in 17,919 ms |
| owner decrypted one back | 2,696 ms |
| total spend | 0.0015 ETH |

**What it does not establish**, and the evidence file says so about itself: throughput for a
2,048-cell epoch, or any availability guarantee over services this repository neither sees nor
operates.

### The curve layer is deployed and verified

Block **11376471**, deployer `0x36C3d1AF18b9186A662B1e277c80Ab54bE2765C2`, **11,585,791 gas**,
0.0121 ETH. **6/6 verified on Etherscan V2.**

| Contract | Address |
|---|---|
| `CurveUniverseRegistry` | `0x6ab68b7a449e229bbabb498ac5346bd1bbb4d49b` |
| `QuoteEpochController` | `0xdcdca66eec89e6550a9c1cbee71532ffafe84b14` |
| `CurveGraphRegistry` | `0xfa5cc26374df9a9f809a102641326e8d45406522` |
| `ReservationLedger` | `0x7bfa541831d1db8ca70f44f9989396abc397b650` |
| `NoxCurveEngine` | `0x4106348f3e3d33752c46a331c539d7dfc95d76d1` |
| `CurveResultVerifier` | `0x0c99904dc91a601f216fe7ef20f93ebeb32d18e1` |

`verify:curve sepolia` reads all of it back from chain state: six runtime hashes, six sizes measured
against EIP-170 from the code the chain returned, eleven wiring checks through each contract's own
getter, nine shared constants compared against `@kyrve/curve`, and the engine bound into all three
contracts that must know it.

Phase 2 is deliberately **not** redeployed. The engine is constructed against the five contracts
already deployed and verified there.

### A real curve epoch ran on Sepolia

Epoch `0xcf3e5c94427e62ce1d362d071c5e29aeed801b51b424fbd2e01d63a76b4690e3`, against the hosted iExec
stack: two providers, one borrower, one market, two rates. The smallest universe that still exercises
every stage — a privacy floor of 2 needs two providers, and two leaves make the winner fold do a real
comparison rather than only seeding.

| | on Sepolia | reference model |
|---|---|---|
| selected market index | 0 | 0 |
| selected rate index | 0 | 0 |
| privacy floor passed | true | true |
| quote ready | true | true |
| **aggregate fill** | **299,999,999** | **299,999,999** |

All five verified through `CurveResultVerifier` with real gateway proofs, under graph root
`0xe7f7ca73…`.

The aggregate is 299,999,999 and not 300,000,000, and that is the design working rather than a
rounding annoyance: each pro-rata share is floored by `safeDiv`, so the reservations sum to one unit
less than the winning leaf's fill. The published aggregate is defined as the sum of what was
*reserved*, so "reservations sum to the public aggregate" holds exactly — and the reference model
predicted the same 299,999,999 without being told.

**Measured cost: 0.0299 ETH** across three wallets — 0.0123 curator, 0.0176 across the two providers,
whose 37 ACL grants each are the bulk of it. `scripts/test/sepolia-epoch-budget.ts` predicted 0.0236
from local gas figures, so **the local estimate understated a public network by 27%**. Recorded in
`evidence/phase3/sepolia-epoch-cost.json`.

### What Sepolia still does NOT prove

The 16 x 128 universe has run locally, not on Sepolia — that is 2,048 cells against this epoch's 4,
and roughly 120 times the transactions. Nor does any of this make the hosted KMS, ingestor and runner
a Kyrve availability guarantee; they are an operational dependency, disclosed as one.

---

## Evidence

```
pnpm verify:phase3                             25 passed, 0 failed, 1 skipped
pnpm --filter @kyrve/confidential test         90 passed, 0 failed   (real Nox stack, needs Docker)
pnpm exec vitest run                          339 passed, 0 failed
forge test                                     53 passed, 0 failed
pnpm test:workers                              32 passed, 0 failed   (workerd)
pnpm exec tsc --build                           0 errors
pnpm exec biome check .                         0 errors
pnpm verify:contract-size                      16 contracts, all inside EIP-170
pnpm verify:curve sepolia                       6 contracts, 11 wiring checks, 9 constants
pnpm verify:etherscan:curve                     6/6 verified
```

Reproduce, local only — needs Docker for the Nox stack:

```bash
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm --filter @kyrve/confidential build
pnpm verify:phase3
```

Read-only against the live Sepolia deployment (needs only `ALCHEMY_API_KEY`):

```bash
pnpm verify:curve sepolia
```

Broadcast paths require two independent opt-ins and are not reachable by accident:

```bash
DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true pnpm test:sepolia-nox    # the AS-1 prerequisite
DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true pnpm deploy:curve sepolia
pnpm verify:etherscan:curve
```

---

## New PRD deltas

Fourteen, in [`PRD-DELTA.md`](PRD-DELTA.md). **Ten of the fourteen were found by running something
rather than by reading it**, and five only surfaced on a real network or at full scale. Four are
worth reading even if the rest are not:

- **R-10** — `NoxCurveEngine` was 464 bytes over EIP-170 and the entire suite ran green against it,
  because the local node allows unlimited contract size and **cannot be made not to**: NoxCompute
  itself is over the limit.
- **R-4** — Phase 1's `expectedAggregateHandle` shares none of its inputs with how NoxCompute derives
  a handle, so it could never equal a real one. The binding resting on it was decorative.
- **R-3** — every stage costs more than Day 0 measured, and stage B's UNIT was wrong as well as its
  cost. The conclusion survives; the schedule grew from 18 transactions to 22.
- **R-6** — the obvious ACL-aliasing test passes with the defence removed.
- **R-13** — `scripts/` is in no project reference, so `tsc --build` never typechecked the entire
  deployment, verification and gate tree. Found when a badly broken script passed the build and then
  failed at runtime.

---

## Residual risks

Unchanged unless noted: storage under load (AS-4), concurrent epochs (AS-5), the Morpho licence grant
(AS-10). AS-1 is **discharged**: a nineteen-handle round trip, and now a complete four-cell epoch
end to end on a public network. Epoch-scale throughput at 16 × 128 remains local-only (R-7).
Gas indistinguishability (T-1) was re-measured against the curve engine and showed no separation; the
claim still must not be made.

**AS-11 is further discharged:** 11,585,791 gas of Phase 3 deployment landed on live Sepolia, and the
largest single curve transaction measured anywhere is 18,193,386 gas — inside the 24M ceiling, though
only locally.

---

## Phase 4 prerequisites

Recorded in [`PHASE-4-PREREQUISITES.md`](PHASE-4-PREREQUISITES.md). Three of them are constraints
Phase 3 discovered by being caught out by them, and quote activation is exactly where each recurs.
