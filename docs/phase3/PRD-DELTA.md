# Phase 3 PRD delta

Corrections found while building the confidential curve engine.

`hack.md` and `kyrve-production-prd.md` are **never edited**; `kyrve-production-prd-v1.1.md` is the
Day 0 normative amendment. This file records what Phase 3 found on top of both, and on top of
[`docs/day0/PRD-DELTA.md`](../day0/PRD-DELTA.md), [`docs/phase1/PRD-DELTA.md`](../phase1/PRD-DELTA.md)
and [`docs/phase2/PRD-DELTA.md`](../phase2/PRD-DELTA.md).

Grading matches every previous phase:

- **CONFIRMED** — the document was right, and it is now proven rather than assumed.
- **GAP** — silent on something load-bearing. Additive.
- **CORRECTION** — states something that verification contradicts. Must change.
- **RISK** — unresolved, with a required action.

Every finding below is backed by executable output. **Ten of the fourteen were found by running
something rather than by reading it**, and five of those only surfaced on a real network or at full
scale — which is the pattern worth noticing more than any individual entry.

---

## R-1 · §11.10 / §13.3 — the vault's reservation entry point cannot accept a curve allocation · CORRECTION

*Source proof: `KyrveConfidentialAssetVault.openReservation`, deployed and verified on Sepolia.*

The PRD assumes the curve engine reserves through the vault. The deployed entry point is

```solidity
function openReservation(bytes32 id, address provider, externalEuint256 amount, bytes calldata inputProof)
```

`externalEuint256` plus a 137-byte gateway proof means **the reserver must know the amount in
plaintext to have it encrypted**. That is exactly what a confidential curve engine makes impossible:
an allocation exists only as a handle, and no proof can be minted for a value nobody knows.

The two constraints are mutually exclusive, and the vault is deployed, verified and immutable.

**Applied as:** `ReservationLedger` is the handle-native counterpart. It takes an `euint256` the
engine computed and performs the same `safeSub → select → select` shape the vault uses.

**The limit is stated in the contract rather than in a footnote.** The ledger reserves against a
SNAPSHOT of the provider's vault balance. It does not custody capital and cannot stop a provider
withdrawing from the vault after the snapshot was taken. Making a reservation move real vault
capital needs the vault to gain a handle-native entry point — a change to a deployed contract's
trust model, which belongs with `QuoteActivator` in Phase 4, where a reservation first becomes a
payment obligation. Phase 3 proves the arithmetic, the conservation and the release. It does not
claim the capital is locked.

---

## R-2 · §11.13 — the engine cannot read a mandate without the provider's own grant · GAP

*Source proof: `modules/ACL.sol::allow`, gated `onlyAllowed(handle)`. Executable proof:
`confidential/test/81-curve-attacks.ts`, case 15c.*

The Phase 2 books grant exactly two things per handle: `allowThis` to the book, and
`allow(handle, owner)` to the owner. Neither reaches the curve engine, and all three Phase 2
contracts are deployed and immutable — they cannot be taught about a contract that did not exist
when they were written.

`INoxCompute.allow` is `external` and gated on the caller already holding access, so **the owner —
and only the owner — can extend it**. Kyrve takes that route rather than having the provider
re-encrypt their mandate into the engine, because a re-encrypted snapshot is the provider's
*restatement* and nothing on chain can prove it equals the mandate the book holds; Nox cannot
compare two ciphertexts without decrypting one. A restatement would make demonstration 15 — a stale
mandate cannot participate — a check on a number the attacker supplies.

**The honest cost, which the PRD does not mention:**

- **35 transactions per provider per mandate epoch**, plus 19 for a borrower and 1 for a vault
  balance. `INoxCompute@0.2.4` has no batch entry point.
- The grant is **permanent**. There is no `removeAdmin`.
- It makes the engine an **admin**, so it *could* call `allowPublicDecryption` on a provider's
  mandate. It does not — the only call site is one private helper reachable from two stages, for
  five handles — but that is a property of reviewed code, not of the ACL, and the interface must
  say so in those words.

**Action:** state the grant as a normative part of provider onboarding, with its cost and its
permanence, rather than implying the engine can read a mandate because it is "the protocol".

---

## R-3 · `OPERATION-BUDGET.md` §2–§5 — every stage costs more than Day 0 measured · CORRECTION

