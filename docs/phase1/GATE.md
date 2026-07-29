# Phase 1 gate — INCOMPLETE

```
PHASE 1 — INCOMPLETE (not PASS, not CONDITIONAL PASS, not FAIL)

Branch:       phase/01-foundations
Baseline:     89131b3 (Day 0 completed)
Final commit: see `git log --oneline phase/01-foundations ^main`
Date:         2026-07-29
```

> **This is not a passing gate, and it is not a failing one.** Roughly half of the Phase 1 scope is
> built and green; the rest has not been attempted. Issuing CONDITIONAL PASS here would be
> dishonest — that grade is reserved for *"all production code and local gates pass, and only a
> remote provider or account-level action remains."* That is not the situation. Several **local**
> deliverables are simply absent.
>
> `pnpm verify:phase1` currently prints CONDITIONAL PASS because it correctly reports on the gates
> that exist. This document is the wider, honest reading, and it governs.

---

## Pinned versions

| Component | Value |
|---|---|
| Morpho Midnight | release `2026-07-23`, commit `dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0` |
| Midnight source tree hash | `7fb501e3483b1f5dd80156862814d0c791e35f81d1a0e544e319d502359747ae` (28 files, unmodified) |
| solc / EVM | 0.8.34, `osaka`, `via_ir`, optimizer on, runs 466, `bytecode_hash = "none"` |
| Foundry | forge 1.7.1 @ `4072e48705af9d93e3c0f6e29e93b5e9a40caed8` |
| Node / pnpm | 24.14.1 / 10.33.0 |
| TypeScript / vitest / biome | 5.9.3 / 4.1.0 / 2.5.6 |
| Nox packages | contracts 0.2.4, confidential 0.2.2, plugin 0.1.0, handle 0.1.0-beta.13 |
| Nox service images | `nox-kms`, `nox-handle-gateway`, `nox-ingestor`, `nox-runner` all 0.6.0 |
| Cloudflare | wrangler 4.115.0, compatibility date 2026-07-28, **Workers Paid required** |

---

## Critical gates

| Gate | Status |
|---|---|
| workspace reproducibility | **PASS** — `pnpm install --frozen-lockfile` clean |
| source lock | **PASS** |
| toolchain lock | **PASS** — 12 pins match, every dependency exact, no caret/tilde/range |
| Midnight vendored unmodified | **PASS** — submodule at the pinned commit, 28 source files, clean worktree |
| Midnight bytecode reproducibility | **PASS** — 6 contracts locked; Midnight runtime 24,557 bytes |
| local Midnight deployment | **PASS** — full substrate at block 26 |
| Osaka verification | **PASS** — deployed CLZ probe returns true on chain |
| quote-math differential tests | **PASS** — all 6,745 ticks + 36 real `take` returns |
| rate-grid validation | **PASS** — 4 grids, 16 points each, regenerate byte-identically |
| exact-fill permanent regression | **PASS** — 23 tests against real unmodified Midnight |
| Nox adapter isolation | **PASS** — 0 violations over 58 files; verified to fail on a real violation |
| registry foundation | **PASS** — 22 tests |
| generated bindings | **NOT BUILT** |
| Cloudflare foundation | **NOT BUILT** |
| CI | **NOT BUILT** |
| security scans | **NOT RUN** |
| Sepolia deployment and verification | **NOT ATTEMPTED** — no credentials in this environment |
| Nox runtime compatibility (permanent suite) | **NOT PROMOTED** — Day 0 spike suite still the only source |

## Evidence

```
forge test                    53 passed, 0 failed   (Day 0 baseline: 21)
pnpm test:unit               202 passed, 0 failed
pnpm exec tsc --build          0 errors
pnpm exec biome check .        0 errors
forge fmt --check              clean
pnpm verify:phase1            12 passed, 0 failed, 3 skipped
```

Reproduce:

```bash
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm verify:toolchain
pnpm verify:vendor
pnpm verify:midnight-bytecode
pnpm exec tsx scripts/verify/import-boundary.ts
forge test --summary
pnpm exec vitest run
pnpm deploy:local            # starts anvil, deploys, writes manifests
pnpm exec tsx scripts/verify/markets.ts
pnpm verify:phase1
```

## Local deployment

Chain 31337, block 26, deployer `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`.

| Contract | Address |
|---|---|
| Midnight | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| TestUSDC | `0x0165878A594ca255338adfa4d48449f69242Eb8F` |
| TestWETH | `0xa513E6E4b8f2a923D98304ec87F64353C4D5C853` |
| TestWstETH | `0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6` |
| WethOracle | `0x8A791620dd6260079BF849Dc5567aDC3F2FdC318` |
| WstethOracle | `0x610178dA211FEF7D417bC0e6FeD39F05609AD788` |
| KyrveOsakaProbe | `0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44` |
| KyrveProtocolRegistry | `0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f` |
| KyrveDeploymentVerifier | `0x4A679253410272dd5232B3Ff7cF5dbB88f295319` |

### Four launch markets

One loan token, two maturities, two collateral families, plus one multi-collateral market. Every
market id below was **re-derived in TypeScript from the market struct and matched against what
`touchMarket` returned** — the manifest builder refuses to write a manifest otherwise.

