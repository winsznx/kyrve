/**
 * A client that signs with the wallet and reads with Kyrve's own node.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY A WALLET MUST NOT BE USED AS AN RPC ENDPOINT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A viem `WalletClient` built from an injected provider sends EVERY method down that provider,
 * reads included. That looks harmless and is not: the extension is then Kyrve's node, and which
 * node that actually is depends entirely on which wallet the visitor happens to have installed.
 *
 * This was found in the deployed product rather than reasoned about. A wallet that proxies
 * `eth_call` through its own backend returned `-32000 Request failed with status code 404` for
 * every read the Nox handle client made, on a Sepolia account the same wallet was displaying a
 * balance for. Nothing was wrong with Kyrve, with the RPC proxy, or with the chain — the reads were
 * simply going somewhere Kyrve never chose and cannot verify.
 *
 * So the two responsibilities are separated at the transport, which is where they differ:
 *
 *   signing   the wallet, always. It holds the key, and `Nox.fromExternal` binds an input proof to
 *             its DIRECT caller — there is no substitute for the wallet on this path.
 *   reading   Kyrve's `/rpc`, always. Same endpoint the rest of the application reads through, so a
 *             value shown beside a signature came from the node that produced every other value on
 *             the page.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE ROUTING TABLE IS AN ALLOW-LIST OF WALLET METHODS, NOT OF READS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Written this way round on purpose. An unrecognised method reaches the read proxy, which has its
 * own allow-list and refuses anything it does not know; the failure mode is a refused read. The
 * inverse default would send an unrecognised method to the wallet, and the failure mode there is a
 * signature prompt Kyrve did not intend to raise.
 */

import { type Chain, createWalletClient, custom, type WalletClient } from "viem";

/**
 * Methods that belong to the wallet and can never be answered by a node.
 *
 * `eth_chainId` and `eth_accounts` are here deliberately even though the proxy could answer the
 * first: they describe the WALLET's state, and answering them from Kyrve's node would report the
 * chain Kyrve wanted rather than the chain the visitor is actually about to sign on.
 */
const WALLET_METHODS: ReadonlySet<string> = new Set([
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
  "eth_sendTransaction",
  "eth_sign",
  "eth_signTransaction",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "personal_sign",
]);

/** Everything namespaced to the wallet: `wallet_switchEthereumChain`, `wallet_watchAsset`, and so on. */
const WALLET_PREFIX = "wallet_";

function isWalletMethod(method: string): boolean {
  return WALLET_METHODS.has(method) || method.startsWith(WALLET_PREFIX);
}

/**
 * The shape both sides of the split actually expose.
 *
 * viem types a transport's `request` against the EIP-1474 method union, which cannot describe a
 * function that forwards an arbitrary method string. The assertion is to this interface rather than
 * to `any`, so the call is still typed — it is a statement that the underlying function is an
 * EIP-1193 provider, which it is.
 */
type JsonRpcRequest = (args: { method: string; params?: unknown }) => Promise<unknown>;

/** A JSON-RPC request against Kyrve's own endpoint. */
function readThrough(rpcUrl: string): JsonRpcRequest {
  return async ({ method, params }) => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }),
    });

    if (!response.ok) {
      // The status, never the URL. `apps/web/src/lib/redact.ts` explains why a transport error is
      // the one place a provider credential reaches the DOM, and this endpoint is same-origin.
      throw new Error(`Kyrve's node refused a ${method} read (HTTP ${response.status}).`);
    }

    const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error !== undefined) {
      throw new Error(body.error.message ?? `${method} failed.`);
    }
    return body.result;
  };
}

/**
 * Wraps a wagmi wallet client so its reads go to `rpcUrl` and its signatures go to the wallet.
 *
 * The account and chain are carried over unchanged: this is the same signer, reached through a
 * transport that knows which half of its traffic belongs where.
 */
export function splitReadsFromSigning(walletClient: WalletClient, rpcUrl: string): WalletClient {
  const toWallet = walletClient.request as unknown as JsonRpcRequest;
  const toNode = readThrough(rpcUrl);

  const account = walletClient.account;
  if (account === undefined) {
    throw new Error("The wallet client has no account, so nothing can be bound to a signer.");
  }

  return createWalletClient({
    account,
    chain: walletClient.chain as Chain,
    transport: custom({
      request: async ({ method, params }) =>
        isWalletMethod(method) ? toWallet({ method, params }) : toNode({ method, params }),
    }),
  });
}
