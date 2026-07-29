/**
 * Handle readiness and the polling policy Kyrve actually uses.
 *
 * TWO FACTS DRIVE THIS FILE.
 *
 * 1. **There is no callback into the contract.** An on-chain call returns a result handle
 *    immediately; the computation is off-chain and asynchronous. Readiness is discovered only by
 *    polling `POST {gateway}/v0/public/handles/status` — an endpoint used by the Hardhat plugin
 *    but absent from both the SDK and the documentation. It is treated as unstable and wrapped
 *    here so a breaking change is a one-file fix.
 *
 * 2. **The SDK's built-in retry gives up after roughly 7 seconds.** Measured local readiness has
 *    a p90 of 492 ms, but testnet latency is UNVERIFIED (AS-1) and the two testnets run different
 *    contract versions and KMS keys. A 7-second give-up is not a policy Kyrve can adopt; this
 *    module implements real backoff bounded by the stage timeout.
 */

import { OPERATION_BUDGET } from "@kyrve/config";

import type { Handle, NoxNetwork } from "./types.js";

export type HandleState = "unknown" | "pending" | "ready" | "failed";

export interface HandleStatus {
  readonly handle: Handle;
  readonly state: HandleState;
  /** Present only when the gateway reports a terminal failure. */
  readonly reason?: string;
}

export class NoxGatewayError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "NoxGatewayError";
  }
}

/**
 * Classifies a failure as retryable or terminal.
 *
 * This matters beyond tidiness: Cloudflare Workflows retry steps by default, and retrying a
 * terminal failure burns the whole retry budget before the real error surfaces. Terminal failures
 * must be raised as `NonRetryableError` at the Workflow boundary.
 */
export function classifyFailure(status: number, body: string): NoxGatewayError {
  if (status === 429 || status >= 500) {
    return new NoxGatewayError(`gateway ${status}: ${body}`, true);
  }
  if (status === 404) {
    // An unknown handle is normal immediately after submission: the ingestor may not have seen it.
    return new NoxGatewayError(`gateway 404 (handle not yet known): ${body}`, true);
  }
  return new NoxGatewayError(`gateway ${status} (terminal): ${body}`, false);
}

/**
 * Parses whatever shape the undocumented status endpoint returns into a known state.
 *
 * THE SHAPE THE REAL GATEWAY ACTUALLY RETURNS, measured against nox-handle-gateway 0.6.0 in
 * Phase 2 and recorded as delta Q-3:
 *
 *     { "payload": { "statuses": [ { "handle": "0x…", "resolved": true } ] } }
 *
 * The Day 0 implementation guessed `{state}` / `{status}` / `{ready}` from the endpoint's name and
 * never met a live gateway, so every real response fell through to `unknown` and every wait would
 * have run to timeout. The guessed shapes are kept because the endpoint is absent from both the SDK
 * and the documentation and may change again; the measured shape is now first and is the one under
 * test.
 *
 * @param handle when supplied, a `statuses` array is filtered to that handle. Without it the first
 *        entry is used, which is correct for the single-handle polls this module performs.
 */
export function parseHandleState(raw: unknown, handle?: Handle): HandleState {
  if (typeof raw === "string") return normalise(raw);
  if (raw === null || typeof raw !== "object") return "unknown";

  const record = raw as Record<string, unknown>;

  const payload = record["payload"];
  const container = (payload !== null && typeof payload === "object" ? payload : record) as Record<
    string,
    unknown
  >;
  const statuses = container["statuses"];
  if (Array.isArray(statuses)) {
    const entries = statuses.filter(
      (entry): entry is Record<string, unknown> => entry !== null && typeof entry === "object",
    );
    const match =
      handle === undefined
        ? entries[0]
        : entries.find(
            (entry) =>
              typeof entry["handle"] === "string" &&
              (entry["handle"] as string).toLowerCase() === handle.toLowerCase(),
          );
    if (match === undefined) return "unknown";
    if (match["resolved"] === true) return "ready";
    if (match["resolved"] === false) return "pending";
    const state = match["state"] ?? match["status"];
    if (typeof state === "string") return normalise(state);
    return "unknown";
  }

  for (const key of ["state", "status", "handleStatus"]) {
    const value = record[key];
    if (typeof value === "string") return normalise(value);
  }
  if (record["ready"] === true) return "ready";
  if (record["ready"] === false) return "pending";
  return "unknown";
}

