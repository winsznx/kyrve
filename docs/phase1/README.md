# Phase 1 — production foundations and the Ethereum Sepolia substrate

Phase 1 builds the public substrate every later phase settles on: the pinned Morpho Midnight
release deployed unmodified, four launch markets, quote math proven against real settlement, the
Nox boundary, the protocol registry, and a Cloudflare foundation that runs locally.

**It deliberately builds no product.** No confidential vault, no mandate book, no request book, no
curve engine, no secondary market, no roll engine, no frontend. Those are later phases, and
shipping placeholders for them would create an upgrade path nobody designed.

Start with [`GATE.md`](GATE.md) — the verdict and its evidence.

| Document | What it answers |
|---|---|
| [`GATE.md`](GATE.md) | Did Phase 1 pass, and against what evidence? |
| [`PRD-DELTA.md`](PRD-DELTA.md) | Where did Phase 1 find the PRD or Day 0 wrong? |
| [`GAS-SIDE-CHANNEL.md`](GAS-SIDE-CHANNEL.md) | Is confidential failure distinguishable by gas? |
| [`RATE-GRIDS.md`](RATE-GRIDS.md) | Which ticks may each market quote at, and why those? |
| [`SECURITY.md`](SECURITY.md) | What was scanned, what was found, how was each finding triaged? |
| [`TESTING.md`](TESTING.md) | What is tested, at which layer, and what makes a test count? |

Day 0's evidence remains authoritative for everything Phase 1 did not revisit; see
[`../day0/`](../day0/).

## The shape of it

```
encrypted mandates + encrypted request        <- Phase 2
        -> Nox curve engine                   <- Phase 2
        -> one publicly decrypted leaf        <- Phase 2
        -> KyrveQuoteRatifier                 <- Phase 1, deployed and verified
        -> KyrveExactFillVault.onBuy          <- Phase 1, deployed and verified
        -> unmodified Morpho Midnight take()  <- Phase 1, deployed and verified
```

Phase 1 owns the bottom three lines. The two enforcement points are not redundant: `isRatified` is
`view` and never receives `units`, so it **cannot** enforce fill size; `onBuy` is the only place
actual fill size reaches maker code.

## Four things worth knowing before reading the code

**The deployed Midnight bytecode hash is identical to the local build.** "Pinned release, deployed
unmodified" is therefore a fact this repository can re-check, not a claim it makes.

**Midnight is source-available, not open source.** It is BUSL-1.1 and the Additional Use Grant was
resolved on 2026-07-28 and found empty, so only non-production use is granted. The deployment-
manifest validator *rejects* any manifest whose disclosure omits that. See [`../../LICENSE`](../../LICENSE).

**Nox has no boolean operations.** No `and`, `or`, `not`, `xor`, and `select` has no `ebool`
overload. `@kyrve/nox` therefore exposes no boolean API, because offering one would be a lie that
compiles. Predicates are arithmetised.

**A Nox decryption proof proves less than it appears to.** It is a pure signature check with no
ACL, nonce, expiry or caller binding, so it is replayable by anyone forever. `@kyrve/nox` will not
return a decrypted value without the handle derived from the caller's own sealed operation graph.

## Layout

```
contracts/registry/      KyrveProtocolRegistry, KyrveDeploymentVerifier, KyrveOsakaProbe
contracts/integration/   the permanent exact-fill harness and the deterministic local fixture
packages/config/         chains, environments, measured operation budget, manifest schema
packages/quote-math/     tick, fee and quote math, pinned to real settlement
packages/midnight/       pinned ABIs, market id and offer hash derivation
packages/nox/            the ONLY module permitted to depend on iExec Nox
packages/generated/      generated ABIs and the embedded deployment record
packages/worker-core/    the status contract every Worker implements
workers/                 api, indexer, keeper, status — local only in Phase 1
scripts/                 deploy, verify, generate; every gate is a script here
deployments/             local and sepolia manifests, addresses, markets, verification metadata
```

## Reproducing

```bash
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm verify:phase1
```

Everything above runs offline except the Sepolia gates, which need only a read RPC.
