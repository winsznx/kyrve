# Source lock

Machine-readable form: [`source-lock.json`](../../source-lock.json). This document records **how**
each entry was obtained and **why that source is authoritative**, so any reviewer can reproduce it.

Retrieved 2026-07-28 (UTC). Rule: package source and repository source outrank documentation prose;
live chain state outranks both.

## Ethereum Sepolia

| Fact | Value | Why authoritative |
|---|---|---|
| chainId | 11155111 | `eth_config` on a public node |
| Active fork | **Osaka** | Executable proof, not inference — see [`evidence/sepolia-osaka.md`](evidence/sepolia-osaka.md) |
| Client observed | `Geth/v1.17.1-stable` | `web3_clientVersion` |

Reproduce:
```bash
curl -s -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_config","params":[]}' \
  https://ethereum-sepolia-rpc.publicnode.com | jq .
```
This matters because the pinned Midnight release compiles with `evm_version = "osaka"`. Had Sepolia
not been on Osaka, PRD §3.1 would have been unachievable without modifying the release.

## Morpho Midnight

| Fact | Value |
|---|---|
| Release | `2026-07-23` (exists; PRD claim confirmed) |
| Commit | `dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0` |
| Commit subject | `callback max buyer assets (#1073)` |
| Default branch / HEAD at audit | `main` / `4ab59c43242a9a9422f3d01cd06074c56108bb63` |
| Submodules | `forge-std` `620536fa` (v1.16.1), `morpho-blue` `528ccf43` |
| Compiler | solc **0.8.34** (0.8.19 for `test/imports/MorphoImport.sol`) |
| Foundry | `via_ir`, optimizer on, `optimizer_runs = 466`, `bytecode_hash = "none"`, `evm_version = "osaka"` |
| Formal specs | `certora/` (CVL) and `rocq/` present in-repo |
| Official Sepolia deployment | **None.** Kyrve deploys its own unmodified replica. |

Authoritative because it is the release tag itself, pinned as a git submodule at the exact commit,
with submodule revisions cross-checked against the repo's own `foundry.lock`.

Reproduce:
```bash
git submodule update --init --recursive
git -C vendor/midnight describe --tags --exact-match   # -> 2026-07-23
git -C vendor/midnight submodule status --recursive
forge build                                            # compiles clean
```

`bytecode_hash = "none"` is significant: it makes compiled output independent of metadata, which is
what makes the `verify:midnight-bytecode` command in PRD §31 achievable at all.

## iExec Nox

Deployment facts were taken from **live chain state**, because
`docs.noxprotocol.io/getting-started/networks` renders its address table client-side and the served
HTML contains no addresses.

| Fact | Value |
|---|---|
| `NoxCompute` proxy (Sepolia) | `0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF` |
| Proxy type / code size | ERC-1967, 89 bytes |
| Implementation | `0xc9B5D2e99e45dc652b3B90bA5FA79667ACFEb819` |
| Gateway signer | `0xE13191F53671957C8a48A7A3Ff15E16450a1552F` |
| Supported networks | Ethereum Sepolia (11155111), Arbitrum Sepolia (421614), Hardhat local (31337). **No mainnet.** |

Reproduce:
```bash
N=0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF
cast code  $N --rpc-url https://ethereum-sepolia-rpc.publicnode.com | wc -c
cast storage $N 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com   # EIP-1967 impl slot
cast call  $N "gateway()(address)" --rpc-url https://ethereum-sepolia-rpc.publicnode.com
```

Package versions and integrity hashes are in `source-lock.json`, obtained via `npm view <pkg> --json`
and cross-checked by extracting the published tarballs with `npm pack`. Registry metadata alone was
**not** treated as authoritative — the licence field is wrong for
`@iexec-nox/nox-protocol-contracts` (see [`LICENSE-MATRIX.md`](LICENSE-MATRIX.md)).

Two facts that constrain the architecture and were verified directly against `sdk/Nox.sol@0.2.4`:

- The complete callable surface is: `add sub mul div safeAdd safeSub safeMul safeDiv eq ne lt le gt
  ge select transfer mint burn toEbool toEuint16 toEuint256 toEint16 toEint256 fromExternal
  publicDecrypt` plus ACL functions. **There is no `and`/`or`/`not`/`xor`/`min`/`max`/`rem`/shift.**
- `select` is overloaded for `euint16`, `euint256`, `eint16`, `eint256` — **but not for `ebool`.**

Reproduce:
```bash
npm pack @iexec-nox/nox-protocol-contracts@0.2.4 && tar xzf *.tgz
grep -oE '^\s*function [a-zA-Z0-9_]+' package/contracts/sdk/Nox.sol | awk '{print $2}' | sort -u
```

## Cloudflare and JS toolchain

| Package | Version | Note |
|---|---|---|
| `wrangler` | 4.115.0 | `engines.node >= 22.0.0` — **the doc pages stating 16.17/18 are stale**; the `engines` field binds |
| `@cloudflare/vite-plugin` | 1.48.0 | peer `wrangler ^4.115.0` |
| `@cloudflare/vitest-pool-workers` | 0.19.0 | peer `vitest ^4.1.0`; **`defineWorkersConfig` has been removed** in favour of a `cloudflareTest` Vite plugin |
| `viem` | 2.55.10 | declares no `engines`; workerd support **UNVERIFIED** |

Config format is `wrangler.jsonc`, and the authoritative schema for key names is
`node_modules/wrangler/config-schema.json` — not the documentation prose, which omits or misstates
several keys (`durable_objects.bindings[].name` is `name`, not `binding`; `observability.traces`,
`limits.subrequests` and `workflows[].schedules` all exist in the schema).

## Known-unverified

Carried forward to `docs/day0/PRD-DELTA.md` and the verdict:

- Contents of `morpho-midnight-license-grants.morpho.eth` (BUSL Additional Use Grant).
- `viem` executing inside `workerd` — structural evidence only; the bundle probe did not run.
- Nox per-operation gas costs — no published figures exist, and no batch API exists.
- Nox local Docker stack — not exercised (host disk exhausted).
