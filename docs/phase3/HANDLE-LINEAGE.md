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
which is every published result handle (`docs/phase3/GRAPH-BINDING.md`).

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
function _isolate(euint256 value, bytes32 domain) private returns (euint256) {
    _requireConfidential(euint256.unwrap(value));
    euint256 tag = Nox.toEuint256(uint256(domain));   // public handle, distinct per domain
    ebool always  = Nox.eq(value, value);             // deterministic; always encrypted true
    return Nox.select(always, value, tag);            // value unchanged; handle domain-separated
}
```

**Why it works.** `select`'s operands are `[always, value, tag]`. `always` and `value` are
confidential, so the seed is `0` and the output handle is `keccak256(abi.encode(Select, [always,
value, tag], nox, 0, 0))` truncated and tagged. Two granted quantities can only share a handle if
they share all three operands — and `tag` is `toEuint256(domain)`, a deterministic function of a
domain string that includes the role and the subject:

```
domain = keccak256(abi.encode(chainId, engine, universeId, requestId, epoch, role, subIndex))
```

Distinct role ⇒ distinct `tag` ⇒ distinct handle. Distinct provider ⇒ distinct `subIndex` ⇒ distinct
handle. **Two provider allocations that are numerically identical are still two handles with two ACL
entries.** That is the whole point, and it is what demonstration 17 asserts.

**Why the value is unchanged.** `always` is `eq(value, value)`, encrypted `true` for every value
including zero, so `select` returns `value`. `tag` is never taken. Its plaintext is a public hash
with no relation to anything private, and it is only ever the untaken branch.

**Why `_requireConfidential` is not decoration.** If `value` were a public handle — an unset slot, or
a `toEuint256` constant — then `eq(value, value)` would have two public operands, the seed would come
from the storage counter, and the output handle would become **unpredictable off chain**, silently
breaking the graph binding that `QuoteActivator` depends on. So the engine asserts the attribute bit
instead of hoping. A stage run out of order fails with a public revert naming the stage, which is a
public fault about ordering and discloses nothing confidential.

`_isolate` costs `toEuint256` 6,256 + `eq` 10,398 + `select256` 15,263 = **31,917 gas**, or 29,981
for the `euint16` form. It is paid 16 times for allocations, 16 for remaining, 16 for reserved and 5
for published results — never per cell.

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
| isolation changes the handle and not the value | `confidential/test/80-handle-isolation.ts` |
| two numerically equal allocations are two handles with two ACL entries | `80`, demonstration 17 |
| a provider is not an admin of another provider's allocation | `80`, on-chain `isAllowed` |
| nothing but the five results is publicly decryptable | `86-public-surface.ts`, on-chain `isPubliclyDecryptable` over every handle the epoch produced |
| the off-chain derivation reproduces a real handle | `packages/nox/test/handle-derivation.test.ts` against handles observed on the real stack |

The last row is the one that would be easiest to fake and hardest to notice: it compares a handle
computed from the source formula against a handle a live NoxCompute actually returned. If the
derivation is wrong, the graph binding is decorative.
