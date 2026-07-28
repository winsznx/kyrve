---
description: Cloudflare runtime constraints and wrangler.jsonc discipline
globs: ["workers/**", "apps/**", "wrangler.jsonc", "**/wrangler.jsonc", "vitest.config.*"]
---

# Cloudflare

`wrangler.jsonc` is the deployment source of truth. The authoritative reference for key names is
**`node_modules/wrangler/config-schema.json`**, not the docs prose — the prose omits or misstates
several keys. Always set `"$schema": "./node_modules/wrangler/config-schema.json"`.

## Version facts

- `wrangler@4.115.0` requires **Node >= 22.0.0** (`engines`). Doc pages claiming 16.17 or 18 are
  stale; pin CI to the `engines` value.
- `@cloudflare/vitest-pool-workers@0.19.0` **removed `defineWorkersConfig`**. Use the
  `cloudflareTest` Vite plugin. Any snippet showing `poolOptions.workers` is out of date.
- `viem` in `workerd` is **not officially attested**. Before relying on it, prove it with
  `wrangler deploy --dry-run --outdir dist` and grep for `[unenv] … is not implemented yet!`.
  Never import `viem/node` — it is IPC/filesystem only.

## Key names that are easy to get wrong

`durable_objects.bindings[].name` (**not** `binding`) · `queues.producers[]` / `queues.consumers[]` ·
`d1_databases[]` · `r2_buckets[]` · `workflows[]` (supports `schedules` and `limits.steps`) ·
`triggers.crons` · `services[]` · `tail_consumers[]` · `observability` (has a `traces` sub-key) ·
`limits.subrequests` · `assets.not_found_handling`.

## Limits that actually bite

- **Subrequests: 50 on Free, 10,000 on Paid.** D1 and R2 calls count against the same budget as RPC
  calls. **The Free plan is not viable for an indexer.**
- **6 simultaneous connections** awaiting response headers. Cap RPC fan-out at 6.
- **D1: 10 GB hard cap, single-threaded per database**, 100 bound params per query, 1,000 queries per
  invocation. **Not the primary store for a blockchain event index** — put bulk data in R2
  partitioned by block range and keep a bounded queryable projection in D1.
- **Workflow step return: 1 MiB hard.** Return R2 keys, never payloads. Exceeding it fails the step.
- Wall clock 15 min for cron, queue consumers and DO alarms. Backfills must be checkpointed.
- R2: 1 write/sec per object key — content-address, never hot-write a mutable `latest` key.
- Cron minimum interval is 1 minute with **no documented delivery guarantee**. Always
  checkpoint-and-reconcile from a stored cursor; never fire-and-forget.

## Orchestration

Use **Workflows** for the poll-until-ready-then-submit loop: durable steps, per-step retry with
backoff, and `step.sleep` at zero concurrency cost. Steps are memoised by name, so name them
deterministically — never with a timestamp or random value.

Use a **Durable Object** for the one thing Workflows cannot do: serialising Ethereum nonce
allocation per signing key. Transaction submission is non-idempotent and Workflows retry by default,
so pre-sign with an explicit nonce and check whether it is already pending before submitting. Use
`NonRetryableError` for terminal reverts.

## Discipline

- `wrangler deploy --dry-run --outdir dist` in CI — validates and compiles, publishes nothing,
  needs no authentication.
- Secrets via `wrangler secret put`, never in `vars` and never in the repo. Note it deploys a new
  version immediately.
- Do not use Cloudflare Pages — it lacks cron triggers, queue consumers and observability.
