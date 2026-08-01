/**
 * The confidential half of a page, and what stands in its place when no wallet has answered.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A COMPONENT AND NOT A REDIRECT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every route in `/app` has a public half — what this deployment is, which contracts it names, what
 * the flow does — and a confidential half that structurally cannot work without a wallet.
 * `Nox.fromExternal` binds an input proof to the wallet that is the DIRECT CALLER, so there is no
 * read-only mode and no relayer that could stand in. That is a protocol fact, not a product choice.
 *
 * Redirecting an unconnected visitor to a connect screen would hide the public half and teach them
 * nothing about what they are about to authorise. So the page renders, the confidential half names
 * what it needs, and the connect action lives where the reader already is.
 *
 * The state is `waiting-for-wallet`, which is one of the thirteen the lifecycle vocabulary requires —
 * not an error, and not a spinner.
 */

import type { ReactElement, ReactNode } from "react";

import { useKyrve } from "../lib/context.js";
import type { Session } from "../lib/session.js";

export interface RequiresWalletProps {
  /** What the confidential half is for, in a noun phrase: "read your own balance". */
  readonly purpose: string;
  readonly children: (session: Session) => ReactNode;
  readonly testId?: string;
}

export function RequiresWallet({ purpose, children, testId }: RequiresWalletProps): ReactElement {
  const { session, walletState, walletFailure, connect } = useKyrve();

  if (session !== undefined) return <>{children(session)}</>;

  return (
    <section
      className="wallet-gate"
      data-testid={testId ?? "requires-wallet"}
      data-phase="waiting-for-wallet"
      aria-busy={walletState === "connecting"}
    >
      <div>
        <p className="eyebrow">Wallet required</p>
        <h2>Connect to {purpose}</h2>
        <p className="lede">
          {walletState === "ended"
            ? "This session ended and every decrypted value was cleared from memory. Your wallet keeps each grant it already held because Nox cannot withdraw one."
            : "Kyrve binds every encrypted input to the wallet that submits it. The public context above is available without a wallet."}
        </p>
        {walletFailure === undefined ? null : (
          <p className="note" role="alert">
            {walletFailure}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void connect()}
        disabled={walletState === "connecting"}
        data-testid="requires-wallet-connect"
      >
        {walletState === "connecting"
          ? "Waiting for the wallet…"
          : walletState === "ended"
            ? "Reconnect"
            : "Connect wallet"}
      </button>
    </section>
  );
}
