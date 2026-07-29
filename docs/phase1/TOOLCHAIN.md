# Toolchain

Machine-readable: [`../../toolchain-lock.json`](../../toolchain-lock.json), verified by
`pnpm verify:toolchain`, which fails on any mismatch and on any caret, tilde or range anywhere in
the workspace.

| Component | Version | Why this one |
|---|---|---|
| Node | 24.14.1 (`.nvmrc`), min 22.0.0 | `wrangler@4.115.0` declares `engines.node >= 22`. Doc pages claiming 16.17 or 18 are stale; the `engines` field binds. |
| pnpm | 10.33.0 | `packageManager` field; `save-exact=true` in `.npmrc` |
| solc (Kyrve) | 0.8.34, `osaka`, `via_ir`, runs 466, `bytecode_hash = "none"` | Matches the pinned Midnight release exactly, which is what makes runtime-bytecode comparison meaningful |
| solc (Nox) | 0.8.36, `cancun` | The Nox SDK requires >= 0.8.35 and NoxCompute targets cancun. Kept in a separate Hardhat profile and never mixed with the settlement path. |
| Foundry | forge 1.7.1 @ `4072e487` | Pinned by commit, not just version |
| TypeScript | 5.9.3 | **Not** 7.0.2. TS 7 is the published `latest`, but its compatibility with `hardhat@3.11.1` and `@cloudflare/vitest-pool-workers@0.19.0` type surfaces is UNVERIFIED. 5.9.3 is what every pinned dependency was published against. |
| vitest | 4.1.0 | **Not** 4.1.10. `@cloudflare/vitest-pool-workers@0.19.0` peer-requires `^4.1.0`, and 4.1.0 is the exact version Day 0 proved 6/6 workerd tests against. |
| biome | 2.5.6 | Single tool for lint and format across TS and JSON |
| wrangler | 4.115.0 | Config schema at `node_modules/wrangler/config-schema.json` is authoritative over docs prose |
| Workers compatibility date | 2026-07-28 | With `nodejs_compat` |

## Two pins that refuse the newest release

Both are recorded because "why is this not on latest?" is the first question a reader asks, and the
answer is the same in each case: the newest version is not the one the surrounding stack was proven
against, and upgrading it is a decision requiring an executable check, not a default.

Revisit TypeScript only with a clean `tsc --build` across every workspace *and* a green
`pnpm test:workers`. Revisit vitest only with a green workerd run.

## Things that are easy to get wrong

- `durable_objects.bindings[].name` — **not** `binding`. The docs prose has this wrong; the schema
  is authoritative.
- `@cloudflare/vitest-pool-workers@0.19.0` **removed** `defineWorkersConfig`. Use the
  `cloudflareTest` Vite plugin. Any snippet showing `poolOptions.workers` is out of date.
- `forge inspect <contract> <field>` emits a **bare hex string**, not JSON — including under
  `--json`, where the output is unquoted and unparseable.
- Foundry leaves artifacts for **deleted** contracts in `out/`. Generation rebuilds from scratch;
  otherwise bindings appear for contracts that no longer exist.
- viem caches `getBlockNumber` for `cacheTime` ms. A readiness probe will poison a later read and
  write a stale block into a manifest. Every client here sets `cacheTime: 0`.
- Solidity embeds immutables in **runtime** bytecode, so on-chain code never matches a freshly
  compiled template byte-for-byte without masking `immutableReferences`.
- `biome.json` is parsed as strict JSON: no comments, no unknown keys. Biome also rewrites
  `!path/**` to `!path` when formatting its own config.

## Recorded environment

```
Node      24.14.1        pnpm    10.33.0
forge     1.7.1          solc    0.8.34 (Kyrve) / 0.8.36 (Nox)
Docker    running        Nox service images all 0.6.0
chain     Ethereum Sepolia (11155111), Osaka fork
```
