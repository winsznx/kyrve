# Cloudflare runtime gate — PASS

Executed 2026-07-28. Reproduce:
```bash
cd spikes/cloudflare && pnpm install
npx wrangler deploy --dry-run --outdir dist
npx vitest run
```

No Cloudflare account authentication was used or required. The `cloudflare-api`,
`cloudflare-bindings`, `cloudflare-builds` and `cloudflare-observability` MCP servers are
**unauthenticated in this session**, so no account-level fact was verified.

## 1. Deploy dry-run

```
Total Upload: 647.57 KiB / gzip: 131.41 KiB
env.NONCE_ALLOCATOR (NonceAllocator)      Durable Object
env.QUOTE_FLOW (QuoteLifecycleWorkflow)   Workflow
env.INDEX_JOBS (kyrve-index-jobs)         Queue
env.DB (kyrve-projection)                 D1 Database
env.EVENTS (kyrve-events)                 R2 Bucket
env.SEPOLIA_RPC_URL                       Environment Variable
```

All six bindings resolve. Bundle is 4.4% of the free-plan ceiling.

## 2. viem under workerd — UNVERIFIED → PROVEN

Bundle inspection of `dist/index.js`:

| Check | Result |
|---|---|
| `[unenv] … is not implemented yet!` markers | **0** |
| Residual `node:` builtin imports | **0** |
| `viem/node` IPC surface (`getIpcRpcClient`, `mainnetTrustedSetupPath`) | **absent** |

Runtime execution inside workerd via `@cloudflare/vitest-pool-workers` — **6/6 pass**, including a
live `eth_chainId` + `eth_blockNumber` returning chain 11155111, and an address-filtered
`eth_getLogs` with ABI decoding.

**Public RPC choice is load-bearing.** `ethereum-sepolia-rpc.publicnode.com` rejects `eth_getLogs`
as an archive request even over 5 blocks; `1rpc.io/sepolia` caps at 50 blocks; `sepolia.drpc.org`
serves 200-block ranges. Pin a provider deliberately and treat this as an operational dependency.

## 3. Config correctness

`wrangler.jsonc` validated against `node_modules/wrangler/config-schema.json`, which is
authoritative over the docs prose. Keys that the prose omits or misstates and that are used here:
`durable_objects.bindings[].name` (**not** `binding`), `observability.traces`, `limits.subrequests`,
`workflows[].limits.steps`.

`@cloudflare/vitest-pool-workers@0.19.0` has **removed `defineWorkersConfig`**. The spike uses the
`cloudflareTest` Vite plugin. Any snippet showing `poolOptions.workers` is out of date.

`wrangler@4.115.0` declares `engines.node >= 22.0.0`; Cloudflare doc pages still claiming 16.17 or
18 are stale. Running Node 24.14.1.

## 4. Workflow shape

`QuoteLifecycleWorkflow` models the real lifecycle: observe request → poll handle readiness with
`step.sleep` → allocate a nonce through the Durable Object **before** any submission → record
activation in D1 → return an R2 key rather than a payload (1 MiB step-return cap).

Step names are deterministic because they are memoisation keys. Handle-readiness polling in the
spike is simulated — **this is not Nox runtime proof**; that comes from
[`NOX-RUNTIME-GATE.md`](NOX-RUNTIME-GATE.md).

## 5. Privacy audit of the built bundle

Searched `dist/index.js` for `decrypt`, `mandate`, `allocation`, `plaintext`, `PRIVATE_KEY`,
`secretKey`, `mnemonic` — **all zero**. (`privateKey` matches 38 times inside viem's own account
helpers; no Kyrve value is involved.)

Nothing decrypted enters D1, R2, Queues, Workflow state, logs or responses. The Worker indexes only
public chain data, handles, statuses and cursors.

## 6. Not done

- No deployment, no account API call, no `wrangler login`.
- Storage stress test at realistic ingestion volume was **not run** — reorg replacement, batch
  ingestion under concurrent reads, index rebuild and pagination remain unmeasured.
- Queue consumer and `scheduled` handler are implemented and bundle cleanly but were not exercised
  end to end under load.

## Verdict

**PASS** for runtime compatibility, configuration correctness and the viem question. Storage
behaviour under load is deferred to Phase 1 with a defined test plan.
