# Phase 1 gate

```
PHASE 1 — LOCAL SUBSTRATE                        PASS
PHASE 1 — SEPOLIA SUBSTRATE                      PASS
CLOUDFLARE APPLICATION DEPLOYMENT                DEFERRED UNTIL COMPLETE PRODUCT

Overall: CONDITIONAL PASS
Branch:       phase/01-foundations
Baseline:     89131b3 (Day 0 completed)
Date:         2026-07-29
```

**The contract substrate is complete, on both chains.** The remaining Phase 1 work is operational
tooling — the Cloudflare foundation, the Nox compatibility promotion, the gas side-channel
investigation, CI and the security scans — none of which affects what is deployed.

The overall grade is CONDITIONAL PASS, not PASS, because those local deliverables are still absent.
Cloudflare being deferred is an owner decision and is **not** counted against the grade.

Run `pnpm verify:phase1` for the live version of this table.

---

## PHASE 1 — LOCAL SUBSTRATE · PASS

| Gate | Status |
|---|---|
| workspace reproducibility (`--frozen-lockfile`) | **PASS** |
| source lock | **PASS** |
| toolchain lock | **PASS** — 12 pins, every dependency exact, no range anywhere |
| vendored Midnight unmodified | **PASS** — 28 files, tree hash `7fb501e3…`, clean worktree |
| Midnight bytecode reproducibility | **PASS** — 6 contracts locked |
| import boundary (Nox isolation, A-15) | **PASS** — verified to fail on a real violation |
| TypeScript build | **PASS** |
| lint and format | **PASS** — biome 0, `forge fmt --check` clean |
| unit and property tests | **PASS** — 213 |
| Foundry suites | **PASS** — 53 |
| rate grids regenerate deterministically | **PASS** — byte-identical |
| local Midnight deployment + 4 markets | **PASS** |
| generated ABIs and bindings | **PASS** — 11 ABIs, no timestamp, `git diff` clean |
| Nox runtime compatibility | **NOT PROMOTED** — Day 0 spike suite still the only source |
| Cloudflare Worker foundation | **NOT BUILT** |
| CI | **NOT BUILT** |
| security scans | **NOT RUN** |
| gas side-channel (V-24 / T-1) | **NOT INVESTIGATED** |

## PHASE 1 — SEPOLIA SUBSTRATE · PASS

Deployed at block **11373556**, deployer `0x36C3d1AF18b9186A662B1e277c80Ab54bE2765C2`,
9,756,357 gas. **9/9 contracts verified on Etherscan V2.**

The deployed Midnight runtime bytecode hash is **identical to the local build** — the
"pinned release, deployed unmodified" claim is proven rather than asserted.

| Contract | Address | Source |
|---|---|---|
| `Midnight` | `0xA8774FEba7DDCAdcE4C299c3EC376B8ef447B2d7` | verified |
| `TestUSDC` | `0x0257E18aA1a631864aaF1DCedC6b5741C96A1eF9` | verified |
| `TestWETH` | `0x900777F598CBcb440dBcdfC2007E379F3374D61C` | verified |
| `TestWstETH` | `0x6200312Afb642782530D423E3ad2b233357d0417` | verified |
| `WethOracle` | `0xc284dF918bC120C66996746692DaC67696A131A8` | verified |
| `WstethOracle` | `0x812c49bA623765C23E42Aba4fEd8d33D21027F5f` | verified |
| `KyrveOsakaProbe` | `0xbbec3e83090F764bB7C55006042aa0438cF6974A` | verified |
| `KyrveProtocolRegistry` | `0xB7790e3f28eD688C81f09C0Cad72f7f45f4D3957` | verified |
| `KyrveDeploymentVerifier` | `0xa7D60Be81889777C54CB1AF4afAe8FaBFe8C20e0` | verified |

### Four launch markets

One loan token, two maturities, two collateral families, plus one multi-collateral market. Every id
is re-derived in TypeScript and compared against what `touchMarket` returned.

| Key | Market id |
|---|---|
| `usdc-30d-weth` | `0x10e4bf7d5d586cee190fcd15c4ba68fd24a9b738068fbac2534568718678196a` |
| `usdc-90d-weth` | `0xd3cb37a754429601735a16349771482103c5dc40848b51970c4dcec6241163e6` |
| `usdc-30d-wsteth` | `0xe36e890864679677d9d1e2817574d61e0c8ae42a6329251cd01f93b743bb4a81` |
| `usdc-90d-multi` | `0x97870262408061213d3753437dcec435b340c6bfb8d3c7f4ff3ce3f208adfebc` |

### Write-path integration against real Sepolia — 7/7

Harness: vault `0x6577f68a5b91235d125d1f138dabbb44d621a35a`, ratifier
`0x83b1157e98a8bb000326e80546b35b9f0174c31f`.