| Key | Market id | Grid |
|---|---|---|
| `usdc-30d-weth` | `0x45de7986b59233ae943f9c94f8c2487851219d85984b878e2d2d2041c278fe31` | 16 ticks, 2.01–19.97% |
| `usdc-90d-weth` | `0x588b948019978d9168c5d25b890249989bf715d1fb61816990495fc2bbd3a9f0` | 16 ticks, 2.01–19.94% |
| `usdc-30d-wsteth` | `0x6aa53c3ce2028f72f8bd30375046a65ed9523547429d83b8b90b898b19582142` | 16 ticks, 2.01–19.97% |
| `usdc-90d-multi` | `0x0d9cbb561a77fdb2fb5881007c9287488e2fa537936d01ae831354dd3e35bef0` | 16 ticks, 2.01–19.94% |

## Sepolia deployment

**NOT ATTEMPTED.** No `DEPLOYER_PRIVATE_KEY`, no `ETHERSCAN_API_KEY` and no funded testnet account
exist in this environment. No broadcast was simulated or claimed.

`scripts/deploy/sepolia.ts` is **not yet written**; `scripts/verify/deployment.ts` is, and performs
the full read-only verification (chain identity and freshness, code presence, Midnight runtime
bytecode against the manifest, the Osaka probe executed on chain, the NoxCompute EIP-1967
implementation slot, and market-parameter contracts at each market id).

## Gas side-channel result

**NOT INVESTIGATED.** Day 0 finding V-24 / THREAT-MODEL T-1 stands exactly as recorded: public
status, log count and event topic are identical across eligible, rate-ineligible, underfunded,
cap-constrained and market-disabled contributions, but **four distinct gas values with a 2,974 gas
(2.1%) spread** were measured. Kyrve must continue to make no claim of gas indistinguishability.

## Licence condition

Unchanged and external. `morpho-midnight-license-grants.morpho.eth` and
`morpho-midnight-license-date.morpho.eth` resolve with no contenthash and no text records; the
Additional Use Grant is **empty**, so only BUSL-1.1 non-production use applies.

Applied throughout this phase rather than merely noted:

- `LICENSE` states the boundary per directory and calls Midnight **source-available, not open source**.
- `DeployKyrveSubstrate.s.sol` carries the disclosure in its own header.
- The deployment-manifest validator **rejects** any manifest whose `disclosure` field omits the
  non-production qualification — tested.
- `vendor-lock.json` records the empty grant as a fact.

The sanctioned phrasing:

> Kyrve is open-source software integrating an unmodified, source-available Morpho Midnight testnet
> replica under its applicable non-production licence.

## Blocking findings

None. No defect was found that invalidates the architecture, and no gate that was run failed.

## New PRD deltas

Recorded in [`PRD-DELTA.md`](PRD-DELTA.md):

- **P-1 CORRECTION** — the Day 0 capacity table omits Stage C chunk overhead and Stage E2,
  understating per-epoch gas by 0.72–2.42%. Conclusion unaffected.
- **P-2 CORRECTION** — A-8's justification for rounding `units` down is false; rounding up cannot
  overdraw either. Rounding down stays normative for a different, correct reason.
- **P-3 GAP** — a contract cannot read another contract's storage, so the NoxCompute
  proxy-to-implementation binding must be verified off chain.
- **P-4 CONFIRMED** — Workers Paid is a deployment prerequisite, not a runtime detail.

## Residual risks

Unchanged from Day 0 and **not** narrowed by this phase: gas indistinguishability (T-1), testnet
Nox latency and gas (AS-1), storage under load (AS-4), concurrent epochs (AS-5), the 24M gas
ceiling on live Sepolia (AS-11), and the Morpho licence grant (AS-10).

## What Phase 1 still needs

In dependency order:

1. `packages/generated` — reproducible ABI and typed-binding generation, with `git diff` empty
   after regeneration.
2. `workers/{api,indexer,keeper,status}` plus the lifecycle Workflow — health, version and
   config-verification paths only, no fake protocol metrics; `wrangler deploy --dry-run` and bundle
   inspection for `node:` imports, unenv stubs and `viem/node`.
3. Promotion of the Day 0 Nox spike suite into a permanent compatibility package, plus
   `docs/phase1/NOX-COMPATIBILITY.md` with the recorded image digests.
4. `scripts/deploy/sepolia.ts` with the full preflight, and the Sepolia broadcast itself.
5. The V-24 / T-1 constant-gas investigation.
6. CI workflows: core, Nox, Workers, deployment verification.
7. Security scans: Slither, dependency audit, licence scan, secret scan, bundle inspection.
8. The remaining `docs/phase1/` documents.

## Phase 2 prerequisites

Phase 2 (confidential assets and user input) must not begin until Phase 1 closes. When it does, it
inherits these as binding:

1. `docs/day0/OPERATION-BUDGET.md` as corrected by P-1 — 311 cells per transaction maximum, 256
   recommended, the epoch is the atomic unit, stage and chunk ids are deterministic.
2. Every Nox touchpoint goes through `@kyrve/nox`. The import-boundary check enforces it.
3. `QuoteActivator` must verify the decrypted handle is the handle **this request's** sealed
   operation graph derives. `@kyrve/nox` already refuses to return a decrypted value without it.
4. Transient handles reach reviewed Kyrve contracts only; auditors receive fresh snapshot handles.
5. No UI or API may claim a Nox grant was revoked, or that confidential failure is
   gas-indistinguishable.