*Executable proof: `confidential/test/82-curve-benchmark.ts`. Raw data:
[`evidence/phase3/stage-gas.json`](../../evidence/phase3/stage-gas.json).*

Day 0 summed isolated Nox primitives. The contract additionally pays for storage, external calls,
calldata and the graph commitment. Measured against the real stack at 16 × 128:

| Stage | Day 0 | Measured | Note |
|---|---:|---:|---|
| accumulate, per cell | 76,402 | **71,068** | after the leaf-major restructure below; **128,914** before it |
| cache, per unit | 256,553 *per provider* | **468,262** *per (provider, market)* | different unit AND different cost |
| finalize, per leaf | 158,847 | **294,974** | |
| reduce, per leaf | 94,649 | **345,739** | the fold carries six values, not three |
| allocate, per provider | 166,423 | **527,440** | includes the ledger's reservation |

**Two independent errors, not one.**

*The unit was wrong.* §2 says the cached predicates are evaluated "once per provider (16 times)".
`enabled`, the market cap and the portfolio caps all vary by MARKET, and a leaf carries a market, so
the correct unit is (provider, market) — 128 units at 16 × 8, not 16. That was measured on a
single-market spike where the two coincide.

*The cost was wrong.* Summing primitives omits everything the contract does around them.

**A third finding came out of fixing the second.** The first full run peaked at **33,001,967 gas** in
one accumulate chunk — above a whole block, not merely above the 24M ceiling — because stage C paid
three per-LEAF costs once per CELL: a `toEuint16` of the leaf's public rate index, two `allowThis`
calls persisting an accumulator about to be overwritten by the next provider in the same
transaction, and two SSTOREs of an intermediate nobody would read. Restructuring the loop leaf-major
took the cell from 128,914 to 71,068 — **below the Day 0 figure** — and stage C from 264M to 148M.

**The Day 0 conclusion survives.** The full 16 × 128 universe executes in **22 transactions**,
**297,216,601 gas**, peak **18,193,386** against a 24M ceiling. Day 0 predicted 18 transactions and
~197M. The schedule grew; nothing was deferred and no parameter was reduced.

**Applied as:** `@kyrve/curve`'s `CURVE_STAGE_GAS` and every chunk width are the measured values,
`confidential/contracts/CurveConstants.sol` mirrors them, a test parses the Solidity to prove the two
agree, and `verify:curve` reads them back from the deployed contracts. Three sources have to concur.

---

## R-4 · v1.1 A-11 — `expectedAggregateHandle` could never equal a real handle · CORRECTION

*Source proof: `modules/Compute.sol::_generateHandle`. Executable proof:
`confidential/test/84-curve-public-surface.ts`, last case.*

Phase 1 shipped, and documented as "the handle this request's published aggregate MUST be":

```ts
keccak256(abi.encode(root, stage, outputIndex))
```

NoxCompute derives a handle from the operator, the operand handles in order, its own address, a
uniqueness seed and the output index, then packs a version, chain id, TEE type and attribute byte
into the top seven bytes. The Phase 1 formula shares **none** of those inputs. It could never equal a
real handle, so any check comparing a live proof's handle against it would have failed for every
honest quote — or, far more likely, would have been relaxed until it passed and stopped checking
anything.

Nothing caught it because Phase 1 had no live gateway to compare against.

**Applied as:** `packages/nox/src/handle-derivation.ts` implements the real derivation and is
**verified against handles a live NoxCompute returned** — both a plain `add` of two gateway input
handles and the isolation `select` every published result goes through. The Phase 1 function is
renamed `stageOutputCommitment`, which is what it actually is: a commitment to a stage output's
ordered position, still worth folding into the graph root.

The new derivation **refuses** the case it cannot compute. When every operand is public, NoxCompute
seeds the handle from a storage counter, so the result is unpredictable off chain;
`AllPublicOperandsError` says so instead of returning a plausible wrong answer, and
`KyrveCurveBase._requireConfidential` enforces the same property from the contract side.

---

## R-5 · v1.1 A-11 — a decryption proof's plaintext is not ABI-encoded · CORRECTION

*Measured against `nox-handle-gateway` 0.6.0. Executable proof: the Sepolia and local suites.*

`validateDecryptionProof` returns `decryptionProof[65:]` — the bytes after the gateway signature —
and the gateway encodes the plaintext at its **natural width**. A published `euint16` comes back as
**two bytes**, not thirty-two.

