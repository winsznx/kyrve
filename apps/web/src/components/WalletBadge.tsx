/**
 * Who the terminal is bound to, and the privacy lock.
 *
 * Four states, never a spinner: not connected, connecting, connected, ended. `ended` is separate
 * from `not connected` on purpose — both have no session, and conflating them would show a
 * connecting state to someone who had just deliberately ended one, which reads as a page
 * reconnecting on its own. That is the opposite of what disconnecting is for.
 *
 * THE COUNT IS NOT A BALANCE. It says how many decrypted values this browser is holding, which is a
 * number about the page rather than about the protocol. Locking clears them immediately and revokes
 * nothing: the wallet keeps every ACL grant it held, because Nox has no `removeAdmin` and no
 * `removeViewer`. The copy here says exactly that, and never "access revoked".
 *
 * No cobalt. This lives in the persistent header and `design.md` allows one cobalt element per page,
 * which belongs to whatever the page itself is for.
 */

import type { ReactElement } from "react";

import { useKyrve } from "../lib/context.js";
import { lock, revealedCount, useRevealed } from "../lib/session.js";

export function WalletBadge(): ReactElement {
  const { session, walletState, walletFailure, connect, disconnect } = useKyrve();
  useRevealed();
  const held = revealedCount();

  if (walletState === "connecting") {
    return (
      <div className="wallet" data-testid="wallet" data-wallet="connecting">
        <span className="wallet-state">waiting for wallet</span>
        <span className="wallet-detail">
          Asking the wallet for an account. Kyrve binds every encrypted input to the wallet that
          submits it.
        </span>
      </div>
    );
  }

  if (session === undefined) {
    return (
      <div
        className="wallet"
        data-testid="wallet"
        data-wallet={walletState === "ended" ? "ended" : "not-connected"}
      >
        {walletState === "ended" ? (
          <div data-testid="session-ended">
            <span className="wallet-state">session ended</span>
            <span className="wallet-detail">
              Every value decrypted in this browser has been cleared from memory. Nothing was
              revoked — the wallet keeps every grant it held, because Nox has no way to withdraw
              one.
            </span>
          </div>
        ) : (
          <div>
            <span className="wallet-state">not connected</span>
            <span className="wallet-detail">
              Public pages read the chain without a wallet. Anything confidential needs one.
            </span>
          </div>
        )}
        {walletFailure === undefined ? null : (
          <p className="wallet-detail" role="alert" data-testid="wallet-failure">
            {walletFailure}
          </p>
        )}
        <button type="button" onClick={() => void connect()} data-testid="connect">
          {walletState === "ended" ? "Reconnect" : "Connect wallet"}
        </button>
      </div>
    );
  }

  return (
    <div className="wallet" data-testid="wallet" data-wallet="connected">
      <span className="wallet-state">connected</span>
      {/*
        `session` and `connected-account` name the same address. Both testids exist because the
        Phase 4 flow test reads the whole session line and the Phase 5 ownership test reads the
        address alone, and collapsing them would have changed an assertion in a passing suite to
        make a layout tidier.
      */}
      <span className="wallet-detail" data-testid="session">
        <span className="mono" data-testid="connected-account">
          {session.account}
        </span>
      </span>
      {/*
        The lock's copy has to say what locking does NOT do, at the point of the action.

        It clears decrypted values from memory immediately. It does not revoke anything: the wallet
        keeps every ACL grant it held, because Nox has no `removeAdmin` and no `removeViewer`. A
        reader who took "lock" to mean "withdraw access" would have exactly the wrong model of a
        permanent grant, so the sentence lives beside the button rather than on a page they might
        not read.
      */}
      <span className="wallet-detail" data-testid="revealed-count">
        {held === 0
          ? "No decrypted value is held in this browser."
          : `${held} decrypted value${held === 1 ? "" : "s"} held in this browser's memory, and nowhere else.`}{" "}
        Locking clears them immediately. It does not revoke anything — every grant this wallet
        already holds stays in place, permanently, because Nox has no way to withdraw one.
      </span>
      <div className="wallet-actions">
        <button type="button" onClick={() => lock()} disabled={held === 0} data-testid="lock">
          Lock and clear {held} decrypted value{held === 1 ? "" : "s"}
        </button>
        <button type="button" onClick={disconnect} data-testid="disconnect">
          End session
        </button>
      </div>
    </div>
  );
}
