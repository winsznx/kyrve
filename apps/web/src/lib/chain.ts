/**
 * Reading the chain, with a lifecycle state instead of a spinner.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY EVERY PAGE GOES THROUGH THIS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Nineteen routes read chain state, and each one has to distinguish "the node has not answered yet"
 * from "the node answered and there is nothing there" from "the node could not be reached". Those are
 * three different renders — pending, an honest empty state, and `unavailable` — and a page that
 * collapsed the last two would report a dead node as an absent series.
 *
 * So a read returns `{ state, value, error }` and never a bare value with a boolean beside it. The
 * `unavailable` verdict is load-bearing (P7-4) and this is where it enters the interface.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * NO CACHE, DELIBERATELY
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The public client is created with `cacheTime: 0` and nothing here memoises a result across a
 * remount. A proof page that served a cached value would be displaying a record again, which is
 * exactly what P7-4 says a verification page must not do — the moment a fact comes from a store
 * rather than from the chain, it is a manifest with extra steps.
 */

import { useCallback, useEffect, useState } from "react";

import type { LifecycleState } from "./lifecycle.js";
import { safeErrorMessage } from "./redact.js";

export interface ChainRead<T> {
  readonly state: LifecycleState;
  readonly value: T | undefined;
  /** Redacted. Never carries an RPC credential, however viem formatted the failure. */
  readonly error: string | undefined;
  /** Re-runs the read. Every page that shows chain state offers this explicitly. */
  readonly refresh: () => void;
}

/**
 * Runs an async read and tracks its lifecycle.
 *
 * `deps` is threaded through to the effect, so a route parameter change re-reads rather than showing
 * the previous subject's numbers under the new subject's heading. The read is cancelled on unmount by
 * a flag rather than an AbortController, because viem's transport does not take one and a stale
 * `setState` after navigation is the actual failure being prevented.
 */
export function useChainRead<T>(read: () => Promise<T>, deps: readonly unknown[]): ChainRead<T> {
  const [state, setState] = useState<LifecycleState>("idle");
  const [value, setValue] = useState<T>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  /*
   * `read` is deliberately not a dependency, and `attempt` deliberately is.
   *
   * `read` is a fresh closure on every render, so depending on it would re-run this effect forever.
   * The caller declares what the read actually depends on, which is the only thing that can be
   * declared correctly here. `attempt` is the explicit refresh trigger — the linter cannot see that
   * a counter nothing inside the effect reads is exactly how a manual re-run is expressed.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: explained directly above.
  useEffect(() => {
    let live = true;
    setState("transaction-pending");
    setError(undefined);
    void (async () => {
      try {
        const result = await read();
        if (!live) return;
        setValue(result);
        setState("done");
      } catch (failure) {
        if (!live) return;
        setValue(undefined);
        setError(safeErrorMessage(failure));
        // NOT `failed`. A read that could not reach the node has measured nothing, and calling that
        // a failure would tell the reader the protocol refused them.
        setState("unavailable");
      }
    })();
    return () => {
      live = false;
    };
  }, [...deps, attempt]);

  return { state, value, error, refresh };
}

/** `0xabcdef…123456`. For identifiers only; never applied to an amount. */
export function abbreviate(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`;
}

/** Whole units of a token, for display only. Never used in a calculation. */
export function formatAmount(raw: bigint | string, decimals: number): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  if (decimals === 0) return value.toLocaleString("en-GB");
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === 0n) return whole.toLocaleString("en-GB");
  const padded = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-GB")}.${padded}`;
}

/** A UTC timestamp, because a market's maturity is a timestamp and a local rendering hides that. */
export function formatTimestamp(secondsSinceEpoch: bigint | string): string {
  const seconds =
    typeof secondsSinceEpoch === "bigint" ? secondsSinceEpoch : BigInt(secondsSinceEpoch);
  const millis = Number(seconds * 1000n);
  if (!Number.isFinite(millis)) return String(secondsSinceEpoch);
  return `${new Date(millis).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

/** Whether a unix deadline has passed, judged against the chain's own clock where one is supplied. */
export function hasExpired(expiry: bigint, now: bigint): boolean {
  return expiry !== 0n && expiry <= now;
}
