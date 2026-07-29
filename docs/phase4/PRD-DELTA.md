# Phase 4 deltas

Where the PRD, the plan or a prior phase's evidence disagrees with verified reality, reality wins
and the correction is recorded here. The three immutable documents are never edited.

Prior deltas: `docs/day0/PRD-DELTA.md` (A-*), `docs/phase1/PRD-DELTA.md` (P-*),
`docs/phase2/PRD-DELTA.md` (Q-*), `docs/phase3/PRD-DELTA.md` (R-*). Phase 4's are **S-***.

---

## S-1 · The local Nox node did not execute Osaka, and the failure named nothing

**Severity: was blocking. Fixed.**

The Nox Hardhat plugin configures its node as `chainType: "op"`, whose latest EDR hardfork is
Isthmus. Kyrve's Foundry contracts and the vendored Midnight core compile at `evm_version = "osaka"`
because Ethereum Sepolia is on Osaka and one artifact must deploy to both environments. Osaka adds
CLZ (EIP-7939, opcode `0x1e`), and solc emits it.

On the OP node CLZ is an INVALID opcode. Nothing about that is visible early:

- every contract deployed, including `LocalMidnightFixture`, which itself deploys Midnight;
- every constructor ran;
- every view returned;
- a whole confidential epoch completed, published, sealed and verified;
- `QuoteActivator.activate` succeeded, including its own call to `TickLib.tickToPrice`;

and then one execution path inside `Midnight.take` reached CLZ and the transaction died with

```
VM Exception while processing transaction: invalid opcode
```

no revert reason, no selector, nothing naming the cause. Because an explicit gas limit was not set,
it first surfaced as a failed gas estimation, which sent the investigation towards the RPC layer.

**Root cause found by** deploying `KyrveOsakaProbe` — which exists precisely to prove CLZ — onto the
node and calling it. `verifyOsaka()` reverted. That is the check, and it takes 250 ms.

**Fix.** `confidential/hardhat.config.ts` now sets `chainType: "l1"` and `hardfork: "osaka"`. The
hardfork is stated explicitly rather than left to EDR's "latest stable", so a future EDR that
promotes Amsterdam cannot silently move the chain out from under a suite whose whole purpose is
executing the exact bytecode Sepolia will execute.

**Guard.** `confidential/test/09-osaka.ts` runs first and asserts `clz` answers and `verifyOsaka()`
returns true. A misconfigured node now fails in seconds instead of twenty minutes into a settlement
suite.

**This is the third way the local node differed from production**, after R-10 (unlimited contract
size) and R-12 (a clock that outruns wall clock). The pattern is the same every time: the local
environment is more permissive, so a hard production failure becomes a silent local success.

---

## S-2 · Osaka caps a single transaction at 2^24 gas, and the launch epoch exceeds it

**Severity: blocking for launch scale. NOT fixed — the remedy is Phase 5 work and is specified below.**

EIP-7825, introduced in Osaka, caps a single transaction at **16,777,216 gas** regardless of the
block gas limit. Measured on the correctly-configured local node, not cited:

| gas | outcome |
|---|---|
| block gas limit | 60,000,000 |
| 16,777,216 | ACCEPTED |
| 16,777,217 | REFUSED |
| 20,000,000 | REFUSED |

`confidential/test/09-osaka.ts` asserts both sides of that boundary.

**Note on an earlier reading of this delta.** The first assessment attributed the peak to stage D at
20,300,000 gas and concluded the fix required lowering four compiled constants and redeploying. The
recorded measurements say otherwise, and the corrected numbers are below: the peak is stage C at
18,193,386, it is the only stage over the cap, and its width is a universe parameter rather than a
constant — so the immediate fix needs no redeployment at all.

**What this invalidates.** Phase 3 sized every stage width against a "transaction gas ceiling" of
**24,000,000**, measured on the pre-Osaka OP node. That ceiling does not exist on any Osaka chain.
Measured against the recorded evidence in `evidence/phase3/stage-gas.json`, **exactly one stage
exceeds the cap**:

