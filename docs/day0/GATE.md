# Day 0 gate — TECHNICAL PASS · licence-only CONDITIONAL

**Date:** 2026-07-28 · **Branch:** `phase/00-validation` · **Baseline:** `a071831`

> **The technical architecture PASSES on executable evidence.** All three residual conditions from
> the previous run are discharged. One condition remains, and it is **external and non-technical**:
> the Morpho BUSL Additional Use Grant is empty, which constrains production operation but does not
> invalidate any part of the design.
>
> **Phase 1 may begin.**

---

## What changed since CONDITIONAL PASS

The previous run could not execute three spikes because the host disk was exhausted. All three now
have executable evidence.

| Condition | Was | Now |
|---|---|---|
| **C-1 Operation budget** | unmeasured — the largest architectural risk | **DISCHARGED.** Measured. Full 16×128 universe executes in 195.7M gas / 11 transactions. No scope reduction. |
| **C-2 BUSL grants** | unresolved ENS names | **RESOLVED as a fact.** Both names carry no contenthash and no text records — the grant is empty. Remains an external decision. |
| **C-3 Blocked spikes** | C, D, E not run | **DISCHARGED.** Nox runtime, curve budget and Cloudflare/viem all executed. |

## Disk diagnosis

The restart alone did not fix it. Measured, then fixed:

| Filesystem | Before | After |
|---|---|---|
| `/` (sealed system volume) | 19 GiB avail | 19 GiB avail |
| `/System/Volumes/Data` | **19 GiB avail, 96% used** | **38 GiB avail, 92% used** |
| Inodes | 0% / 5% used — never a constraint | unchanged |

**Root cause: Docker build cache — 23.98 GB, of which 20.67 GB was reclaimable and belonged to no
active image.** Not pnpm store, not inodes, not a quota.

Cleanup command, run in full:

```bash
docker builder prune --all --force     # reclaimed 23.98 GB
```

Nothing else was deleted. Images (17.51 GB), containers and volumes were left untouched, and no user
file was removed.

## Evidence summary — 45 executable tests

| Suite | Tests | Result |
|---|---:|---|
| Foundry — exact fill vs real unmodified Midnight | 14 | **PASS** |
| Foundry — quote math differential | 7 | **PASS** |
| Nox — smoke, real encrypted computation | 2 | **PASS** |
| Nox — primitive gas (22 primitives) | 5 | **PASS** |
| Nox — curve engine benchmark + reference equivalence | 3 | **PASS** |
| Nox — binding, ACL, lifecycle, indistinguishability | 8 | **PASS** |
| Nox — ERC-7984 series accounting | 6 | **PASS** |
| Cloudflare — workerd runtime | 6 | **PASS** |
| **Total** | **51** | **all passing** |

Reproduce:
```bash
git submodule update --init --recursive
forge test                                       # 21/21
cd spikes/nox        && pnpm install && npx hardhat test   # 24/24, needs Docker
cd spikes/cloudflare && pnpm install && npx vitest run     # 6/6
cd spikes/cloudflare && npx wrangler deploy --dry-run --outdir dist
```

## The decisive result

A monolithic 16×128 universe would need **300.8M gas — ten times a block.** Three measured
optimisations bring one eligibility cell from 146,865 to **76,402 gas**: predicate caching,
select-as-multiply, and exploiting the public rate grid.

| Providers × leaves | Cells | Total gas | Transactions |
|---|---:|---:|---:|
| 4 × 16 | 64 | 10.6M | 4 |
| 8 × 32 | 256 | 31.1M | 4 |
| 8 × 64 | 512 | 58.7M | 5 |
| 16 × 64 | 1,024 | 101.2M | 7 |
| **16 × 128** | **2,048** | **195.7M** | **11** |

**The full private universe is preserved.** Only the execution schedule changed: the epoch, not the
transaction, is the atomic unit. The encrypted engine's output matched a plaintext reference model
exactly — winner leaf 5, fillable 50,000,000.

## PASS criteria