`abi.decode(raw, (uint256))` reverts outright on a two-byte input, **with no reason string**. That is
how it was found: several transactions into a real epoch, as an unexplained revert.

This is the second time an undocumented gateway response shape has cost a debugging session; Q-3
recorded the first, for the readiness endpoint. The pattern is worth stating: **the gateway's wire
formats are measured, not specified.**

**Applied as:** `DecryptedValue.toUint` reads 1..32 bytes big-endian and refuses an empty or
over-wide payload rather than coercing a malformed proof into a confident number.

---

## R-6 · §11.13 — the obvious ACL-aliasing test passes with the defence removed · GAP

*Executable proof: `confidential/contracts/test/IsolationProbe.sol`,
`confidential/test/81-curve-attacks.ts` cases 17a–17c.*

The natural test for Q-5 is: give two providers identical mandates and identical balances, then
assert their allocations are equal in value but distinct as handles.

**It passes with the isolation primitive removed entirely.** Their mandate handles come from separate
`encryptInput` calls, and gateway input handles are distinct per encryption, so every intermediate
differs anyway. The test proves nothing about the defence it is named for.

**Applied as:** `IsolationProbe` removes the confound by feeding the SAME two operand handles into
both branches, so the naive results genuinely collide and only the domain separates them. It asserts
three things at once: the collision hazard is still live, isolation separates equal values, and
isolation is **deterministic** — which is what lets a published handle be predicted off chain at all.
The end-to-end case is kept, relabelled for what it actually shows.

**Action:** treat "the test passes" as insufficient for any Q-5-adjacent claim unless the fixture
makes the hazard reachable. Value equality is not lineage equality, and neither is convenient
coincidence.

---

## R-7 · AS-1 / AS-4 — the off-chain runner falls minutes behind at launch scale · GAP

*Measured: `confidential/test/82-curve-benchmark.ts`.*

A 16 × 128 epoch issues roughly fifteen thousand Nox operations. The runner processes them
asynchronously with no callback into the contract, so readiness is discoverable only by polling —
and at that volume it falls **minutes** behind the chain. The suite's ordinary 30-second policy gives
up long before the first published handle is computable.

This is not a Kyrve latency and not a defect. It is the honest throughput of the stack at launch
scale, and it is the number a keeper's timeout has to be sized against.

**Action:** state a per-epoch readiness budget in §21 that scales with operation count rather than a
single constant, and size the Cloudflare Workflow step timeout from it. The 15-minute wall clock is
still comfortable; the 5-second per-stage figure in `OPERATION-BUDGET.md` §4 is a per-STAGE number
and must not be read as a per-epoch one.

---

## R-8 · §11.9 — an uninitialised ERC-7984 balance is a PUBLIC revert · CORRECTION

*Source proof: `ERC7984ZeroBalance`. Measured on Sepolia, transaction reverted.*

`KyrveConfidentialAssetVault.withdraw` is documented — correctly — as branch-free over amounts: a
withdrawal larger than the balance moves encrypted zero and succeeds, so a shortfall is not a public
oracle.

That holds for amounts. It does **not** hold for an account whose confidential balance was never
initialised at all: the official ERC-7984 implementation reverts `ERC7984ZeroBalance` rather than
moving encrypted zero. Found by trying to use `withdraw` as the cheapest Sepolia smoke test, against
a vault nothing had ever been wrapped into. Phase 2's local suite never met that state because its
vault always held something.

**What it does and does not disclose.** It separates "never had a balance" from "has a balance,
possibly too small". The second is the private fact the product protects and it stays protected. The
first is close to public already — the wrap that would create a balance is a public ERC-20 transfer.
So this is a boundary that is narrower than the documentation implies rather than a leak of the
thing that matters.

**Action:** state §11.9's guarantee as *branch-free over amounts, for an initialised balance*, and
have any interface that offers withdrawal from an empty vault name the public revert before signing.

---

## R-9 · v1.1 A-15 — the gateway's authorisation view lags the chain · CORRECTION

*Measured on Sepolia: `NoxCompute.isAllowed(handle, owner)` returned `true` while the hosted gateway
answered `403 access_denied: not a viewer` for the same handle and the same account.*