| Step | Result |
|---|---|
| permanent exact-fill harness deployed | **PASS** |
| maker authorises ratifier (A-2) | **PASS** — `isAuthorized[vault][ratifier]` true on chain |
| normal Midnight lifecycle (`supplyCollateral`) | **PASS** |
| rejected partial fill | **PASS** — reverts `WrongUnits`, **mined and reverted**, not simulated |
| rollback leaves no residue | **PASS** — group consumption, vault credit and taker debt all delta zero |
| exact fill settles | **PASS** — credit +1,000,000, debt +1,000,000, consumed +1,000,000 |
| replay after settlement | **PASS** — reverts `QuoteNotExecutable` |

The rejected partial fill is deliberately **broadcast** rather than simulated: a static call proves
the revert, but only a mined reverted transaction proves the rollback on a chain that persists
state.

Evidence: `deployments/sepolia/{manifest,addresses,markets,etherscan-verification,integration-results}.json`.

## CLOUDFLARE APPLICATION DEPLOYMENT · DEFERRED

**Deferred by owner decision until the complete product works end to end.** No Cloudflare resource
was created, and no temporary production resource exists. The API, indexer, keeper, proof service,
workflows and web application run locally during development and connect to either the
deterministic local contracts or the verified Sepolia contracts through environment configuration.

This is a sequencing decision, not a failure, and is not counted against the grade.

---

## Evidence

```
forge test                    53 passed, 0 failed   (Day 0 baseline: 21)
pnpm test:unit               213 passed, 0 failed
pnpm exec tsc --build          0 errors
pnpm exec biome check .        0 errors
forge fmt --check              clean
pnpm verify:phase1            16 passed, 0 failed, 3 skipped
```

Reproduce, local only:

```bash
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm verify:phase1
pnpm deploy:local
```

Read-only against the live Sepolia substrate (needs only `ALCHEMY_API_KEY`):

```bash
pnpm verify:sepolia
pnpm test:markets sepolia
```

Broadcast paths require two independent opt-ins and are not reachable by accident:

```bash
pnpm preflight:sepolia          # read-only; signs nothing
DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true pnpm deploy:sepolia
pnpm verify:etherscan
DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true pnpm test:sepolia
```

## Secret handling

Enforced by code, not by discipline. `scripts/lib/env.ts` reduces every RPC URL to scheme and host
before it can be logged (provider keys live in the path, so truncating the end is not safe), never
reads the private key for display, and `assertNoSecrets` inspects every artifact before it is
written. A per-variable scan confirms no sensitive value appears in any tracked or untracked file.

The RPC resolver **refuses to fall back to a public endpoint**. `.env` shipped with the drpc default
copied from `.env.example`; taking it at face value would have silently downgraded the owner's
Alchemy provider and changed `eth_getLogs` behaviour.

## Gas side-channel result

**NOT INVESTIGATED.** Day 0 V-24 / THREAT-MODEL T-1 stands: four distinct gas values, 2,974 spread
(2.1%). Kyrve must continue to make no claim of gas indistinguishability.

## Licence condition

Unchanged and external. The Additional Use Grant is empty, so only BUSL-1.1 non-production use
applies. Applied in code: the manifest validator **rejects** any manifest whose disclosure omits the
non-production qualification, and the deployed Sepolia manifest carries it.

> Kyrve is open-source software integrating an unmodified, source-available Morpho Midnight testnet
> replica under its applicable non-production licence.

## New PRD deltas

[`PRD-DELTA.md`](PRD-DELTA.md) — P-1 (capacity table omits two per-epoch costs), P-2 (A-8's
justification for rounding down is false), P-3 (proxy binding is not on-chain verifiable), P-4
(Workers Paid is a prerequisite).

## Residual risks

Unchanged from Day 0: gas indistinguishability (T-1), testnet Nox latency and gas (AS-1), storage
under load (AS-4), concurrent epochs (AS-5), the Morpho licence grant (AS-10).

**AS-11 is now partially discharged**: the 24M gas ceiling was not stress-tested, but a 9.76M gas
deployment and a 221,956 gas `take` both executed on live Sepolia without hitting a limit.

## What Phase 1 still needs

1. `workers/{api,indexer,keeper,status}` plus the lifecycle Workflow — health, version and
   config-verification paths only; local tests and `wrangler deploy --dry-run`, which publishes
   nothing and needs no account.
2. Promotion of the Day 0 Nox spike suite into a permanent compatibility package, plus
   `NOX-COMPATIBILITY.md` with recorded image digests.
3. The V-24 / T-1 constant-gas investigation.
4. CI workflows and the security scan set.
5. The remaining `docs/phase1/` documents.

## Phase 2 prerequisites

1. `OPERATION-BUDGET.md` as corrected by P-1 — 311 cells per transaction, 256 recommended, the
   epoch is the atomic unit, stage and chunk ids deterministic.
2. Every Nox touchpoint goes through `@kyrve/nox`; the import-boundary check enforces it.
3. `QuoteActivator` must verify the decrypted handle is the one this request's sealed operation
   graph derives. `@kyrve/nox` already refuses to return a value without it.
4. Transient handles reach reviewed Kyrve contracts only; auditors get fresh snapshot handles.
5. No UI or API may claim a Nox grant was revoked, or that confidential failure is
   gas-indistinguishable.