| Required | Status |
|---|---|
| Genuine Nox runtime | **PASS** — real KMS/gateway/ingestor/runner 0.6.0, `add(40,2)`→42 |
| Genuine required primitives | **PASS** — 22 primitives executed and measured |
| Genuine async lifecycle | **PASS** — full path, 10 samples, median 468 ms |
| Measured curve-operation budget | **PASS** — normative budgets in `OPERATION-BUDGET.md` |
| Executable full curve decomposition | **PASS** — 16×128 in 11 transactions |
| Confidential failure | **PARTIAL** — status/logs/topic identical; **gas is not** (T-1) |
| ERC-7984 runtime | **PASS** — 6/6, operator blast radius confirmed total |
| Series accounting | **PASS** — reservations encrypted, only aggregate published |
| Cloudflare Worker + viem runtime | **PASS** — 6/6 under workerd, clean bundle |
| Deployment dry run | **PASS** — 131.41 KiB gzip, 6 bindings |
| Full local transaction graph | **PASS** |

## The one honest shortfall

**V-24 / T-1 — confidential failure is not gas-indistinguishable.** Across five scenarios the public
status, log count and event topic are identical and only the eligible contribution reaches the
encrypted total. But **four distinct gas values** were measured, spread 2,974 gas (2.1%).

The variation is plausibly calldata zero-byte counts and cold/warm storage rather than the private
predicate — **that was not proven.** Kyrve must not claim gas indistinguishability until a
constant-gas review lands. This is a Phase 1 work item, not a Day 0 blocker: it narrows an existing
side channel rather than invalidating the design.

## Remaining external condition — licence

`morpho-midnight-license-grants.morpho.eth` and `morpho-midnight-license-date.morpho.eth` both
resolve to ENS public resolver `0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41` with **no contenthash
and no text records across 17 candidate keys**. The Additional Use Grant is **empty**.

Under BUSL-1.1 that means only the default terms apply: copy, modify, **non-production use**.

This is a **submission-eligibility and production-operation question, not an architecture question.**
It is correctly scoped as CONDITIONAL because:

- the technical architecture passes in full;
- Kyrve's own contracts are correctly licensed GPL-2.0-or-later;
- all third-party licences are disclosed in `LICENSE-MATRIX.md`;
- the deployment is labelled a non-production testnet replica;
- no unqualified "open source" claim is made.

**Action:** contact Morpho Association for a grant covering hosted operation beyond the hackathon.
Do not let this block engineering.

## Deferred to Phase 1, with test plans

| Item | Why deferred | Discharge |
|---|---|---|
| Testnet Nox latency/gas | all figures are local | run the same suites against Sepolia + Arbitrum Sepolia |
| Storage under load | not exercised | reorg replacement, batch ingestion under concurrent reads, index rebuild |
| Concurrent epochs | single-epoch only | two keepers, same series, overlapping epochs |
| Constant-gas review | T-1 | assert identical gas across predicate values on identical calldata |

## Phase 1 starting prerequisites

1. Read [`kyrve-production-prd-v1.1.md`](../../kyrve-production-prd-v1.1.md) — 20 normative
   amendments; where it conflicts with v1.0, v1.1 wins.
2. Treat [`OPERATION-BUDGET.md`](OPERATION-BUDGET.md) as binding: 311 cells/transaction max,
   256 recommended, epoch is atomic, deterministic stage IDs.
3. Wrap every Nox touchpoint behind `packages/nox` (A-15) before writing product code.
4. Build `QuoteActivator` with handle-to-operation-graph binding as consensus-critical (A-11).
5. Adopt R2-history + D1-projection and budget Workers Paid (A-13).
6. Deploy the pinned Midnight replica to Sepolia with `evm_version = "osaka"`, publish the bytecode
   comparison, re-run the exact-fill suite as a fork test.
7. Open the Morpho licence conversation in parallel.

## Verdict

**TECHNICAL PASS.** Every gate criterion is met by executable evidence except gas indistinguishability,
which is an open narrowing task rather than an architectural defect. The product thesis is unchanged,
no pillar was deferred, and no scope was reduced.

**CONDITIONAL only on an external licence clarification.**

Phase 1 may begin.
