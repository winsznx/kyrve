/**
 * Keeper Worker — orchestration shell, and the home of the quote lifecycle Workflow.
 *
 * WHY THE WORKFLOW LIVES HERE. A Cloudflare Workflow class must be exported from a Worker
 * entrypoint and bound to that script; it cannot exist as a free-standing package. Rather than
 * create an empty `workers/workflows/` directory to match a diagram, the Workflow is defined in the
 * Worker that owns it and the decision is recorded here.
 *
 * PHASE 1 SCOPE. Health, version and configuration verification. The Workflow and the nonce
 * Durable Object are defined, bound and type-checked so `wrangler deploy --dry-run` proves the
 * conventions, but **no epoch is driven and no transaction is signed**. The keeper has no signing
 * key in Phase 1.
 *
 * THE TWO CONSTRAINTS THAT SHAPE THIS FILE (PRD v1.1 A-20):
 *
 *   1. Workflows retry steps by default and `eth_sendRawTransaction` is NOT idempotent. A nonce
 *      must therefore be allocated through a Durable Object BEFORE the submitting step, so a retry
 *      re-uses the same nonce instead of broadcasting a second transaction.
 *   2. Workflow step names are memoisation keys. A step name containing a timestamp or a random
 *      value silently breaks resumption, so every step name here is derived deterministically from
 *      the request id and a stage index.
 *
 * A key placed in a Worker secret is a HOT WALLET: anyone with deploy rights can exfiltrate it.
 * Value ceilings and target allowlists must be enforced on chain, never in the Worker
 * (.claude/rules/security.md).
 */

import {
  DurableObject,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

import {
  configReport,
  failure,
  healthReport,
  identityFrom,
  json,
  notFound,
  type WorkerEnvBase,
} from "@kyrve/worker-core";

const SERVICE = "keeper";
const ROUTES = ["/health", "/version", "/config", "/epoch/plan"] as const;

export interface QuoteParams {
  readonly requestId: string;
  readonly handle: string;
}

export interface Env extends WorkerEnvBase {
  readonly DB?: D1Database;
  readonly NONCE_ALLOCATOR?: DurableObjectNamespace<NonceAllocator>;
  readonly QUOTE_FLOW?: Workflow<QuoteParams>;
}

/**
 * Serialises Ethereum nonce allocation for one signing key.
 *
 * This is the one thing Workflows cannot do. Strong consistency and single-threaded execution are
 * exactly what a nonce counter needs, and a Durable Object is the only primitive here that
 * provides both.
 */
export class NonceAllocator extends DurableObject {
  async allocate(signer: string): Promise<number> {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS nonces (signer TEXT PRIMARY KEY, next INTEGER NOT NULL)",
    );
    const row = this.ctx.storage.sql
      .exec<{ next: number }>("SELECT next FROM nonces WHERE signer = ?", signer)
      .toArray()[0];
    const next = row?.next ?? 0;
    this.ctx.storage.sql.exec(
      "INSERT INTO nonces (signer, next) VALUES (?, ?) ON CONFLICT(signer) DO UPDATE SET next = ?",
      signer,
      next + 1,
      next + 1,
    );
    return next;
  }

  /** Read-only, for the config surface. Allocating from a status endpoint would burn nonces. */
  async peek(signer: string): Promise<number> {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS nonces (signer TEXT PRIMARY KEY, next INTEGER NOT NULL)",
    );
    const row = this.ctx.storage.sql
      .exec<{ next: number }>("SELECT next FROM nonces WHERE signer = ?", signer)
      .toArray()[0];
    return row?.next ?? 0;
  }
}

/**
 * The quote lifecycle. Phase 1 defines the shape and drives nothing.
 *
 * Step names are deterministic because they are memoisation keys. `stepName` exists so that
 * property is enforced by construction rather than by remembering.
 */
export class QuoteLifecycleWorkflow extends WorkflowEntrypoint<Env, QuoteParams> {
  async run(event: WorkflowEvent<QuoteParams>, step: WorkflowStep): Promise<unknown> {
    const { requestId } = event.payload;

    // Deterministic: request id plus a stage index. Never a timestamp, never a random value.
    const stepName = (stage: string, index: number): string => `${requestId}:${stage}:${index}`;

    const observed = await step.do(stepName("observe", 0), async () => ({
      requestId,
      phase: "phase-1-substrate",
      note: "Phase 1 drives no epoch. The confidential curve engine arrives in Phase 2.",
    }));

    // Deliberately NOT implemented in Phase 1: handle-readiness polling, nonce allocation and
    // submission. Sketching them with placeholder logic would create a Workflow that appears to
    // work while doing nothing, which is worse than one that plainly does not exist yet.
    return { requestId: observed.requestId, completed: false, reason: "phase-1-substrate" };
  }
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

        case "/epoch/plan":
          // Reports the measured budget this keeper will plan against. No epoch is driven.
          return json({
            service: SERVICE,
            driving: false,
            reason: "Phase 1 deploys the substrate only; no confidential epoch exists to drive.",
            budget: {
              transactionGasCeiling: 24_000_000,
              maxCellsPerTransaction: 311,
              recommendedChunkCells: 256,
              epochTimeoutMs: 15 * 60 * 1000,
              note:
                "Measured against the real local Nox stack in Day 0. See " +
                "docs/day0/OPERATION-BUDGET.md and Phase 1 delta P-1.",
            },
            idempotency: {
              nonceAllocation: "Durable Object, allocated BEFORE the submitting step",
              stepNames: "deterministic; they are memoisation keys",
              terminalReverts: "NonRetryableError",
            },
          });

        default:
          return notFound(SERVICE, ROUTES);
      }
    } catch (error) {
      return failure(SERVICE, error);
    }
  },
};
