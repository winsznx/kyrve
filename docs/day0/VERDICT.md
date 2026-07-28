# Day 0 verdict — CONDITIONAL PASS

Date: 2026-07-28 · Branch: `phase/00-validation` · Baseline commit: `a071831`

> **CONDITIONAL PASS.** Every load-bearing claim that could be tested was tested, and the product
> thesis — *one quote, the curve stays private* — survives intact. Three conditions must be
> discharged before implementation proceeds, all of them measurement or paperwork rather than
> redesign.

Not a full PASS, because a full PASS requires executable evidence and three planned spikes could not
execute: the host machine ran out of disk. Not a FAIL, because nothing discovered contradicts the
architecture, and the single hardest technical claim in the PRD is now **proven** rather than
assumed.

---

## What was proven executably

### The central technical contribution works

PRD §2.4 claims the ratifier alone cannot enforce exact fills, so the maker callback must. That is
correct, and it is correct for precisely the stated reason.

**14/14 tests pass against a real, unmodified Morpho Midnight at the pinned release** —
`contracts/integration/test/ExactFill.t.sol`. Nothing on the protocol path is mocked.

| Attack | Result | Rejected by |
|---|---|---|
| Partial fill (`exactUnits − 1`) | reverts | `KyrveSeriesVault.onBuy` |
| Half fill | reverts | `KyrveSeriesVault.onBuy` |
| Oversized fill | reverts | Midnight's own `ConsumedUnits` |
| Wrong taker | reverts | ratifier |
| Altered tick / expiry / callback / `maxUnits` | reverts | ratifier (offer hash) |
| Replay after settlement | reverts | quote consumed |
| Spoofed callback caller | reverts | vault caller check |
| Expired quote | reverts | Midnight `OfferExpired` |
| Ratifier not authorised by maker | reverts | Midnight `RatifierUnauthorized` |

And the property that makes the whole design safe: after a rejected half-fill, **group consumption,
vault credit and borrower debt are all zero**, and the exact fill still succeeds afterwards. The
revert is a true rollback, not a partial state change.

### The quote math is exact

7/7 tests, differential-tested against real `take` return values across a 10-point rate grid —
`contracts/integration/test/QuoteMathDifferential.t.sol`.

- `buyerAssets = floor(units × tickToPrice(tick) / WAD)`, matching real settlement at every tick.
- **Independent of the settlement fee** — proven by raising the fee to its maximum and observing the
  maker's payment unchanged while the borrower's proceeds fell.
- `tickToPrice` is monotone, resolving the tick-direction question §9.3 deliberately left open.
- Rounding units **down** from a target never overdraws the providers' reservation; dust bounded at
  2 wei (fuzzed, 256 runs). Rounding up would break invariant §19.2.

### Sepolia can host the pinned release

The PRD never noticed that `vendor/midnight/foundry.toml` pins `evm_version = "osaka"`. Had Sepolia
not been on Osaka, §3.1's "deploy the pinned release unmodified" would have been impossible.

Proven executably, not inferred: the CLZ opcode (EIP-7939, Osaka) returns correct results for three
distinct inputs against the live chain, while a control confirms undefined opcodes are still
rejected — [`evidence/sepolia-osaka.md`](evidence/sepolia-osaka.md).

### Everything else is pinned and reproducible

`morpho-org/midnight` release `2026-07-23` **exists** at commit `dbd8d3d5`, vendored as a git
submodule, compiling clean under solc 0.8.34. All four Nox packages exist with recorded integrity
hashes. The `NoxCompute` proxy is live on Sepolia and was verified by reading its EIP-1967
implementation slot and calling `gateway()` — not by trusting a documentation page.

---

## The three conditions

### C-1 · Measure the Nox operation budget · **blocking**

Nox has **no batch API** — every encrypted primitive is a separate external call. Combined with the
discovery that Nox has **no boolean operations** (so §11.5's six-term conjunction must be
arithmetised at ~12 ops per provider-leaf instead of ~6), the §9.1 launch universe of 16 providers ×
128 leaves implies **≥ 24,576 cross-contract calls for a single quote**.

No per-operation gas figure is published by iExec, and none was measured. Until it is, §9.1's "up to
128 market-rate leaves" is an aspiration, not a validated parameter.

**This does not weaken the product.** The full private curve is preserved; only the transaction
decomposition changes. §13.7 already defines `computeLeaf(requestId, leafIndex)` — that per-leaf
decomposition becomes normative, the epoch rather than the transaction becomes the atomic unit, and
`maxProviders × ticksPerMarket` per transaction is derived from measurement.

**Discharge:** run SPIKE D on the local Nox stack, then set §9.1's parameters from the measured
number. See [`PRD-DELTA.md`](PRD-DELTA.md) D-11 and D-12.

### C-2 · Resolve the BUSL licence position · **blocking, and not a technical decision**

Both protocol cores are BUSL-1.1, not open source:

