/**
 * Who you are, which wallet you are holding, and the way out of both.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE ROLE IS IN A MENU. THE WALLET IS NOT.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A role is chosen once and changed rarely, so it folds away. Connection state is the opposite: it
 * changes under the reader, it decides whether the next click will work, and — because locking is
 * the control that clears decrypted values from the screen — it must never be one click further away
 * than the thing it protects. So the wallet line and its two actions stay visible and the role
 * switcher folds.
 *
 * That also keeps `lock`, `disconnect`, `session`, `connected-account` and `session-ended` in the
 * DOM without a preceding interaction, which is what the Phase 2, 4 and 5 browser suites reach for.
 * This is an information-architecture correction; hiding the things four passing suites assert on
 * would have made it a rewrite of proven flows.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * A ROLE IS A LENS, NEVER A PERMISSION
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Nothing here gates a route or hides a capability. Switching from provider to auditor changes which
 * actions are offered first and nothing else — every surface stays addressable. A reader who
 * suspects a role is locking them out will hunt for the escape hatch instead of doing the task.
 */

import { type ReactElement, useState } from "react";

import { useKyrve } from "../lib/context.js";
import { ROLE_COPY, ROLES, type Role } from "../lib/role.js";
import { lock, revealedCount, useRevealed } from "../lib/session.js";

/** The short name a header can carry. `ROLE_COPY.label` is the imperative used on the role cards. */
const SHORT: Readonly<Record<Role, string>> = {
  provider: "Capital provider",
  borrower: "Borrower",
  auditor: "Auditor",
};

export function RoleBadge(): ReactElement {
  const { session, walletState, walletFailure, connect, disconnect, role, chooseRole } = useKyrve();
  const [open, setOpen] = useState(false);
  useRevealed();
  const held = revealedCount();

  return (
    <div className="account">
      <div className="account-line">
        <button
          type="button"
          className="account-trigger"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          data-testid="account-menu"
        >
          {role === undefined ? "Choose a role" : SHORT[role]}
        </button>

        <span className="account-wallet" data-testid="wallet" data-wallet={walletState}>
          {session === undefined
            ? walletState === "connecting"
              ? "waiting for wallet"
              : walletState === "ended"
                ? "session ended"
                : "not connected"
            : "connected"}
        </span>
      </div>

      {session === undefined ? (
        <div className="account-line">
          {walletState === "ended" ? (
            <span className="account-note" data-testid="session-ended">
              Decrypted values cleared. Nothing was revoked — every grant this wallet holds stays in
              place, permanently.
            </span>
          ) : null}
          {walletFailure === undefined ? null : (
            <span className="account-note" role="alert" data-testid="wallet-failure">
              {walletFailure}
            </span>
          )}
          <button type="button" onClick={() => void connect()} data-testid="connect">
            {walletState === "ended" ? "Reconnect" : "Connect wallet"}
          </button>
        </div>
      ) : (
        <>
          <span className="account-note" data-testid="session">
            <span className="mono" data-testid="connected-account">
              {session.account}
            </span>
          </span>
          <span className="account-note" data-testid="revealed-count">
            {held === 0
              ? "No decrypted value is held in this browser."
              : `${held} decrypted value${held === 1 ? "" : "s"} held in this browser's memory, and nowhere else.`}{" "}
            Locking clears them immediately. It does not revoke anything — every grant this wallet
            already holds stays in place, permanently, because Nox has no way to withdraw one.
          </span>
          <div className="account-line">
            <button type="button" onClick={() => lock()} disabled={held === 0} data-testid="lock">
              Lock and clear {held} decrypted value{held === 1 ? "" : "s"}
            </button>
            <button type="button" onClick={disconnect} data-testid="disconnect">
              End session
            </button>
          </div>
        </>
      )}

      {open ? (
        <div className="account-menu" data-testid="account-panel">
          <p className="eyebrow">You are working as</p>
          <ul className="account-roles">
            {ROLES.map((option) => (
              <li key={option}>
                <button
                  type="button"
                  className={option === role ? "role-option role-option-active" : "role-option"}
                  onClick={() => {
                    chooseRole(option);
                    setOpen(false);
                  }}
                  data-testid={`switch-role-${option}`}
                  {...(option === role ? { "aria-current": "true" as const } : {})}
                >
                  <strong>{SHORT[option]}</strong>
                  <span>{ROLE_COPY[option].promise}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="account-note">
            A role changes which actions are offered first. It grants nothing and hides nothing —
            every page stays reachable whichever you choose.
          </p>
        </div>
      ) : null}
    </div>
  );
}
