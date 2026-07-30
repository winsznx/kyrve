/**
 * Progress and failure, named rather than spun.
 *
 * `.claude/rules/frontend.md`: a loading state must name the actual async phase — input proof
 * submitted, event confirmed, runner queued, output stored, decryption ready — never one indefinite
 * spinner. And an error must distinguish a public transaction failure from an invalid proof, a
 * pending Nox output, a public invariant failure, a private no-fill, and a service being unavailable,
 * because those tell the reader to do six different things.
 *
 * A private no-fill in particular must never say WHICH provider or rule caused it. There is no
 * variant here that could: a no-fill has no reason to report, because the encrypted branch
 * contributed zero and no public reason exists.
 *
 * THE STATE VOCABULARY IS `lib/lifecycle.ts` AND NOTHING ELSE. This component renders whatever is in
 * that union and cannot render anything outside it, which is how a fourteenth ad-hoc state fails to
 * compile rather than shipping as a string nobody wrote copy for.
 *
 * EVERY DETAIL PASSES THROUGH `safeErrorMessage` FIRST. viem serialises the whole request into a
 * transport error, URL included, and U-F1 is what that cost in Phase 6 when it reached stdout twice
 * from two different scripts. In a browser it would reach the DOM, and from there a screenshot.
 */

import { isPending, LIFECYCLE_COPY, type LifecycleState } from "../lib/lifecycle.js";
import { safeErrorMessage } from "../lib/redact.js";

/** Retained name. The vocabulary is the lifecycle union; this alias keeps existing call sites valid. */
export type Phase = LifecycleState;

export type FailureKind =
  | "public-transaction"
  | "invalid-proof"
  | "pending-nox-output"
  | "public-invariant"
  | "private-no-fill"
  | "service-unavailable"
  | "not-authorised";

const FAILURE_COPY: Record<FailureKind, { readonly title: string; readonly guidance: string }> = {
  "public-transaction": {
    title: "The transaction was rejected on chain",
    guidance:
      "A public rule refused it — a pause, a wrong nonce, a replayed handle or a stale epoch. The " +
      "reason is public and is shown below.",
  },
  "invalid-proof": {
    title: "The input proof was refused",
    guidance:
      "NoxCompute rejected the proof itself. A proof binds owner, application contract, chain and " +
      "a one-hour expiry; if you have been on this page for a while, encrypt again.",
  },
  "pending-nox-output": {
    title: "The encrypted result is not ready yet",
    guidance:
      "The off-chain runner has not finished. Nox gives no callback, so readiness is only ever " +
      "discovered by polling. Nothing is lost — try again shortly.",
  },
  "public-invariant": {
    title: "A public invariant failed",
    guidance: "The protocol refused this because a publicly checkable rule would have been broken.",
  },
  "private-no-fill": {
    title: "No fill",
    guidance:
      "The confidential computation produced nothing for this request. No public reason exists, " +
      "and none can be produced: a private rejection must never become a public oracle.",
  },
  "service-unavailable": {
    title: "A service is unavailable",
    guidance:
      "The chain or the Nox handle gateway did not answer. This is availability, not authorisation " +
      "— nothing about your data was disclosed or lost.",
  },
  "not-authorised": {
    title: "This wallet is not authorised to decrypt that value",
    guidance:
      "Nox checks authorisation on chain before releasing any key material. Nothing about the " +
      "value leaks from the refusal.",
  },
};

export interface StatusProps {
  readonly phase: Phase;
  readonly failure?: { readonly kind: FailureKind; readonly detail?: string } | undefined;
  readonly testId?: string;
}

export function Status({ phase, failure, testId }: StatusProps): React.ReactElement | null {
  if (failure !== undefined) {
    const copy = FAILURE_COPY[failure.kind];
    return (
      <div className="status error" role="alert" data-testid={testId} data-failure={failure.kind}>
        <strong>{copy.title}</strong>
        <div>{copy.guidance}</div>
        {failure.detail === undefined ? null : (
          <div className="phase">{safeErrorMessage(failure.detail)}</div>
        )}
      </div>
    );
  }

  if (phase === "idle") return null;

  const copy = LIFECYCLE_COPY[phase];
  return (
    <div
      className="status"
      role="status"
      aria-busy={isPending(phase)}
      data-testid={testId}
      data-phase={phase}
      data-state={copy.label}
    >
      <span className="phase">{copy.label}</span> — {copy.detail}
    </div>
  );
}

/**
 * Classifies a raw failure into one of the seven kinds above.
 *
 * Defaults to `public-transaction` rather than to something reassuring: an unrecognised failure is
 * more likely to be a real refusal than a transient hiccup, and telling someone to "try again" when
 * the chain rejected them wastes their time and their gas.
 */
export function classifyFailure(error: unknown): { kind: FailureKind; detail: string } {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const detail = safeErrorMessage(message);

  if (error instanceof Error && error.name === "NotAuthorisedToDecryptError") {
    return { kind: "not-authorised", detail };
  }
  if (lower.includes("still not ready") || lower.includes("not yet computed")) {
    return { kind: "pending-nox-output", detail };
  }
  if (
    lower.includes("invalid proof") ||
    lower.includes("proof expired") ||
    lower.includes("owner mismatch") ||
    lower.includes("app mismatch") ||
    lower.includes("invalid signature")
  ) {
    return { kind: "invalid-proof", detail };
  }
  if (lower.includes("fetch") || lower.includes("network") || lower.includes("econnrefused")) {
    return { kind: "service-unavailable", detail };
  }
  return { kind: "public-transaction", detail };
}
