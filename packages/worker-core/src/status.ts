/**
 * The status contract every Kyrve Worker implements.
 *
 * PHASE 1 SCOPE, and the reason this file is small: these Workers expose health, version and
 * configuration verification. Nothing else. There is no quote endpoint, no curve data, no
 * position data and no protocol metric, because none of those exist yet — and a Worker that
 * returned a plausible-looking zero would be indistinguishable from one that worked.
 *
 * `indexFreshness` is the one field that could tempt a lie. It reports `not-started` in Phase 1
 * rather than `0 blocks behind`, because "no indexer has ever run" and "the indexer is perfectly
 * caught up" are opposite conditions that must never render the same.
 *
 * PRIVACY. Nothing here touches a decrypted value, a Nox handle paired with plaintext, a mandate,
 * an allocation or a provider identity. Only public chain data, public addresses, build metadata
 * and cursors are ever reported. See .claude/rules/security.md.
 */

import { type EmbeddedDeployment, embeddedDeployment } from "@kyrve/generated";

export type IndexFreshness =
  /** No indexing has been performed. Phase 1 always reports this. */
  | { readonly state: "not-started"; readonly reason: string }
  /** Indexing has run and the cursor is known. */
  | {
      readonly state: "tracking";
      readonly cursorBlock: string;
      readonly headBlock: string;
      readonly blocksBehind: number;
    }
  /** Indexing ran but the cursor is stale beyond tolerance. */
  | {
      readonly state: "stale";
      readonly cursorBlock: string;
      readonly headBlock: string;
      readonly blocksBehind: number;
    };

export interface WorkerIdentity {
  /** `api`, `indexer`, `keeper`, `status`. */
  readonly service: string;
  /** Build version, injected as a Wrangler var so it is visible without a redeploy guess. */
  readonly version: string;
  /** `local` or `sepolia`. Selects which embedded deployment is authoritative. */
  readonly environment: string;
}

export interface ConfigReport {
  readonly service: string;
  readonly version: string;
  readonly environment: string;
  readonly chainId: number;
  readonly manifestHash: string;
  readonly deploymentBlock: string;
  readonly midnightRelease: string;
  readonly midnightCommit: string;
  readonly supportedDeployment: {
    readonly midnight: string;
    readonly registry: string;
    readonly osakaProbe: string;
    readonly verifiedContracts: number;
    readonly totalContracts: number;
  };
  readonly markets: ReadonlyArray<{ key: string; id: string; rateGridHash: string }>;
  readonly indexFreshness: IndexFreshness;
  /** Stated explicitly so a reader never has to infer it from an absence of endpoints. */
  readonly phase: string;
  readonly disclosure: string;
}

export const PHASE1_INDEX_FRESHNESS: IndexFreshness = {
  state: "not-started",
  reason:
    "Phase 1 deploys the substrate only. No indexing has run, so no cursor exists. This is " +
    "reported as not-started rather than as zero blocks behind, because those are opposite " +
    "conditions and must never render identically.",
};

const DISCLOSURE =
  "Kyrve is open-source software integrating an unmodified, source-available Morpho Midnight " +
  "testnet replica under its applicable non-production licence. This deployment is not an " +
  "official Morpho deployment and is not maintained by Morpho Association.";

export function configReport(
  identity: WorkerIdentity,
  freshness: IndexFreshness = PHASE1_INDEX_FRESHNESS,
): ConfigReport {
  const deployment: EmbeddedDeployment = embeddedDeployment(identity.environment);

  const contract = (name: string): string => {
    const address = deployment.contracts[name];
    if (address === undefined) {
      throw new Error(
        `the ${identity.environment} deployment has no ${name}. The embedded record is incomplete; ` +
          "run `pnpm generate` after deploying.",
      );
    }
    return address;
  };

  return {
    service: identity.service,
    version: identity.version,
    environment: identity.environment,
    chainId: deployment.chainId,
    manifestHash: deployment.manifestHash,
    deploymentBlock: deployment.deploymentBlock,
    midnightRelease: deployment.midnightRelease,
    midnightCommit: deployment.midnightCommit,
    supportedDeployment: {
      midnight: contract("Midnight"),
      registry: contract("KyrveProtocolRegistry"),
      osakaProbe: contract("KyrveOsakaProbe"),
      verifiedContracts: deployment.verifiedSourceCount,
      totalContracts: Object.keys(deployment.contracts).length,
    },
    markets: deployment.markets,
    indexFreshness: freshness,
    phase: "phase-1-substrate",
    disclosure: DISCLOSURE,
  };
}

export interface HealthReport {
  readonly ok: boolean;
  readonly service: string;
  readonly version: string;
  readonly environment: string;
  readonly runtime: "workerd";
}

export function healthReport(identity: WorkerIdentity): HealthReport {
  return {
    ok: true,
    service: identity.service,
    version: identity.version,
    environment: identity.environment,
    runtime: "workerd",
  };
}

export interface WorkerEnvBase {
  readonly KYRVE_ENVIRONMENT?: string;
  readonly KYRVE_VERSION?: string;
}

/**
 * Reads identity from Wrangler vars, refusing rather than guessing.
 *
 * A Worker that silently defaulted to `local` while bound to Sepolia resources would report
 * confident, wrong addresses — the single most dangerous failure mode for a config endpoint.
 */
export function identityFrom(env: WorkerEnvBase, service: string): WorkerIdentity {
  const environment = env.KYRVE_ENVIRONMENT;
  if (environment === undefined || environment.length === 0) {
    throw new Error(
      `KYRVE_ENVIRONMENT is not set for the ${service} Worker. It is not defaulted: a Worker that ` +
        "assumed an environment would report confident, wrong addresses.",
    );
  }
  return { service, environment, version: env.KYRVE_VERSION ?? "0.0.0-dev" };
}

/** JSON response with no caching — every field here is a live assertion about this build. */
export function json(body: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function notFound(service: string, routes: readonly string[]): Response {
  return json(
    {
      error: "not found",
      service,
      // Phase 1 exposes exactly these. Listing them makes the narrow scope obvious.
      availableRoutes: routes,
      phase: "phase-1-substrate",
    },
    404,
  );
}

/** Uniform error shape. Never includes a stack, an env value or an upstream URL. */
export function failure(service: string, error: unknown, status = 500): Response {
  return json(
    {
      error: error instanceof Error ? error.message : "unknown error",
      service,
      phase: "phase-1-substrate",
    },
    status,
  );
}
