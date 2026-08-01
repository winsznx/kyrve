/**
 * The production wallet stack, mounted around the whole application.
 *
 * RainbowKit v2's architecture is four providers in a fixed order: wagmi, then react-query, then
 * RainbowKit, then the app. The order is not stylistic — RainbowKit reads wagmi's state through
 * react-query, so inverting any two produces a connect button that renders and never resolves.
 *
 * The theme is Kyrve's, not RainbowKit's default. `darkTheme` is given the palette from
 * `design.md` so the modal reads as part of the product rather than as a third-party widget dropped
 * into it — Cobalt for the accent, Onyx and Graphite for the surfaces, and the same 12px card and
 * pill radii the rest of the interface uses.
 */

import { darkTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactElement, type ReactNode, useState } from "react";
import { WagmiProvider } from "wagmi";

import { createWalletConfig } from "./config.js";

import "@rainbow-me/rainbowkit/styles.css";

/**
 * Kyrve's palette, applied to RainbowKit's modal.
 *
 * Every value comes from `design.md`. The accent is Cobalt and it is the modal's single primary
 * action, which is consistent with the one-per-page rule: while the modal is open it IS the page.
 */
const KYRVE_THEME = darkTheme({
  accentColor: "#5266eb",
  accentColorForeground: "#ffffff",
  borderRadius: "large",
  fontStack: "system",
  overlayBlur: "small",
});

export function WalletProvider({ children }: { children: ReactNode }): ReactElement {
  // Created once per mount. A config rebuilt on every render would drop the connection on any
  // parent re-render, which presents as a wallet that disconnects itself at random.
  const [config] = useState(() => createWalletConfig());
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={KYRVE_THEME} modalSize="compact" appInfo={{ appName: "Kyrve" }}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
