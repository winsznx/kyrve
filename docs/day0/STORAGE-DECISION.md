# Storage decision

**Decision: Option B — R2 for full event history, D1 for a bounded projection.**

PRD §21.3 specifies PostgreSQL. The operated infrastructure runs on Cloudflare Workers, and D1
cannot substitute for PostgreSQL here. This records the decision and why.

## Why D1 cannot hold the event history

| Limit | Value | Consequence |
|---|---|---|
| Max database size | **10 GB** (paid) | Millions of event rows with topics, data and indexes exhaust it |
| Threading | **single-threaded per database** | Indexer writes contend with API reads on one thread |
| Bound parameters per query | 100 | ~10 rows per insert statement at 10 columns |
| Queries per invocation | 1,000 | caps ingestion near 10,000 rows per invocation |

## The split

- **R2** — full event history, partitioned by block range (`blocks/<from>-<to>/events.json`), plus
  content-addressed proof bundles. Objects are immutable; R2 permits only 1 write/sec per key, so a
  mutable `latest` key is never used.
- **D1** — cursors, block-partition index, quote status. Bounded and queryable. Migrations in
  `spikes/cloudflare/migrations/`.
- **Durable Object** — the one thing Workflows cannot do: serialise Ethereum nonce allocation per
  signing key, so a Workflow retry cannot double-submit a transaction.

## Consequences

- **The Cloudflare Free plan is not viable.** 50 subrequests per invocation — counting D1 and R2
  calls, not just RPC — cannot cover one block of indexing. Budget Workers Paid from day one.
- RPC fan-out is capped at 6 (simultaneous connections awaiting response headers).
- Cron carries **no documented delivery guarantee**, so `scheduled` always reconciles forward from
  the stored cursor rather than assuming it fired.
- Workflow step returns are capped at 1 MiB, so steps return R2 keys, never payloads.

Proven in `spikes/cloudflare/` — 6/6 workerd tests and a clean `wrangler deploy --dry-run`.
