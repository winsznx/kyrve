/**
 * The lifecycle vocabulary. Every state a Kyrve screen may be in, and not one bare string.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A CLOSED SET
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Kyrve's latency comes from a confidential computation with no callback. A page that renders
 * "Loading…" over that is not being terse — it is hiding the only thing the reader needs: whether the
 * wallet has not answered, the transaction has not been mined, the runner has not finished, or the
 * whole thing failed twenty seconds ago. Those require four different actions.
 *
 * The union below is the union of two lists that had to agree: the async phases `design.md` names
 * ("input proof submitted", "event confirmed", "runner queued", "decryption ready") and the thirteen
 * states Phase 7 was specified to distinguish. `REQUIRED_STATES` is the second list, exported so the
 * gate can prove every one is reachable from real code rather than merely declared here.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE FOUR TERMINAL STATES ARE NOT INTERCHANGEABLE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   failed       refused, and the reason is public. Retrying may work.
 *   expired      a deadline passed. Nothing was refused; the window closed. Retrying will not work.
 *   cancelled    withdrawn deliberately, and a bond came back.
 *   unavailable  Kyrve could not check. NOT a pass and NOT a fail — the third verdict P7-4 requires.
 *
 * `unavailable` is the one that gets collapsed by accident. A page showing "failed" because the node
 * timed out has told the reader the protocol refused them, which is a different and worse statement.
 */

export type LifecycleState =
  | "idle"
  // ── waiting on someone or something ─────────────────────────────────────────────────────────
  | "waiting-for-wallet"
  | "encrypting"
  | "awaiting-signature"
  | "transaction-pending"
  | "handle-pending"
  | "runner-queued"
  | "computation-running"
  | "decryption-ready"
  // ── something definite happened, and it was not the end ─────────────────────────────────────
  | "encrypted-input-accepted"
  | "event-confirmed"
  | "proof-ready"
  | "quote-activated"
  // ── the end ─────────────────────────────────────────────────────────────────────────────────
  | "settlement-complete"
  | "done"
  | "failed"
  | "expired"
  | "cancelled"
  | "unavailable";

/**
 * The thirteen Phase 7 was specified to distinguish.
 *
 * `idle`, `encrypting`, `event-confirmed` and `done` are excluded: `idle` is the absence of a state,
 * `done` is the generic completion a flow uses when no protocol-shaped terminal state applies — a
 * wrap finishing is not a settlement completing — and the other two are `design.md` refinements
 * inside states already on the list.
 */
export const REQUIRED_STATES: readonly LifecycleState[] = [
  "waiting-for-wallet",
  "awaiting-signature",
  "transaction-pending",
  "encrypted-input-accepted",
  "handle-pending",
  "computation-running",
  "proof-ready",
  "quote-activated",
  "settlement-complete",
  "failed",
  "expired",
  "cancelled",
  "unavailable",
];

export interface StateCopy {
  /** Short label, shown in the status line. Lowercase: it is a state, not a headline. */
  readonly label: string;
  /** What is happening, and what the reader can do. Never reassurance. */
  readonly detail: string;
  /** True while Kyrve is waiting on something. Drives `aria-busy`, never a spinner alone. */
  readonly pending: boolean;
}

export const LIFECYCLE_COPY: Readonly<Record<LifecycleState, StateCopy>> = {
  idle: { label: "ready", detail: "Nothing is in flight.", pending: false },

  "waiting-for-wallet": {
    label: "waiting for wallet",
    detail:
      "No wallet has answered yet. Kyrve binds every encrypted input to the wallet that submits it, " +
      "so there is no read-only mode that could stand in for one.",
    pending: true,
  },
  encrypting: {
    label: "encrypting",
    detail:
      "Encrypting locally and requesting an input proof from the Nox gateway. The plaintext does not " +
      "leave this browser.",
    pending: true,
  },
  "awaiting-signature": {
    label: "waiting for signature",
    detail:
      "The transaction is built and waiting for you to sign it in your wallet. Nothing has been " +
      "broadcast.",
    pending: true,
  },
  "transaction-pending": {
    label: "transaction pending",
    detail: "Broadcast, and waiting to be included in a block.",
    pending: true,
  },
  "handle-pending": {
    label: "handle pending",
    detail:
      "The handle exists but the off-chain runner has not produced its value yet. Nox gives no " +
      "callback, so readiness is only discovered by polling — nothing is lost while it waits.",
    pending: true,
  },
  "runner-queued": {
    label: "runner queued",
    detail:
      "The off-chain runner has the work and has not returned. The gateway is being polled for " +
      "readiness because Nox provides no callback.",
    pending: true,
  },
  "computation-running": {
    label: "computation running",
    detail:
      "The confidential engine is executing this epoch's stages. Every primitive is a separate " +
      "transaction, so this advances in visible steps rather than all at once.",
    pending: true,
  },
  "decryption-ready": {
    label: "decryption ready",
    detail:
      "The handle is ready. Requesting the key material for this wallet, and only this wallet.",
    pending: true,
  },

  "encrypted-input-accepted": {
    label: "encrypted input accepted",
    detail:
      "The input proof was accepted on chain and the handle is registered. The value itself never " +
      "left this browser in plaintext.",
    pending: false,
  },
  "event-confirmed": {
    label: "event confirmed",
    detail: "Included on chain, and the Nox ingestor has picked the event up.",
    pending: true,
  },
  "proof-ready": {
    label: "proof ready",
    detail:
      "The gateway has released a plaintext with a decryption proof. That proof is a signature over " +
      "a released value, not a zero-knowledge proof.",
    pending: false,
  },
  "quote-activated": {
    label: "quote activated",
    detail:
      "One quote is executable. The selected market, the selected rate and the aggregate amount are " +
      "public from this moment; the curve behind them is not.",
    pending: false,
  },

  "settlement-complete": {
    label: "settlement complete",
    detail:
      "The offer was taken through unmodified Midnight at the exact units. The credit position is " +
      "public; who owns how much of it is not.",
    pending: false,
  },
  done: {
    label: "done",
    detail: "Finished, and the page has re-read the chain rather than assuming the result.",
    pending: false,
  },
  failed: {
    label: "failed",
    detail:
      "Something was refused and the refusal is public. It is shown verbatim below, with the " +
      "credential in any URL redacted.",
    pending: false,
  },
  expired: {
    label: "expired",
    detail:
      "A deadline passed. Nothing was refused and nothing failed — the window closed. Retrying the " +
      "same thing will not reopen it.",
    pending: false,
  },
  cancelled: {
    label: "cancelled",
    detail: "Withdrawn deliberately, before it could be used.",
    pending: false,
  },
  unavailable: {
    label: "unavailable",
    detail:
      "Kyrve could not check this. It is not a pass and it is not a failure — reporting it as either " +
      "would state something nobody measured.",
    pending: false,
  },
};

/** Whether the page should mark itself busy for assistive technology. */
export function isPending(state: LifecycleState): boolean {
  return LIFECYCLE_COPY[state].pending;
}
