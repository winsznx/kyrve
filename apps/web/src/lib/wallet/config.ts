/**
 * The production wallet configuration: RainbowKit's interface over EIP-6963 discovery, on two chains.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THERE IS NO WALLETCONNECT HERE, AND WHY THAT WAS MEASURED RATHER THAN ASSUMED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Kyrve claims the terminal contacts exactly two things: the Nox gateway and the chain. That is not
 * a slogan — `confidential/test/70-browser-flow.ts` and `101-series-browser.ts` both record every
 * origin a real Chromium requests and fail on any third.
 *
 * Adding WalletConnect broke both. The Reown stack contacts `pulse.walletconnect.org` (analytics)
 * and `api.web3modal.org` (the wallet registry) on load, before anybody connects anything. Neither
 * receives a decrypted value and neither could: they are outside the confidential path entirely.
 * What they do receive is every visitor's IP address, this application's domain and its project id,
 * which is a third party learning who reads a confidentiality product. That is the wrong shape of
 * fact to leak from this particular application, and the tests were right to refuse it.
 *
 * So the connector set is EIP-6963 discovery alone. RainbowKit's interface is unchanged — the
 * chooser, the account modal and the network switcher all still render — and every wallet the
 * browser announces is still offered by name. What is gone is the relay: no QR code, no mobile deep
 * link, and no third origin.
 *
 * The trade is real and it is a trade. A reviewer on a phone with no extension cannot connect. A
 * reviewer with any extension can, and the claim in the footer stays true and tested.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE PROVIDER CREDENTIAL NEVER REACHES THIS FILE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Sepolia's transport is a same-origin `/rpc`, which the site Worker forwards with the key attached
 * server-side. The local chain's transport comes from the runtime manifest the local stack publishes.
 * Neither is a provider URL, so `verify:bundles` stays clean and a visitor cannot read the key out of
 * an asset.
 */

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
 * The wallet config.
 *
 * One shape, no branch. The previous version chose between `getDefaultConfig` and `createConfig`
 * depending on whether a Reown project id was present, which meant the deployed product and a fork
 * of it ran different connector stacks and only one of them was ever tested.
 */
export function createWalletConfig() {
  return createConfig({
    chains: [sepolia, kyrveLocal] as const,
    transports: {
      [sepolia.id]: http(sepoliaTransport()),
      [kyrveLocal.id]: http("http://127.0.0.1:8545"),
    },
    // EIP-6963 discovery: every injected wallet the browser announces, without naming any of them.
    connectors: [injected()],
    ssr: false,
    /*
     * NOTHING IS PERSISTED, and that is the product's stated position rather than a limitation.
     *
     * `lib/context.tsx` already says it: a page that reopened a wallet session on load would
     * silently re-open one for a provider who had just locked the session to clear a decrypted
     * balance off the screen. Connecting is an action; reconnecting is the same action.
     *
     * wagmi's default storage contradicted that. It wrote `wagmi.store` — which carries the last
     * connector AND the connected addresses — so a reload restored a session the reader had ended,
     * and left their address in `localStorage` on whatever machine they were using.
     * `70-browser-flow.ts` caught it: only the role and the onboarding flag may be persisted.
     *
     * The cost is one reconnect per reload. On a terminal whose lock button exists to clear
     * decrypted values from memory, that is the correct default and not an inconvenience to design
     * around.
     */
    storage: null,
  });
}