- `src/Midnight.sol` — BUSL-1.1, Change Date the earlier of 2030-05-01 or an ENS-specified date,
  Additional Use Grant at `morpho-midnight-license-grants.morpho.eth` (**unresolved**).
- `@iexec-nox/nox-protocol-contracts` — declares `MIT` in `package.json` while its core modules are
  BUSL-1.1 with **"Additional Use Grant: None"**.

BUSL grants copy, modify and **non-production use**. `hack.md` requires open-source code and states
the prize covers **a year of hosting**. Kyrve *deploys the Midnight core itself*.

**Discharge:** resolve both ENS names, record them verbatim, state which grant Kyrve relies on, and
contact Morpho Association if none covers it. This needs a human decision — I am not able to make it
and should not.

Mitigating: Kyrve imports only MIT-licensed `sdk/Nox.sol` from the Nox package; the BUSL modules are
already-deployed infrastructure Kyrve calls but never redistributes. Kyrve's own contracts carry
GPL-2.0-or-later, which is the compatible choice given they import GPL Midnight interfaces.

### C-3 · Run the three blocked spikes · **non-blocking, cheap**

| Spike | Currently | Discharge |
|---|---|---|
| C — Nox primitives | source proof only | Local Nox Docker stack; execute `fromExternal` binding, safe arithmetic, `select`, encrypted division, ACL, public decryption |
| D — curve budget | not run | Feeds C-1 |
| E — Cloudflare + viem | structural evidence only | `wrangler deploy --dry-run --outdir dist`, grep for `[unenv] … is not implemented yet!` |

None is known to fail. All three were blocked by the same environmental cause.

---

## Why this is not a FAIL

Three findings looked like they might be fatal, and none was:

1. **`evm_version = "osaka"`** — would have made "deploy unmodified" impossible. Sepolia is on
   Osaka. Resolved.
2. **No encrypted boolean operations in Nox** — §11.5's eligibility conjunction appeared
   inexpressible. It is expressible by arithmetising indicators. Costs more operations; changes
   nothing about what stays private.
3. **Encrypted-by-encrypted division** — §11.10's pro-rata allocation depends on it, and it is easy
   to assume an FHE stack lacks it. `div` and `safeDiv` both exist for `euint256`. Resolved.

The product thesis was not weakened, no pillar was deferred, and no scope was reduced to reach this
verdict.

---

## Honest limits of this verdict

- **Nothing was deployed.** No Sepolia writes, no funded keys, no live Midnight replica. All chain
  interaction was read-only.
- **Local proof ≠ production proof.** The exact-fill and quote-math results come from Foundry
  against a locally-deployed real Midnight. That proves protocol semantics; it does not prove a
  Sepolia deployment, oracle liveness or real market parameters.
- **Nox runtime behaviour is unexecuted.** Source proof establishes that primitives exist with given
  signatures. It does not prove how they behave at runtime, how long operations take, or what they
  cost.
- **Both sub-agent reports were treated as input, not conclusions.** The two claims that changed the
  verdict — the missing boolean operations and the Nox Sepolia deployment — were re-verified
  first-hand against `sdk/Nox.sol@0.2.4` and live chain state before being relied on.
- **The disk exhaustion is an environmental fact, not a project finding.** The machine was already
  at 99% capacity; this session's repository work accounts for roughly 31 MB.

---

## Recommendation

**Proceed to Phase 1, in this order:**

1. Free disk, then run SPIKE D. Set §9.1's universe parameters from the measured op budget (C-1).
2. Resolve the BUSL grants in parallel — it is a human decision with a potentially long lead time (C-2).
3. Run SPIKES C and E to convert the remaining source proofs into executable ones (C-3).
4. Deploy the pinned Midnight replica to Sepolia with `evm_version = "osaka"`, publish the bytecode
   comparison, and re-run the exact-fill suite as a fork test against the live replica.

Do not begin product implementation until C-1 is discharged. It is the only finding that could still
force an architectural change, and it is cheap to settle.

---

## Evidence index

| Artifact | What it proves |
|---|---|
| `contracts/integration/test/ExactFill.t.sol` | Exact-fill defence, 14/14, real unmodified Midnight |
| `contracts/integration/test/QuoteMathDifferential.t.sol` | Quote math, rate grid, rounding, 7/7 |
| `docs/day0/evidence/sepolia-osaka.md` | Sepolia executes the Osaka EVM |
| `source-lock.json` | Every pin with integrity hashes and live-verified addresses |
| `docs/day0/SOURCE-LOCK.md` | Reproduction command for every locked fact |
| `docs/day0/LICENSE-MATRIX.md` | BUSL exposure on both cores |
| `docs/day0/PRD-DELTA.md` | 20 graded corrections to the PRD |

Reproduce the executable evidence:

```bash
git submodule update --init --recursive
forge test          # 21 passed, 0 failed
```