The gateway authorises from its own indexed view of ACL state, which is eventually consistent with
the chain. Neither the SDK nor the documentation says so, and the refusal is indistinguishable in
shape from a genuine "you may not read this".

**Applied as:** `@kyrve/nox` treats the **chain as authoritative**. A refusal the chain agrees with
is final and fails fast — that is the confidentiality model working, and every unauthorised-read test
depends on it. A refusal the chain contradicts can only be lag, and is retried with backoff until the
caller's own timeout.

**Why the rule is safe:** it can only ever turn a refusal into a retry for an account the chain
already says is authorised. It can never grant access, and it never weakens a real refusal.

---

## R-10 · §3.1 — the local node cannot enforce EIP-170, and hid a contract that broke it · CORRECTION

*Measured: Sepolia refused `NoxCurveEngine` with `CreateContractSizeLimit` at 25,040 bytes.*

The engine was 464 bytes over the 24,576-byte limit. **The entire suite ran green against it** —
every demonstration, the whole attack suite, the full 16 × 128 benchmark — because the Nox Hardhat
plugin sets `allowUnlimitedContractSize: true` on the node it starts.

Setting it to `false` was tried and reverted: the node then cannot deploy **NoxCompute itself**, which
is over the limit and is precisely why the plugin relaxes it. **So the local node cannot be made to
enforce EIP-170 on Kyrve's contracts without breaking the stack they are tested against.** The check
has to live outside it.

This is the most uncomfortable finding of the phase, and the general form is worth more than the
instance: **a local environment more permissive than production turns a hard failure into a silent
one, and only a check that measures will find it.**

**Applied as:** `verify:contract-size` measures every compiled artifact; `verify:curve` measures the
code the **chain** returned, so an artifact-only check cannot pass for something no real chain would
accept. Both are in the Phase 3 gate.

**The fix itself has two parts, neither disturbing what is already deployed.** A per-file compiler
override puts `NoxCurveEngine` at `optimizer.runs: 1` — the right trade for a contract deployed once
whose hot loop is dominated by external calls into NoxCompute — while the five Phase 2 contracts keep
`runs: 200` and stay byte-identical to their deployed, verified bytecode. And `snapshotOf` and
`leafTableOf` were deleted: both re-exposed data the mandate book and universe registry already
publish, and their ABI encoders cost about 900 bytes. Final size **23,633 bytes, 943 to spare**.

---

## R-11 · §31 — `verify:source-lock` pointed at a file nobody had written · CORRECTION

*Reproduce: `git log -S "verify:source-lock" -- package.json`, then run it.*

`package.json` has carried `verify:source-lock` since Day 0 pointing at
`scripts/verify/source-lock.ts`. **The file was never written.** Running the script produced
`ERR_MODULE_NOT_FOUND`, and nothing noticed because neither the Phase 1 nor the Phase 2 gate invoked
it.

A verification command that has never run is worse than a missing one: it sits in the script list,
it reads as coverage, and it proves nothing.

**Applied as:** written, and invoked by the Phase 3 gate. It compares the four Nox packages, viem,
wrangler, the Midnight submodule commit, the NoxCompute address and the package manager against
`source-lock.json`, and deliberately does **not** re-retrieve any of them — replacing a dated,
reproducible, recorded fact with whatever the network says today is the opposite of a lock.

**It also surfaced two of its own false alarms before it was trusted**, and both are recorded because
a lock check that cries wolf is a lock check that gets disabled: an unanchored pattern made `viem`
match `hardhat-toolbox-viem`, and anchoring it then reported every scoped package as absent because
pnpm quotes scoped keys. Separately, `verify:toolchain` was rejecting `workspace:*` as an inexact pin
— the workspace protocol resolves to a package in this repository and has nothing to drift.

---

## R-12 · testing — a long local suite outruns the gateway's proof expiry · GAP

*Measured: the last two test files failed `Proof expired` on a full-suite run, and only there.*

A Hardhat node advances `block.timestamp` by at least a second per mined block, and this suite mines
thousands — the 16 × 128 benchmark alone is roughly 700 transactions, because `INoxCompute` has no
batch entry point and each of sixteen providers needs 36 separate ACL grants. Once the chain clock is
more than 3,600 seconds ahead of wall clock, **every** gateway proof looks expired to
`validateInputProof`, which compares a `createdAt` stamped from the gateway's real clock against
`block.timestamp`.