function normalise(value: string): HandleState {
  const lower = value.toLowerCase();
  if (["ready", "resolved", "available", "computed", "done"].includes(lower)) return "ready";
  if (["pending", "processing", "queued", "unresolved", "computing"].includes(lower))
    return "pending";
  if (["failed", "error", "rejected"].includes(lower)) return "failed";
  return "unknown";
}

export interface PollPolicy {
  /** First delay. Measured local p50 readiness is 468 ms, so a shorter first poll is wasted. */
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly multiplier: number;
  /** Total wall clock before giving up. Defaults to the measured stage timeout. */
  readonly timeoutMs: number;
}

/**
 * Kyrve's policy, NOT the SDK's ~7 s give-up.
 *
 * `timeoutMs` defaults to the operation budget's per-stage timeout, which is a 10x margin on the
 * measured local p90 of 492 ms. Testnet is unmeasured, so callers driving a real testnet epoch
 * should raise it explicitly rather than discovering the limit in production.
 */
export const DEFAULT_POLL_POLICY: PollPolicy = {
  initialDelayMs: 250,
  maxDelayMs: 2_000,
  multiplier: 2,
  timeoutMs: OPERATION_BUDGET.runnerTimeoutPerStageMs,
};

/** The exact delay sequence a policy produces, so backoff is testable without waiting. */
export function backoffSchedule(policy: PollPolicy = DEFAULT_POLL_POLICY): number[] {
  const delays: number[] = [];
  let delay = policy.initialDelayMs;
  let elapsed = 0;
  while (elapsed + delay <= policy.timeoutMs) {
    delays.push(delay);
    elapsed += delay;
    delay = Math.min(Math.round(delay * policy.multiplier), policy.maxDelayMs);
  }
  return delays;
}

export type StatusTransport = (
  url: string,
  handles: readonly Handle[],
) => Promise<{ status: number; body: string }>;

/** Default transport. Isolated so tests never need a live gateway and neither does the SDK. */
export const fetchTransport: StatusTransport = async (url, handles) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handles }),
  });
  return { status: response.status, body: await response.text() };
};

export function statusUrl(network: NoxNetwork): string {
  return `${network.gatewayUrl.replace(/\/+$/, "")}/v0/public/handles/status`;
}

export interface WaitOptions {
  readonly policy?: PollPolicy;
  readonly transport?: StatusTransport;
  /** Injected so tests do not sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export class HandleNotReadyError extends Error {
  constructor(handle: Handle, elapsedMs: number, attempts: number) {
    super(
      `handle ${handle} was still not ready after ${elapsedMs}ms across ${attempts} polls. ` +
        "Nox provides no callback, so this is the only way readiness is discovered; raise the " +
        "poll timeout for testnet, where latency is UNVERIFIED (AS-1).",
    );
    this.name = "HandleNotReadyError";
  }
}

/** Polls one handle to readiness with real backoff. Throws on terminal failure or timeout. */
export async function waitForHandle(
  network: NoxNetwork,
  handle: Handle,
  options: WaitOptions = {},
): Promise<HandleStatus> {
  const policy = options.policy ?? DEFAULT_POLL_POLICY;
  const transport = options.transport ?? fetchTransport;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const delays = backoffSchedule(policy);
  const url = statusUrl(network);
  let elapsed = 0;

  for (const [attempt, delay] of delays.entries()) {
    const { status, body } = await transport(url, [handle]);

    if (status >= 400) {
      const error = classifyFailure(status, body);
      if (!error.retryable) throw error;
    } else {
      const state = parseHandleState(safeParse(body), handle);
      if (state === "ready") return { handle, state };
      if (state === "failed") {
        return { handle, state, reason: "gateway reported a terminal computation failure" };
      }
    }

    await sleep(delay);
    elapsed += delay;

    if (attempt === delays.length - 1) {
      throw new HandleNotReadyError(handle, elapsed, delays.length);
    }
  }

  throw new HandleNotReadyError(handle, elapsed, delays.length);
}

function safeParse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
