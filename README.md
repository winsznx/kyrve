# Kyrve

Confidential fixed-income liquidity network. Encrypted lender mandates and borrower requirements
become **one** executable Morpho Midnight offer, while the full yield curve, provider allocations,
exposure limits, rejected alternatives and beneficial ownership stay private.

> One quote. The curve stays private.

---

## Status: Phase 1 — public substrate

**This repository does not yet implement the product.** Phase 1 builds the substrate every later
phase settles on, and stops there deliberately.

| Built and proven | Not yet built |
|---|---|
| Pinned Morpho Midnight, deployed unmodified to Ethereum Sepolia | The confidential curve engine |
| Four launch markets, live and verified | Mandate book and request book |
| Quote math proven against real `take()` returns | The confidential asset vault |
| Exact-fill enforcement, with rollback and replay proven on chain | Secondary market, roll engine |
| The Nox boundary (`@kyrve/nox`) and its enforcement | The frontend |
| Protocol registry, deployment verifier, Osaka probe | |
| Cloudflare foundation — running locally only | Cloudflare deployment |

Read [`docs/phase1/GATE.md`](docs/phase1/GATE.md) for the verdict and its evidence.

## Live on Ethereum Sepolia

Deployed at block 11373556. **9/9 contracts verified on Etherscan V2.** The deployed Midnight
runtime bytecode hash is identical to the local build, so "pinned release, deployed unmodified" is
a fact this repository re-checks rather than a claim it makes.

| Contract | Address |
|---|---|
| Morpho Midnight (replica) | [`0xA8774FEba7DDCAdcE4C299c3EC376B8ef447B2d7`](https://sepolia.etherscan.io/address/0xA8774FEba7DDCAdcE4C299c3EC376B8ef447B2d7#code) |
| `KyrveProtocolRegistry` | [`0xB7790e3f28eD688C81f09C0Cad72f7f45f4D3957`](https://sepolia.etherscan.io/address/0xB7790e3f28eD688C81f09C0Cad72f7f45f4D3957#code) |
| `KyrveDeploymentVerifier` | [`0xa7D60Be81889777C54CB1AF4afAe8FaBFe8C20e0`](https://sepolia.etherscan.io/address/0xa7D60Be81889777C54CB1AF4afAe8FaBFe8C20e0#code) |
| `KyrveOsakaProbe` | [`0xbbec3e83090F764bB7C55006042aa0438cF6974A`](https://sepolia.etherscan.io/address/0xbbec3e83090F764bB7C55006042aa0438cF6974A#code) |

Full manifest, including test assets, oracles and the four market ids:
[`deployments/sepolia/`](deployments/sepolia/).

## Licence, stated precisely

> Kyrve is open-source software integrating an unmodified, **source-available** Morpho Midnight
> testnet replica under its applicable **non-production** licence.

Morpho Midnight is BUSL-1.1. It is **not** open source. Its Additional Use Grant was resolved on
2026-07-28 and found **empty**, so only non-production use is granted. Kyrve's Sepolia deployment
is a non-production testnet replica — not an official Morpho deployment, not maintained by Morpho
Association, and carrying no Morpho branding.

Kyrve's own contracts are GPL-2.0-or-later; its other code is MIT. See [`LICENSE`](LICENSE) and
[`docs/phase1/MIDNIGHT-LICENCE.md`](docs/phase1/MIDNIGHT-LICENCE.md).

## Getting started

```bash
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm verify:phase1        # the full gate
```

Everything runs offline except the Sepolia gates, which need only a read RPC.

```bash
pnpm deploy:local         # anvil + full substrate + manifests
pnpm test:contracts       # 53 against real unmodified Midnight
pnpm test:unit            # 213
pnpm test:workers         # 32 under workerd
```

Copy [`.env.example`](.env.example) to `.env` for chain access. `.env` is git-ignored, and
`pnpm verify:secrets` fails the build if any credential reaches a tracked file.

## Two properties worth understanding

**Exact fill is enforced in the callback, not the ratifier — and it has to be.**
`IRatifier.isRatified` is `view` and never receives `units`, so it can authenticate an offer but is
structurally incapable of enforcing its size. `onBuy` is the only point where actual fill size
reaches maker code. Proven on live Sepolia: a partial fill reverts `WrongUnits`, and the mined
reverted transaction leaves group consumption, vault credit and taker debt all unchanged.

**A Nox decryption proof proves less than it looks like.** It is a pure signature check with no ACL,
nonce, expiry or caller binding, so it is replayable by anyone forever. `@kyrve/nox` will not return
a decrypted value without the handle derived from the caller's own sealed operation graph.

## Documentation

| Where | What |
|---|---|
| [`docs/phase1/`](docs/phase1/) | This phase: gate, deltas, security, testing, toolchain, licence |
| [`docs/day0/`](docs/day0/) | Validation evidence and the operation budget |
| [`kyrve-production-prd-v1.1.md`](kyrve-production-prd-v1.1.md) | Normative amendment; wins over v1.0 |
| [`AGENTS.md`](AGENTS.md) | Orientation for contributors |
