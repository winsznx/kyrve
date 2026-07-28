# Operation budget — normative

Every number here is **measured** against the real local Nox stack (KMS, handle gateway, ingestor,
runner v0.6.0), not estimated. Raw data: [`evidence/day0/nox-runtime/`](../../evidence/day0/nox-runtime/).

Reproduce:
```bash
cd spikes/nox && pnpm install && npx hardhat test
```

These values replace the asserted limits in PRD §9.1 and the unquantified "batch operations"
language in §13.7. They are binding on implementation.

## 1. Measured primitive cost

Marginal gas = `(gas(n=10) − gas(n=1)) / 9`, which cancels transaction and calldata overhead.

| Primitive | Marginal gas | Note |
|---|---:|---|
| `allow` | 3,651 | persistent, **irreversible** |
| `allowTransient` | 4,323 | one transaction |
| `allowThis` | 5,856 | persistent, **irreversible** |
| `toEuint16` / `toEuint256` | 6,256 | plaintext → handle |
| `ge` / `eq` / `lt` | 10,110 – 10,398 | → `ebool` |
| `add` | 10,377 | wrapping |
| `add16` / `mul16` | ~12,225 | `euint16` |
| `sub` / `mul` / `div` | ~12,285 | wrapping; `div` saturates on ÷0 |
| `select(euint16)` | 13,300 | **no `ebool` overload exists** |
| `select(euint256)` | 15,263 | |
| `safeAdd` / `safeSub` / `safeMul` / `safeDiv` | 15,453 – 15,563 | returns `(ebool, T)` |

Two derived composites:

| Composite | Gas | Meaning |
|---|---:|---|
| indicator (`ebool` → `euint16` 0/1) | 10,625 | the only way to combine booleans |
| naive six-term conjunction | **146,865** | one eligibility cell, unoptimised |

## 2. The decomposition that makes the universe executable

A monolithic 16 × 128 universe at the naive cost is **300.8M gas — ten times a 30M block.** Three
structural changes, all measured, bring one cell from 146,865 to **76,402 gas**:

1. **Predicate caching.** `enabled`, `borrowerAllowed`, `portfolioCapAvailable` and
   `balanceAvailable` do not vary by leaf. They are evaluated **once per provider** (16 times), not
   once per cell (2,048 times), and collapse into two cached handles.
2. **Select-as-multiply.** `select(rateOk, cachedValue, 0)` tests eligibility *and* applies it in a
   single operation, removing both the indicator conversion and the multiply.
3. **Public tick.** The universe rate grid is published and hashed, so `rateAllowed` is one
   comparison of a public tick against the provider's encrypted minimum.

Per cell this is exactly five operations: `ge → select(euint256) → add → select(euint16) → add16`.

Linearity was verified, not assumed — chunk widths 1, 2, 4, 8, 16 gave 243,356 / 319,757 / 472,560 /
778,167 / 1,389,386 gas, a constant 76,402 per additional cell.

## 3. Measured stage costs

| Stage | Unit | Gas per unit |
|---|---|---:|
| A `seedProvider` | provider | 348,830 |
| B `cacheProvider` | provider | 256,553 |
| **C `accumulateLeafChunk`** | **(provider, leaf) cell** | **76,402** |
| C fixed overhead | chunk | 166,954 |
| D `finalizeLeaf` | leaf | 158,847 |
| E `reduceWinnerChunk` | leaf | 94,649 |
| E2 `publishWinner` | epoch | 90,076 |
| F `allocate` | provider | 166,423 |

## 4. Normative budgets

| Parameter | Value | Basis |
|---|---:|---|
| Transaction gas ceiling | **24,000,000** | 80% of a 30M block, leaving headroom |
| **Max cells per transaction** | **311** | `(24,000,000 − 166,954) / 76,402` |
| Recommended chunk width | **256 cells** | 19.7M gas, ~18% margin |
| Max providers per chunk | 16 | one full provider set per leaf |
| Max leaves per reduce chunk | 64 | 6.1M gas |
| Max leaves per finalize chunk | 128 | 20.3M gas |
| Handles created per cell | 3 | `ge`, two `select` results |
| Runner timeout per stage | **5 s** | measured p90 492 ms → 10× margin |
| Step retry limit | 5 | Cloudflare Workflows default |
| Epoch timeout | **15 min** | Workflow wall-clock for cron/queue |
| Min keeper concurrency | 2 | ≤6 simultaneous connections |

## 5. Capacity envelopes

Derived from the measured marginal costs above.

| Providers × leaves | Cells | Cell gas | Total gas | Transactions |
|---|---:|---:|---:|---:|
| 4 × 16 | 64 | 4,889,728 | 10,637,568 | 4 |
| 8 × 32 | 256 | 19,558,912 | 31,054,592 | 4 |
| 8 × 64 | 512 | 39,117,824 | 58,725,376 | 5 |
| 16 × 64 | 1,024 | 78,235,648 | 101,227,008 | 7 |
| **16 × 128** | **2,048** | **156,471,296** | **195,686,400** | **11** |

**The full 16 × 128 universe from PRD §9.1 is executable.** It costs ~195.7M gas across ~11
transactions inside one sealed epoch. No parameter reduction is required and no pillar is deferred —
only the execution schedule changes.

At Sepolia's typical sub-gwei gas price this is a few cents per quote. The binding constraint is
**wall-clock**, not cost: 11 sequential transactions plus Runner latency fits comfortably inside the
15-minute Workflow ceiling.

## 6. Rules this imposes on implementation

- Every stage is **idempotent and checkpointed**. The epoch, not the transaction, is the atomic unit.
- Stage and chunk identifiers are **deterministic** — Workflow step names are memoisation keys, so
  they must never contain a timestamp or random value.
- `accumulateLeafChunk` must reject a chunk already applied to a finalized leaf, so a keeper retry
  cannot double-count.
- Prefer `euint16` for indicators and indexes; reserve `euint256` for values that need the width.
  `select(euint16)` is 13% cheaper than `select(euint256)`.
- Never publish an intermediate. Only `publishWinner` crosses the boundary, and
  `allowPublicDecryption` is **irreversible**.
- Budget three handles per cell when sizing storage and gateway load.
