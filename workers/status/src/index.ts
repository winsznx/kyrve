/**
 * Status Worker — the smallest possible surface, and the reference implementation of the Phase 1
 * Worker contract.
 *
 * It holds no bindings at all. That is deliberate: it can answer "which build is running, against
 * which deployment" even when D1, R2, the Queue or the chain are unavailable, which is exactly
 * when that question matters most.
 *
 * PHASE 1 SCOPE. Health, version and configuration verification. No protocol data, no metrics, no
 * quote surface — none of that exists yet, and an endpoint returning a plausible zero would be
 * indistinguishable from one that worked.
 */

import {
  configReport,
  failure,
  healthReport,
  identityFrom,
  json,
  notFound,
  type WorkerEnvBase,
} from "@kyrve/worker-core";

const SERVICE = "status";
const ROUTES = ["/health", "/version", "/config"] as const;

export interface Env extends WorkerEnvBase {}

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

        default:
          return notFound(SERVICE, ROUTES);
      }
    } catch (error) {
      // A missing KYRVE_ENVIRONMENT reaches here. Reported as a failure rather than defaulted,
      // because a Worker that guessed its environment would serve confident, wrong addresses.
      return failure(SERVICE, error);
    }
  },
};
