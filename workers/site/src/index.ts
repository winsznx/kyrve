/**
 * The Kyrve site Worker: static assets, and the one endpoint that must not be static.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THERE IS A WORKER IN FRONT OF A STATIC SITE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Kyrve's whole client path is viem, and viem needs an Ethereum RPC endpoint. The two obvious
 * options are both wrong:
 *
 *   - putting the provider URL in the bundle ships the API key to every visitor. `verify:bundles`
 *     fails the build for exactly this, and U-F1 is what it cost when a key merely reached stdout.
 *   - a keyless public endpoint changes `eth_getLogs` behaviour without warning and rate-limits
 *     under a demo audience.
 *
 * So the browser talks to `/rpc` on its own origin and this Worker forwards to the provider with the
 * credential attached server-side. The key lives in a Worker secret and never enters an asset.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE PROXY IS NARROW ON PURPOSE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * An open JSON-RPC proxy is somebody else's free Ethereum endpoint within a day. This one accepts
 * POST only, requires a JSON body, and forwards only READ methods — an allow-list, not a deny-list,
 * because a deny-list is a promise to have thought of everything.
 *
 * `eth_sendRawTransaction` is deliberately absent. Signing happens in the visitor's wallet and their
 * wallet broadcasts through its own transport; Kyrve never needs to relay a signed transaction, and
 * a proxy that could would be a relay somebody else can point at anything.
 */

/** Read methods the interface actually calls. Anything else is refused. */
const ALLOWED = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_getCode",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "net_version",
]);

export interface Env {
  /** The full provider URL including its key. A secret: `wrangler secret put KYRVE_RPC_URL`. */
  readonly KYRVE_RPC_URL?: string;
  readonly ASSETS: { fetch: (request: Request) => Promise<Response> };
}

interface RpcCall {
  readonly method?: unknown;
  readonly id?: unknown;
}

/** One JSON-RPC error, in the shape viem already knows how to read. */
function rpcError(id: unknown, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/rpc") return env.ASSETS.fetch(request);

    if (request.method !== "POST") {
      return new Response("The Kyrve RPC proxy accepts POST only.", { status: 405 });
    }
    if (env.KYRVE_RPC_URL === undefined) {
      // Named honestly rather than as a generic 500: an operator reading this knows what to do.
      return rpcError(null, -32603, "KYRVE_RPC_URL is not configured on this deployment");
    }

    let body: RpcCall | RpcCall[];
    try {
      body = (await request.json()) as RpcCall | RpcCall[];
    } catch {
      return rpcError(null, -32700, "the request body is not JSON");
    }

    // viem batches, so a single call and an array are both normal traffic.
    const calls = Array.isArray(body) ? body : [body];
    for (const call of calls) {
      if (typeof call.method !== "string" || !ALLOWED.has(call.method)) {
        return rpcError(
          call.id,
          -32601,
          `${String(call.method)} is not forwarded by this proxy. It carries read methods only: ` +
            "signing happens in your wallet and your wallet broadcasts through its own transport.",
        );
      }
    }

    const upstream = await fetch(env.KYRVE_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    /*
     * The upstream response is returned verbatim, and its headers are NOT.
     *
     * A provider's headers can carry a request id, a plan tier or a rate-limit budget tied to the
     * account. None of that is the visitor's business and some of it identifies the key.
     */
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  },
};