| stage | peak per transaction | vs the 16,777,216 cap |
|---|---|---|
| sealProvider | 1,446,304 | fits |
| prepareEpoch | 3,089,081 | fits |
| cacheProviderChunk | 14,984,397 | fits, 1,792,819 to spare |
| **accumulateLeafChunk** | **18,193,386** | **1,416,170 OVER** |
| finalizeLeafChunk | 14,139,942 | fits |
| reduceWinnerChunk | 11,069,738 | fits |
| allocateChunk | 8,439,036 | fits |
| publishWinner / proveWinner / publishAggregate | < 1M | fit |

So **the 16 × 128 launch-scale epoch cannot execute on the chain Kyrve targets** — but the margin is
one stage and 1.4M gas, not a structural problem. It surfaced the moment the node was configured
correctly: the full-scale benchmark now fails at `accumulateLeafChunk` with a bare out-of-gas, having
previously passed on a node with no cap.

**What this does NOT invalidate.** The four-cell epoch Phase 3 really executed on Sepolia
(`0xcf3e5c94…`) is far below the cap and is unaffected. Phase 4's own settlement path is nowhere near
it: activation and one exact `take` are ordinary transactions. Phase 3's docs already recorded that
no 16 × 128 epoch had ever run on Sepolia; what is new is that it *could not have*.

**The remedy, in two parts.**

*Immediate, and it needs NO redeployment.* Only stage C scales with `cellsPerChunk`, and that is a
**universe parameter** passed to `CurveUniverseRegistry.createUniverse` — not a compile-time
constant. At the measured 71,068 gas per cell, 236 cells is the largest chunk that fits; create
universes at **192** rather than 256 and stage C lands around 13.6M with headroom. Every other stage
width already fits. Nothing else changes except the transaction count, which is exactly the quantity
delta R-7 already says keeper timeouts must scale with.

*Durable, and it does need a redeployment.* `CurveUniverseRegistry.MAX_CELLS_PER_TRANSACTION` is a
compile-time constant of 256, so an over-wide universe can still be **created** today and will simply
fail mid-epoch. Lowering it makes the mistake unmakeable — and the curve layer already on Sepolia
carries the old value.

Then re-measure the benchmark and update `@kyrve/curve`'s `CURVE_STAGE_GAS`, which is asserted
against the recorded evidence.

**Guard.** `pnpm verify:gas-cap` reads the recorded measurements and fails while any exceeds the cap,
naming each one. It is wired into `verify:phase4` and is **expected to fail** until the remedy
lands. A green gate that hid this would be worth less than nothing.

---

## S-3 · The production ratifier could not be called `KyrveQuoteRatifier`

**Severity: cosmetic, but the reason is mechanical and worth recording.**

Phase 4's brief named `KyrveQuoteRatifier.sol`. Foundry writes artifacts to
`out/<source-file-basename>/<ContractName>.json`, so two source files sharing a basename collide —
and **collide silently**. Proven, not assumed: a probe contract was added at
`contracts/kyrve/KyrveQuoteRatifier.sol`, `forge build --force` reported "Compiler run successful!",
and the probe's artifact was simply absent, the Phase 1 artifact still in its place.

Phase 1's `contracts/integration/KyrveQuoteRatifier.sol` is **deployed on Sepolia** and its runtime
hash is pinned in `deployments/midnight-bytecode-lock.json`. Renaming or replacing it would make the
repository stop describing what is on chain, which is the one thing this repository must not do.

So the production ratifier is `KyrveSettlementRatifier`. The name is more precise anyway — it is the
settlement layer's ratifier, and the Phase 1 file is the exact-fill harness that its own docstring
already says it is.

---

## S-4 · `aggregateFill` is the reserved sum, and the settlement layer must never reconstruct it

**Severity: normative. Implemented.**

`NoxCurveEngine.publishAggregate` publishes the **sum of successfully reserved provider
allocations**, not the winning leaf's fillable capacity. Every pro-rata share is floored by
`safeDiv`, so the two differ by deterministic dust — up to one unit per provider. A leaf that could
carry 300,000,000 may reserve 299,999,999.

Binding consequences, all enforced in code rather than documented:

- `QuoteActivator` uses the published aggregate. The leaf capacity is never an input to it, so it
  cannot be reconstructed from one.
