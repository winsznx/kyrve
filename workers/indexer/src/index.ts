/**
 * Indexer Worker — the ingestion shell.
 *
 * PHASE 1 SCOPE. Health, version, configuration verification and honest index freshness. **No
 * indexing runs.** The `scheduled` and `queue` handlers are present, wired and typed so the
 * conventions are proven by `wrangler deploy --dry-run`, but they perform no ingestion: the
 * confidential engine whose events they would index does not exist yet.
 *
 * The freshness endpoint reports `not-started`, never `0 blocks behind`. Those are opposite
 * conditions — "nothing has ever run" versus "perfectly caught up" — and rendering them identically
 * is precisely how a dead indexer goes unnoticed.
 *
 * OPERATIONAL CONSTRAINTS, all measured in Day 0 and binding here:
 *   - the Cloudflare Free plan cannot cover one block of indexing: 50 subrequests per invocation,
 *     counting D1 and R2 calls, not just RPC. Workers Paid is required (PRD v1.1 A-13);
 *   - `eth_getLogs` range limits are a property of the PROVIDER, not the chain, so the range is
 *     configuration rather than a constant (THREAT-MODEL T-9);
 *   - cron carries no delivery guarantee, so `scheduled` reconciles forward from a stored cursor
 *     and a missed tick is harmless by construction (PRD v1.1 A-20).
 */

import {
  configReport,
  failure,
  healthReport,
  type IndexFreshness,
  identityFrom,
  json,
  notFound,
  PHASE1_INDEX_FRESHNESS,
  type WorkerEnvBase,
} from "@kyrve/worker-core";

const SERVICE = "indexer";
const ROUTES = ["/health", "/version", "/config", "/index/state"] as const;

export interface IndexJob {
  readonly fromBlock: string;
  readonly toBlock: string;
}

export interface Env extends WorkerEnvBase {
  readonly DB?: D1Database;
  readonly EVENTS?: R2Bucket;
  readonly INDEX_JOBS?: Queue<IndexJob>;
  readonly KYRVE_RPC_URL?: string;
  /** Provider-dependent. drpc serves 200; publicnode refuses archive; 1rpc caps at 50. */
  readonly KYRVE_LOG_RANGE?: string;
}

/**
 * Reads the cursor and reports freshness honestly.
 *
 * Returns `not-started` when no cursor row exists, which in Phase 1 is always. It never
 * manufactures a zero.
 */
async function readFreshness(env: Env): Promise<IndexFreshness> {
  if (env.DB === undefined) return PHASE1_INDEX_FRESHNESS;

  const row = await env.DB.prepare("SELECT value FROM cursors WHERE name = ?")
    .bind("head")
    .first<{ value: string }>()
    .catch(() => null);

  if (row === null || row === undefined) return PHASE1_INDEX_FRESHNESS;

  // A cursor exists but Phase 1 never advances one; reported as-is rather than interpreted.
  return {
    state: "stale",
    cursorBlock: row.value,
    headBlock: "unknown",
    blocksBehind: -1,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      const identity = identityFrom(env, SERVICE);

      switch (url.pathname) {
        case "/health":
          return json(healthReport(identity));

        case "/version":
          return json({
            service: identity.service,
            version: identity.version,
            environment: identity.environment,
            phase: "phase-1-substrate",
          });

        case "/config":
          return json(configReport(identity, await readFreshness(env)));

        case "/index/state":
          return json({
            service: SERVICE,
            freshness: await readFreshness(env),
            logRange: Number.parseInt(env.KYRVE_LOG_RANGE ?? "200", 10),
            storage: {
              history: "R2, partitioned by block range",
              projection: "D1, bounded: cursors, block-partition index, quote status",
              note:
                "D1 is not the event store. 10 GB hard cap, single-threaded per database, " +
                "100 bound parameters per query, 1,000 queries per invocation.",
            },
          });

        default:
          return notFound(SERVICE, ROUTES);
      }
    } catch (error) {
      return failure(SERVICE, error);
    }
  },

  /**
   * Cron reconciliation. Phase 1 performs no ingestion.
   *
   * The shape is the point: Cloudflare publishes no delivery guarantee for cron, so this must
   * always reconcile forward from the stored cursor rather than assume it fired. Implementing it
   * as fire-and-forget now would bake in a bug that only appears under a missed tick.
   */
  async scheduled(_controller: ScheduledController, _env: Env): Promise<void> {
    // Intentionally empty in Phase 1. When ingestion lands it reads the cursor, enqueues the
    // outstanding block range, and never assumes the previous tick ran.
    return;
  },

  /**
   * Queue consumer. Phase 1 acknowledges nothing because nothing is produced.
   *
   * Messages are NOT acked here: acking a message this build cannot process would silently discard
   * work. Letting them retry and eventually reach the dead-letter queue is the honest behaviour.
   */
  async queue(_batch: MessageBatch<IndexJob>, _env: Env): Promise<void> {
    return;
  },
};