It appeared only in the later files, only on a full run, and only after the benchmark was added,
which is why running those files alone kept passing — the most expensive kind of intermittent
failure to diagnose.

**Applied as:** `allowBlocksWithSameTimestamp: true` on the plugin's node, which keeps the chain clock
aligned with the gateway's — the condition the 3,600-second expiry was designed around.

**It is an artefact of on-demand mining, not a product defect.** On any real chain block time tracks
wall clock, and the Sepolia smoke test round-tripped nineteen proofs without going near it.

---

## R-13 · §31 — `scripts/` is not typechecked by `tsc --build` · CORRECTION

*Reproduce: `grep -c scripts tsconfig.json` → 0, then `pnpm exec tsc -p scripts/tsconfig.json --noEmit`.*

The root `tsconfig.json` is a solution file referencing `packages/*` only. `scripts/` has its own
`tsconfig.json` but is in no project reference, so `pnpm exec tsc --build` — which the Phase 3 gate
reports as "tsc --build clean across all project references" — **never typechecked a single line of
it**.

That is the entire deployment, verification and gate tree.

Found by accident: a genuinely broken script, with a dozen scope errors after a bad refactor,
passed `tsc --build` and then failed at runtime under `tsx`, which strips types without checking
them. Running the scripts project directly found the errors immediately — and found **none
anywhere else**, so nothing had drifted into the gap. That is luck rather than design.

**Applied as:** `pnpm typecheck:scripts`, wired into the Phase 3 gate in the same commit. The gate
description now distinguishes the two, because "TypeScript build across every package" was a true
statement that read as a stronger one.

---

## R-14 · v1.1 A-15 — an undefined handle reaches the gateway as `chain_id 0` · GAP

*Measured on Sepolia: `{"error":"unknown_chain","message":"chain_id 0 not configured"}`.*

A handle embeds its chain id in bytes 1–4. The undefined handle is `bytes32(0)`, so those bytes are
zero — and the gateway rejects it as an **unconfigured chain** rather than as an empty handle.

The message names neither the handle nor the real problem, and it arrives from a component that is
otherwise working perfectly. In this case the cause was a stale read: `publishedOf` was fetched once
before stage F and reused afterwards, so four of the five handles were already set by
`publishWinner` and decrypted correctly, and only `aggregateFillAmount` was still undefined. **The
bug read the right answer four times out of five**, which is the hardest kind to see.

**Action:** treat `unknown_chain` from the handle gateway as "you passed an undefined or malformed
handle" and say so, rather than surfacing the gateway's wording. Any code path that reads a handle
set which is populated across several transactions must re-read after the last of them — noted in
`PHASE-4-PREREQUISITES.md`, because `QuoteActivator` reads exactly such a set.

---

## Residuals carried forward

| Item | Status after Phase 3 |
|---|---|
| Testnet Nox latency and gas (AS-1) | **DISCHARGED for a nineteen-handle round trip.** 813 ms per handle to encrypt, 2,302,299 gas to submit, 2,696 ms to decrypt, on the hosted stack. Throughput for a full epoch on testnet is still unmeasured — see R-7. |
| Gas indistinguishability (V-24 / T-1) | **RE-MEASURED against the curve engine.** Noise floor 12 gas, ranges overlap entirely, no separation. The claim still must not be made. |
| Storage under realistic load (AS-4) | **STILL UNVERIFIED**, and R-7 adds a throughput dimension to it. |
| Concurrent epochs (AS-5) | **STILL UNVERIFIED.** The controller makes epochs independent by construction, but nothing has run two at once. |
| Morpho BUSL Additional Use Grant (AS-10) | **STILL EMPTY.** External, non-technical, unchanged. |
| 24M gas ceiling on live Sepolia (AS-11) | **FURTHER DISCHARGED.** 11,585,791 gas of Phase 3 deployment landed across six transactions plus three bindings. The largest single curve transaction measured anywhere is 18,193,386 gas, locally. |
| A real curve epoch on Sepolia | **RUN AND VERIFIED.** Epoch `0xcf3e5c94…`, 2 providers, 1 market, 2 leaves. Every published value matched the plaintext reference model exactly. Measured cost **0.0299 ETH**, against a 0.0236 prediction — the local-gas estimate understated a public network by 27%. |
