/**
 * The production wallet configuration: RainbowKit over wagmi, on two chains.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE VERSIONS ARE WHAT THEY ARE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `@rainbow-me/rainbowkit@2.2.11` peers on `wagmi ^2.9.0`. The newest wagmi is 3.7.5, which does NOT
 * satisfy that range — installing "the latest" would have produced a tree that resolves and then
 * fails at runtime on a connector API that moved. wagmi is therefore pinned at 2.19.5, the newest
 * release inside RainbowKit's range, and viem stays at the repository's existing 2.55.10, which both
 * of them accept as `2.x`.
 *
 * Exact pins, like everything else here. A range on a wallet connector is a range on the code that
 * asks somebody to sign.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE PROVIDER CREDENTIAL NEVER REACHES THIS FILE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Sepolia's transport is a same-origin `/rpc`, which the site Worker forwards with the key attached
 * server-side. The local chain's transport comes from the runtime manifest the local stack publishes.
 * Neither is a provider URL, so `verify:bundles` stays clean and a visitor cannot read the key out of
 * an asset.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE PROJECT ID IS READ, NEVER EMBEDDED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `VITE_REOWN_PROJECT_ID` comes from the environment at build time. It is not a secret — it is a
 * public identifier that Reown ties to an origin allowlist — but it is per-deployment, and a value
 * committed to the repository would be somebody else's WalletConnect quota. Absent, WalletConnect is
 * simply not offered and injected wallets still work; that is a smaller product, not a broken one.
 */

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";
import { sepolia } from "viem/chains";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

/**
 * The local Kyrve chain.
 *
 * Declared rather than imported from `viem/chains`'s `hardhat`, because the local stack is an L1 at
 * the Osaka fork with Nox contracts on it — the name a wallet shows should say that rather than
 * "Hardhat", and a user switching networks needs to recognise it.
 */
export const kyrveLocal = defineChain({
  id: 31337,
  name: "Kyrve local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

/** Reown's project id, or nothing. Absent is a coherent state, not a failure. */
export const REOWN_PROJECT_ID: string = import.meta.env["VITE_REOWN_PROJECT_ID"] ?? "";

/**
 * Where the browser reaches each chain.
 *
 * Sepolia goes through this origin's `/rpc`, so the provider key stays in a Worker secret. On a
 * local dev server there is no such proxy, so Sepolia falls back to its public endpoint — which is
 * fine for reads and is never the deployed path.
 */
function sepoliaTransport(): string {
  const local =
    window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
  return local ? "https://ethereum-sepolia-rpc.publicnode.com" : `${window.location.origin}/rpc`;
}

/**
 * The config, with or without WalletConnect.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * AN EMPTY PROJECT ID IS NOT A DEGRADED MODE — IT IS A CRASH
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `getDefaultConfig` with `projectId: ""` throws `No projectId found` at module scope, which takes
 * the whole application down before the first render. The first version of this file assumed it
 * would simply omit WalletConnect and said so in a comment; `pnpm verify:web` found the opposite on
 * every route — a blank page and an uncaught error.
 *
 * So the branch is explicit. With an id, the full RainbowKit stack: injected wallets, the
 * WalletConnect QR and mobile deep links. Without one, `createConfig` with EIP-6963 discovery only —
 * every injected wallet the browser exposes still works, there is simply no QR. That is a smaller
 * product and it starts.
 */
export function createWalletConfig() {
  const chains = [sepolia, kyrveLocal] as const;
  const transports = {
    [sepolia.id]: http(sepoliaTransport()),
    [kyrveLocal.id]: http("http://127.0.0.1:8545"),
  };

  if (REOWN_PROJECT_ID.trim().length > 0) {
    return getDefaultConfig({
      appName: "Kyrve",
      projectId: REOWN_PROJECT_ID.trim(),
      chains,
      transports,
      ssr: false,
    });
  }

  return createConfig({
    chains,
    transports,
    // EIP-6963 discovery: every injected wallet the browser announces, without naming any of them.
    connectors: [injected()],
    ssr: false,
  });
}

/** Whether WalletConnect — the QR code and mobile deep links — is available on this build. */
export const WALLETCONNECT_AVAILABLE = REOWN_PROJECT_ID.trim().length > 0;
