# Handle lineage — the P3-1 proof

`docs/phase2/PHASE-3-PREREQUISITES.md` P3-1 forbids writing a single accumulator before this file
exists. It is the enumeration it demands, plus the primitive that discharges it.

Read `docs/phase2/PRD-DELTA.md` Q-5 first. The short version: **a Nox handle is a pure function of
the operator, the operand handles in order, the output index and a seed.** Two logically distinct
encrypted quantities computed the same way from the same inputs are one handle sharing one
**permanent** ACL entry, and `allow` has no inverse.

The curve engine accumulates across 16 providers and 128 leaves. Coincidence is not a corner case
here — it is the common case. Every empty leaf, every disabled market and every zeroed accumulator
before its first contribution coincides with its neighbours.

---

## 1 · The seed rule, read from source

`modules/Compute.sol::_generateHandleUniqueSeed` (nox-protocol-contracts 0.2.4):

```solidity
for (uint256 i = 0; i < operands.length; i++) {
    if (!HandleUtils.isPublicHandle(operands[i])) {
        return 0;                       // ANY confidential operand -> fully deterministic
    }
}
return ++$.uniqueSeedCounter;           // ALL operands public -> unique per call
```

and `_generateHandle`:

```solidity
result = keccak256(abi.encode(operator, operands, address(this), uniqueSeed, outputIndex));
```

Two consequences that shape every design decision below, and that Q-5 did not state because Phase 2
never needed them:

| Case | Seed | Handle |
|---|---|---|
| at least one confidential operand | `0` | **deterministic** in `(operator, operands, outputIndex)` |
| every operand public | storage counter | **unique per call, and unpredictable off chain** |

The first case is the collision hazard. The second is a *different* hazard: an all-public operation
cannot be reproduced off chain, so it can never appear on a path whose handle must be precomputed —
which is every published result handle. `CurveGraphRegistry` is where those are committed.

`HandleUtils.isPublicHandle(h)` is `(h[6] & 0x01) == 0`. Every `_executeOperation` output sets that
bit; `wrapAsPublicHandle` — which is what `Nox.toEuint16/toEuint256/toEbool` compile to — clears it.

---

## 2 · Every stored encrypted quantity, with its lineage

`P` = provider index (≤ 16), `M` = market index (≤ 8), `L` = leaf index (≤ 128), `p`/`m`/`l` their
values. `⊥` means the engine grants nothing beyond `allowThis`.

### 2.1 Sealed inputs — created elsewhere, never by the engine

| Quantity | Origin | ACL |
|---|---|---|
| `mandate[p].*` — 35 handles | `EncryptedMandateBook`, gateway input proof | mandate book, provider, **and the engine after the provider's own explicit grant** |
| `request.*` — 19 handles | `ConfidentialRequestBook`, gateway input proof | request book, borrower, and the engine likewise |
| `balance[p]` | `KyrveConfidentialAssetVault._available[p]` | vault, provider, and the engine likewise |

The engine never mints these and never re-encrypts them. It reads the **real** handles the Phase 2
books already hold. See §5 for why that is a grant the provider makes, not one Kyrve can make for
them, and what it costs.

### 2.2 Engine-created quantities

| # | Quantity | Cardinality | Lineage | Granted |
|---|---|---|---|---|
| 1 | `capBase[p][m]` | 128 | 4 × `select(le(a,b), a, b)` over four caps | ⊥ |
| 2 | `allSix[p][m]` | 128 | `eq(mul16-chain of five indicators, one16)` | ⊥ |
| 3 | `cachedCapacity[p][m]` | 128 | `select(allSix, capBase, zero256)` | ⊥ |
| 4 | `cachedCount[p][m]` | 128 | `select(allSix, one16, zero16)` | ⊥ |
| 5 | `capacityAcc[l]` | 128 | left fold of `add(acc, select(rateOk, cachedCapacity, zero256))` | ⊥ |
| 6 | `countAcc[l]` | 128 | left fold of `add16(acc, select(rateOk, cachedCount, zero16))` | ⊥ |
| 7 | `floorPassed16[l]` | 128 | `select(ge(countAcc, floorHandle), one16, zero16)` | ⊥ |
| 8 | `fillable[l]` | 128 | `select` chain through borrower rate, floor, desired, minimum | ⊥ |
| 9 | `best*` — score, market, rate, fill, floor | 5 | `select` fold over leaves | ⊥ |
| 10 | `allocation[p]` | 16 | `safeMul → safeDiv → select → select`, **then isolated** | `allow(p)` |
| 11 | `remaining[p]` | 16 | `select(ok, safeSub(remaining, alloc), remaining)`, **then isolated** | `allow(p)` |
| 12 | `reserved[p]` | 16 | `select(ok, alloc, zero256)`, **then isolated** | `allow(p)` |
| 13 | five published results | 5 | see §4, **then isolated** | `allowPublicDecryption` |

