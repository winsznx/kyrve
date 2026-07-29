/**
 * Progress and failure, named rather than spun.
 *
 * `.claude/rules/frontend.md`: a loading state must name the actual async phase — input proof
 * submitted, event confirmed, runner queued, output stored, decryption ready — never one
 * indefinite spinner. And an error must distinguish a public transaction failure from an invalid
 * proof, a pending Nox output, a public invariant failure, a private no-fill, and a service being
 * unavailable, because those tell the user to do six different things.
 *
 * A private no-fill in particular must never say WHICH provider or rule caused it. There is no
 * variant here that could, because a no-fill has no reason to report — the encrypted branch
 * contributed zero and no public reason exists.
 */

export type Phase =
  | "idle"
  | "encrypting"
  | "awaiting-signature"
  | "submitted"
  | "confirmed"
  | "runner-queued"
  | "decryption-ready"
  | "done";

const PHASE_COPY: Record<Phase, string> = {
  idle: "",
  encrypting: "Encrypting locally and requesting an input proof from the Nox gateway",
  "awaiting-signature": "Waiting for you to sign in your wallet",
  submitted: "Transaction submitted; waiting for it to be included",
  confirmed: "Included on chain; the Nox ingestor is picking up the event",
  "runner-queued": "The off-chain runner is computing; polling the gateway for readiness",
  "decryption-ready": "Handle is ready; requesting the key material for this wallet",
  done: "Done",
};

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
        {failure.detail !== undefined ? <div className="phase">{failure.detail}</div> : null}
      </div>
    );
  }

  if (phase === "idle") return null;

  return (
    <div className="status" role="status" data-testid={testId} data-phase={phase}>
      <span className="phase">{phase}</span> — {PHASE_COPY[phase]}
    </div>
  );
}

/**
 * Classifies a raw failure into one of the six kinds above.
 *
 * Defaults to `public-transaction` rather than to something reassuring: an unrecognised failure is
 * more likely to be a real refusal than a transient hiccup, and telling a user to "try again" when
 * the chain rejected them wastes their time and their gas.
 */
export function classifyFailure(error: unknown): { kind: FailureKind; detail: string } {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const detail = message.slice(0, 300);

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
