# Benchmarks

All figures measured 2026-07-28 against the real local Nox stack on Docker Desktop 29.6.1,
8 CPUs / 12.5 GB. Raw JSON in [`evidence/day0/nox-runtime/`](../../evidence/day0/nox-runtime/).

Reproduce: `cd spikes/nox && pnpm install && npx hardhat test`

## Environment

| Component | Version |
|---|---|
| `@iexec-nox/nox-protocol-contracts` | 0.2.4 |
| `@iexec-nox/nox-confidential-contracts` | 0.2.2 |
| `@iexec-nox/nox-hardhat-plugin` | 0.1.0 |
| `@iexec-nox/handle` | 0.1.0-beta.13 |
| `iexechub/nox-kms`, `nox-handle-gateway`, `nox-ingestor`, `nox-runner` | 0.6.0 |
| Local `NoxCompute` | `0x75C6AF4430cc474b1bb9b8540b7E46D6f8e1C685`, 163 bytes |
| Local gateway signer | `0xE1a6B1De3AbF04e7FA5355373880350Dc3004D0e` (local-only dev key) |
| solc / Hardhat / Node | 0.8.36 (viaIR, cancun) / 3.11.1 / 24.14.1 |

## Async lifecycle — 10 samples, small graph

| Metric | min | median | p90 | max |
|---|---:|---:|---:|---:|
| Transaction inclusion (ms) | 12 | 14 | 18 | 18 |
| Handle ready after inclusion (ms) | 262 | **468** | 492 | 492 |

Smoke run: encrypted `add(40, 2)` → publicly decrypted `42`, 173,988 gas, 97-byte decryption proof
(65-byte signature + 32-byte result), handle ready in 597 ms.

**Interpretation.** The Runner resolves a small graph in well under a second locally. The 5-second
per-stage timeout in the operation budget is a 10× margin on measured p90. This is a *local*
measurement — testnet latency is unmeasured and will be higher.

## Per-primitive marginal gas

See [`OPERATION-BUDGET.md`](OPERATION-BUDGET.md) §1 for the full table. Headline values:
`allow` 3,651 · `toEuint16` 6,256 · `ge` 10,110 · `add` 10,377 · `select(euint16)` 13,300 ·
`select(euint256)` 15,263 · `safeMul` 15,563 · indicator 10,625 · naive 6-term conjunction 146,865.

## Curve engine — measured stage costs

| Stage | Unit | Gas/unit |
|---|---|---:|
| A `seedProvider` | provider | 348,830 |
| B `cacheProvider` | provider | 256,553 |
| C `accumulateLeafChunk` | cell | **76,402** |
| D `finalizeLeaf` | leaf | 158,847 |
| E `reduceWinnerChunk` | leaf | 94,649 |
| E2 `publishWinner` | epoch | 90,076 |
| F `allocate` | provider | 166,423 |

Chunk-width linearity (proves the marginal figure is real, not an artefact):

| Width | 1 | 2 | 4 | 8 | 16 |
|---|---:|---:|---:|---:|---:|
| Gas | 243,356 | 319,757 | 472,560 | 778,167 | 1,389,386 |
| Implied per-cell | — | 76,401 | 76,401 | 76,402 | 76,402 |

## Capacity envelopes

| P × L | Cells | Cell gas | Total gas | Tx |
|---|---:|---:|---:|---:|
| 4 × 16 | 64 | 4,889,728 | 10,637,568 | 4 |
| 8 × 32 | 256 | 19,558,912 | 31,054,592 | 4 |
| 8 × 64 | 512 | 39,117,824 | 58,725,376 | 5 |
| 16 × 64 | 1,024 | 78,235,648 | 101,227,008 | 7 |
| **16 × 128** | **2,048** | **156,471,296** | **195,686,400** | **11** |

## Result equivalence

The encrypted engine was checked against a plaintext reference model over a deterministic
16-provider fixture containing eligible, disabled, borrower-rejected, portfolio-capped and
zero-balance providers across 8 leaves.

```
reference winner : leaf 5 fillable 50000000
encrypted winner : leaf 5 fillable 50000000
```

Exact match on both the winning leaf index and the fill amount.

## Cloudflare

| Metric | Value |
|---|---|
| Bundle | 647.57 KiB raw / **131.41 KiB gzip** (limit 3 MB free, 10 MB paid) |
| `[unenv] … not implemented` markers | **0** |
| Residual `node:` imports | **0** |
| `viem/node` (IPC) in bundle | **absent** |
| Bindings resolved | 6 — DO, Workflow, Queue, D1, R2, var |
| workerd tests | **6/6 pass** |

## Not measured

- **Testnet latency and gas.** Every Nox figure is local. Sepolia and Arbitrum Sepolia run different
  contract versions and different KMS keys; portability is not assumed.
- **Runner CPU/memory peaks.** Docker stats were not sampled per stage.
- **Concurrent epochs.** All measurements are single-epoch, sequential.
- **Medium/large graph latency.** Only the small-graph lifecycle was sampled 10×; the 5-run and
  3-run tiers for larger graphs were not executed.
