/**
 * API Worker — the read edge.
 *
 * PHASE 1 SCOPE. Health, version and configuration verification, plus a live chain check that
 * proves the Worker can actually reach the deployment it claims to serve. There is no quote
 * endpoint, no curve endpoint and no position endpoint, because the contracts backing them do not
 * exist yet.
 *
 * PRIVACY. This Worker will, in later phases, serve data derived from the confidential engine. The
 * boundary is established now: it indexes and returns handles, proofs, statuses, public amounts and
 * receipts only. A decrypted value must never reach a server, a log line, a metric label, a
 * database column or an error message (.claude/rules/security.md). Nothing in Phase 1 handles a
 * decrypted value at all.
 *
 * STORAGE. D1 holds a bounded queryable projection — cursors, a block-partition index and quote
 * status. Full event history lives in R2 partitioned by block range, because D1 caps at 10 GB and
 * is single-threaded per database (PRD v1.1 A-13).
 */

import { embeddedDeployment } from "@kyrve/generated";

import {
  configReport,
  failure,
  healthReport,
  identityFrom,
  json,
  notFound,
  type WorkerEnvBase,
} from "@kyrve/worker-core";
import { createPublicClient, http } from "viem";

const SERVICE = "api";
const ROUTES = ["/health", "/version", "/config", "/chain"] as const;

export interface Env extends WorkerEnvBase {
  /** Bounded projection only. Never the full event history. */
  readonly DB?: D1Database;
  /** Block-range partitioned event history and content-addressed proof bundles. */
  readonly EVENTS?: R2Bucket;
  /**
   * Provider endpoint. A SECRET in every environment: provider API keys live in the URL path, so
   * this is set with `wrangler secret put` and never appears in `vars` or in any response.
   */
  readonly KYRVE_RPC_URL?: string;
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
          return json(configReport(identity));

        case "/chain":
          return await chainStatus(identity.environment, env);

        default:
          return notFound(SERVICE, ROUTES);
      }
    } catch (error) {
      return failure(SERVICE, error);
    }
  },
};

/**
 * Proves the Worker can reach the chain its embedded deployment names, and that the chain agrees.
 *
 * The RPC URL is never echoed. A mismatched chain id is reported as a failure rather than served
 * alongside data, because an API answering from the wrong chain is worse than one that is down.
 */
async function chainStatus(environment: string, env: Env): Promise<Response> {
  const deployment = embeddedDeployment(environment);

  if (env.KYRVE_RPC_URL === undefined || env.KYRVE_RPC_URL.length === 0) {
    return json(
      {
        service: SERVICE,
        reachable: false,
        reason:
          "KYRVE_RPC_URL is not configured. It is a secret, set with `wrangler secret put`, " +
          "because provider API keys live in the URL path.",
        expectedChainId: deployment.chainId,
      },
      503,
    );
  }

  const client = createPublicClient({ transport: http(env.KYRVE_RPC_URL), cacheTime: 0 });
  const chainId = await client.getChainId();

  if (chainId !== deployment.chainId) {
    return json(
      {
        service: SERVICE,
        reachable: true,
        chainIdMatches: false,
        observedChainId: chainId,
        expectedChainId: deployment.chainId,
        reason:
          "the configured RPC serves a different chain than this build's embedded deployment. " +
          "Refusing to report healthy: serving from the wrong chain is worse than being down.",
      },
      503,
    );
  }

  const blockNumber = await client.getBlockNumber();

  return json({
    service: SERVICE,
    reachable: true,
    chainIdMatches: true,
    chainId,
    headBlock: blockNumber.toString(),
    deploymentBlock: deployment.deploymentBlock,
    midnight: deployment.contracts["Midnight"],
    manifestHash: deployment.manifestHash,
  });
}