### 2.3 Which pairs can coincide, and what follows

Rows 1–9 are all `⊥`. They collide constantly and it is harmless, because **a handle nobody was
granted leaks nothing when it equals another handle nobody was granted**. Concretely and by design:

- every leaf on a disabled market has `capacityAcc[l] = add(zero256, zero256) = …` — identical across
  all of them;
- two providers with byte-identical mandates produce identical `cachedCapacity` and `cachedCount`;
- `countAcc[l]` for any two leaves with the same eligible provider set is one handle.

None of that is a defect. The rule is not *avoid collisions*; the rule is **never grant a user or the
public a handle that something else could equal.**

Rows 10–13 are the granted ones, and every one of them is isolated first.

---

## 3 · The isolation primitive

```solidity
// Once per epoch. `anchor` is the borrower's `desiredAssets`, which the engine has just proved it
// holds an ACL grant on.
function _buildEpochCondition(bytes32 epochId, euint256 anchor) internal returns (ebool) {
    _requireConfidential(euint256.unwrap(anchor));
    euint256 salt = Nox.add(anchor, Nox.toEuint256(uint256(isolationDomain(epochId, ROLE_EPOCH_SALT, 0))));
    return Nox.eq(salt, salt);            // encrypted TRUE, and unique to this epoch
}

// Per granted handle.
function _isolate(euint256 value, ebool epochCondition, bytes32 domain) internal returns (euint256) {
    _requireConfidential(euint256.unwrap(value));
    return Nox.select(epochCondition, value, Nox.toEuint256(uint256(domain)));
}
```

with

```
domain = keccak256(abi.encode(chainId, engine, epochId, role, subIndex))
```

**Why it works.** `select`'s operands are `[epochCondition, value, tag]`. The condition is
confidential, so the seed is `0` and the output handle is deterministic in the three operands. Two
granted quantities can share a handle only if they share all three — and distinctness holds on two
independent axes: the **condition** separates epochs, the **tag** separates roles and subjects.

**Two provider allocations that are numerically identical are still two handles with two ACL
entries.** That is the whole point.

**Why the value is unchanged.** The condition is `eq(salt, salt)`, encrypted `true` for every value,
so `select` returns `value` and `tag` is never taken. The tag's plaintext is a domain hash with no
relation to anything private, and it is only ever the untaken branch.

### Why an epoch condition, and not simply `eq(value, value)`

The obvious primitive is `select(eq(v, v), v, tag)`, which needs no per-epoch setup. It was the first
design here and it is **wrong for `euint16`**.

A `euint256` tag carries the full 256-bit domain hash. A `euint16` tag cannot: it truncates to
sixteen bits, so two epochs' `quoteReady` handles could coincide, and a decryption proof issued for
one epoch would then bind to the other. Both values are public either way, so nothing leaks — but the
graph binding would be weaker than it claims, which is the kind of gap this project treats as a
defect rather than a technicality. `packages/nox/test/handle-derivation.test.ts` demonstrates the
collision deliberately, so the reason this design exists is executable rather than asserted.

Threading a per-epoch condition also makes the seed deterministic regardless of the value's own
attributes, which is what keeps the published handle predictable off chain.

### Why `_requireConfidential` is not decoration

A public handle bypasses **every** ACL gate in NoxCompute — `HandleUtils.isPublicHandle`'s own
security note says so in those words — and an all-public operand set makes the output depend on a
storage counter, so the handle becomes unpredictable off chain and the graph binding silently stops
being checkable. Reaching that state means a stage ran out of order or an unset slot was read, both
public scheduling faults, so a public revert is the correct signal and discloses nothing.

This caught a real bug. The winner fold seeded its market and rate carries with `Nox.toEuint16(k)`,
which is `wrapAsPublicHandle` — a public handle with no ACL. `allowThis` reverts on those, so a
single-leaf universe would have failed at stage E2 with an opaque error while every multi-leaf
universe passed. The seed now goes through a `select` as well.

### Cost

`_buildEpochCondition` is 6,256 + 10,377 + 10,398 = **27,031 gas, once per epoch**. `_isolate` is
`toEuint256` + `select256` = **21,519 gas** per granted handle, or 19,556 for the `euint16` form.
Paid 16 times for allocations, 16 for remaining, 16 for reserved and 5 for published results — never
per cell.

---

## 4 · The five published handles