- `units = floor(aggregate * WAD / price)` and `buyerAssets = floor(units * price / WAD)`, both
  rounding DOWN, so `buyerAssets <= aggregate` — the maker never owes more than providers reserved
  (PRD invariant 19.2). The activator asserts that inequality even though it is structural.
- The public aggregate is never rounded back up.
- Vault funding, expected units, expected buyer assets and the exact-fill checks all derive from the
  same published aggregate, through one code path.
- The residue `aggregate - buyerAssets` is unreserved confidential capacity. It stays where it is and
  never becomes part of the offer.

The reference fixture uses those exact numbers: `contracts/kyrve/test/SettlementHarness.sol` sets
`LEAF_CAPACITY = 300_000_000` and `AGGREGATE_FILL = 299_999_999`, every size assertion derives from
the latter, and `test_aggregate_isNotTheLeafCapacity` plus
`packages/quote/test/binding.test.ts` both pin that sizing from the capacity produces a strictly
larger face value.

---

## S-5 · The activated offer must be recovered from an event, not from a simulation

**Severity: correctness. Implemented.**

`QuoteActivator.activate` returns the offer, and the obvious way to read a return value from a
state-changing function is to simulate it first. That is wrong here, and quietly:
`offer.start = block.timestamp`, so an offer read from a simulated block differs from the mined one
in exactly the field `offerHash` covers. A borrower handed the simulated offer would present
something no ratifier accepts, for a reason nothing on chain explains.

The registry deliberately stores only the hash — storing the offer would cost kilobytes of state for
a value nothing reads on the hot path. So the activator emits `OfferPublished(quoteId, abi.encode(offer))`
once, and any client recovers it, hashes it and compares against `QuoteExecution.offerHash` — the
same comparison the ratifier makes. `activateQuote` in the local harness does exactly that and
asserts it.

---

## S-6 · Phase 4 settles from public funding, and P4-2 is deliberately still open

**Severity: scope. Deliberate.**

Phase 3 prerequisite P4-2 says a reservation is not a lock: `ReservationLedger` reserves against a
snapshot of a provider's vault balance and cannot stop them withdrawing afterwards. Making a curve
allocation into a real capital lock needs either a vault revision with a handle-native entry point
or settlement funded from the ledger's own custody, and that is a decision with consequences in
both directions.

Phase 4 does not take it. `KyrveSeriesVault` holds **public** loan-token funding, accounted per
quote through `committedFunding`, and mints no confidential series ownership. That is stated in the
vault's own file comment, in its funding accounting, and here — rather than folded into a settlement
commit where it would be discovered later by someone reading the code.

What Phase 4 does supply is the machinery that decision will need: a vault that cannot spend
committed capital, recovery bounded by `balance - committedFunding`, and a factory guarantee that
the maker's `onBuy` is always Kyrve's code.

---

## S-7 · `95-proof-expiry` was decided by one second

**Severity: flaky test. Fixed.**

The test advanced the chain by 3,601 seconds against NoxCompute's 3,600-second proof window. The
gateway stamps `createdAt` when it finishes encrypting, and a mandate is 35 separate handles — so on
a loaded machine `createdAt` lands a second or more after the timestamp the test measured from, the
margin goes negative, and the proof is not expired.

It passed early in a session and failed later in the same session, on the same commit, with no code
change. A security test whose outcome depends on machine load resolves to "passes on my machine".
The window is now 4,200 seconds; the property under test is unchanged.

---

## Carried forward, still binding

Everything in `docs/phase3/PHASE-4-PREREQUISITES.md` remains in force. Two are discharged by this
phase:

- **P4-1** — the graph binding is real and used. `KyrvePublicResultVerifier` binds through
  `CurveGraphRegistry` with the sealed form, re-reads the published handle set from the engine at
  call time, and checks every one of the five against the handle the graph registered for its role
  before any proof reaches a gateway. Delta R-14 is closed on chain and off it, with the regression
  in the shape the failure actually took.
- **P4-3** — the local node is now configured to match production on the axis that mattered
  (S-1), and the two axes that led to a *worse* local environment now both have measurements
  (`verify:contract-size` for R-10, `verify:gas-cap` for S-2).

**P4-2 is not discharged** and S-6 says so explicitly.
