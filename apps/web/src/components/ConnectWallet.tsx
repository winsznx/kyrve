/**
 * The connect control, rendered as Kyrve rather than as RainbowKit.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY `ConnectButton.Custom` AND NOT THE DEFAULT BUTTON
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * RainbowKit's default button is a well-made control that belongs to a different design system: it
 * has its own radii, its own weights and its own colour. Dropped into this header it would be the
 * one element on the page that came from somewhere else, and on a product whose whole argument is
 * restraint that reads as a seam.
 *
 * `ConnectButton.Custom` gives the connection state and the modal openers, and nothing else. The
 * markup below is the same pill, the same Ash-to-Ivory hierarchy and the same copy discipline as
 * every other control here.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * FOUR STATES, AND THE WRONG-NETWORK ONE IS NOT AN ERROR
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   not connected   says WHY a wallet is needed, never a bare "Connect wallet"
 *   wrong network   an action, not a failure — the user is one click from correct
 *   connected       address, network and the account modal
 *   unsupported     the connector could not be reached; named rather than swallowed
 *
 * `.claude/rules/frontend.md` requires that a control say what it does. "Connect wallet" with no
 * reason is the most common wallet-UX defect and it is the one that makes people close the tab.
 */

import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { ReactElement } from "react";

export function ConnectWallet(): ReactElement {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        authenticationStatus,
        mounted,
      }) => {
        /*
         * `mounted` guards the first paint.
         *
         * RainbowKit resolves the connection asynchronously, so before it settles every state looks
         * like "not connected". Rendering that would flash a connect prompt at somebody who is
         * already connected on every single page load.
         */
        const ready = mounted && authenticationStatus !== "loading";
        const connected =
          ready &&
          account !== undefined &&
          chain !== undefined &&
          authenticationStatus !== "unauthenticated";

        if (!ready) {
          return (
            <div className="wallet" aria-hidden="true" data-wallet="resolving">
              <span className="wallet-state">wallet</span>
            </div>
          );
        }

        if (!connected) {
          return (
            <div className="wallet" data-wallet="not-connected" data-testid="wallet">
              <span className="wallet-state">not connected</span>
              <span className="wallet-detail">
                Connect a wallet to encrypt submissions and read values granted to you. Kyrve does
                not send decrypted balances to its server.
              </span>
              <div className="wallet-actions">
                <button type="button" onClick={openConnectModal} data-testid="connect">
                  Connect wallet
                </button>
              </div>
            </div>
          );
        }

        if (chain.unsupported === true) {
          return (
            <div className="wallet" data-wallet="wrong-network" data-testid="wallet">
              <span className="wallet-state">wrong network</span>
              <span className="wallet-detail">
                Kyrve is connected to the wrong network. Switch to continue — nothing was submitted
                and nothing was lost.
              </span>
              <div className="wallet-actions">
                <button type="button" onClick={openChainModal} data-testid="switch-network">
                  Switch network
                </button>
              </div>
            </div>
          );
        }

        return (
          <div className="wallet" data-wallet="connected" data-testid="wallet">
            <span className="wallet-state">connected · {chain.name}</span>
            <span className="wallet-detail" data-testid="session">
              <span className="mono" data-testid="connected-account">
                {account.address}
              </span>
            </span>
            <div className="wallet-actions">
              <button type="button" onClick={openAccountModal} data-testid="account">
                {account.displayName}
              </button>
              <button type="button" onClick={openChainModal} data-testid="chain">
                {chain.name}
              </button>
            </div>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