Nothing else ever reaches `allowPublicDecryption`, which is **irreversible**.

| Role | Type | Stage | Domain role string |
|---|---|---|---|
| selected market index | `euint16` | E2 `publishWinner` | `"selectedMarketIndex"` |
| selected rate index | `euint16` | E2 | `"selectedRateIndex"` |
| privacy-floor passed | `euint16` 0/1 | E2 | `"privacyFloorPassed"` |
| quote ready | `euint16` 0/1 | E2 | `"quoteReady"` |
| aggregate fill amount | `euint256` | G `publishAggregate` | `"aggregateFillAmount"` |

Booleans are published as `euint16` 0/1 rather than `ebool` so that isolation, publication and
off-chain handle derivation all use one code path with one set of tests, and so that a published
boolean cannot be confused with the internal `ebool` predicates it was derived from.

### What is never published, and where the engine would have had to go out of its way to publish it

Losing leaf capacities (row 5), the exact provider count (row 6), provider inclusion (rows 3–4),
provider allocations (row 10), the borrower's maximum rate and the providers' minimum rates (§2.1),
and the second-best leaf (row 9 holds only the running best, so the runner-up is never even
materialised). The engine has exactly one call to `allowPublicDecryption`, in one private helper,
reachable from exactly two stages.

### Why the aggregate is published after allocation, not with the winner

`aggregateFillAmount` is the **sum of the reservations that were actually taken**, not the winning
leaf's fillable capacity. Publishing the fillable capacity would publish a number that the
reservations then fail to match, because `safeDiv` floors every pro-rata share. Publishing the sum
instead makes "reservations sum to the public aggregate" true by construction rather than by luck,
and leaves the residue as an explicit, bounded dust term — see `docs/phase3/SELECTION-POLICY.md`.

---

## 5 · The grant the engine cannot make for itself

The Phase 2 books grant exactly two things per handle: `allowThis` to the book, and `allow(handle,
owner)` to the owner. Neither reaches the curve engine, and neither book can be changed — both are
deployed, verified and immutable.

`INoxCompute.allow(handle, account)` is `external` and gated `onlyAllowed(handle)`, so **the owner —
and only the owner — can extend access to the engine**, from their own wallet, one handle at a time.
There is no batch entry point.

Kyrve takes that route rather than having the provider re-encrypt their mandate into the engine,
because a re-encrypted snapshot is the provider's *restatement* of their mandate and nothing on chain
can prove it equals the mandate the book holds. Nox cannot compare two ciphertexts for equality
without decrypting one. A restatement would make demonstration 15 — a stale mandate cannot
participate — a check on a number the attacker supplies.

**The honest cost, stated rather than buried:**

- It is **35 transactions per provider per mandate epoch**, plus 19 for a borrower and 1 for a vault
  balance. There is no `allowBatch` in `INoxCompute@0.2.4`.
- The grant is **permanent and irreversible**. There is no `removeAdmin`.
- It makes the engine an **admin** on those handles, so the engine *could* call
  `allowPublicDecryption` on a provider's mandate. It does not: the only call site is the private
  `_publish` helper, and it is reachable only from `publishWinner` and `publishAggregate`, only for
  the five handles above. That is a property of reviewed code, not of the ACL, and the UI must say so
  in those words.
- Replacing a mandate mints new handles, so the grants must be made again. `activeEpoch` moving
  forward is what makes the old grants inert, not their removal — they cannot be removed.

Recorded as delta [R-2](PRD-DELTA.md).

---

## 6 · How this stays falsifiable

Reasoning about lineages is what produced the Phase 2 leak in the first place; the test caught it.
So each claim above has an executable counterpart:

| Claim | Test |
|---|---|
| identical operands produce one handle | `confidential/test/10-confidential-asset.ts`, Q-5 case (Phase 2, still runs) |
| isolation changes the handle and not the value | `confidential/test/81-curve-attacks.ts` 17b, via `IsolationProbe` |
| two numerically equal allocations are two handles with two ACL entries | `81` 17c — and see delta R-6, because the obvious form of this test passes with the isolation removed |
| a provider is not an admin of another provider's allocation | `81` 17c, on-chain `isAllowed` |
| nothing but the five results is publicly decryptable | `84-curve-public-surface.ts`, exhaustive over every handle the epoch produced |
| the off-chain derivation reproduces a real handle | `84-curve-public-surface.ts`, against handles a live NoxCompute returned — and it was WRONG until this ran, delta R-4 |

The last row is the one that would be easiest to fake and hardest to notice: it compares a handle
computed from the source formula against a handle a live NoxCompute actually returned. If the
derivation is wrong, the graph binding is decorative.
