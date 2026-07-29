/**
 * The minimal ambient surface `@kyrve/nox` relies on, declared rather than imported.
 *
 * This package must run unchanged in BOTH Node and `workerd`: the keeper polls handle readiness
 * from a Cloudflare Worker, and the same code runs in Node during tests and scripts. Pulling in
 * `@types/node` would type it for one runtime and quietly permit Node-only APIs; pulling in `DOM`
 * would type it for a browser it never runs in.
 *
 * Both `fetch` and `setTimeout` are in the WinterCG Minimum Common API and are present in Node
 * >= 18 and in `workerd`, so declaring exactly these two keeps the dependency surface honest and
 * makes any future Node-only API a compile error instead of a deploy-time failure.
 */

declare function fetch(input: string, init?: RequestInit): Promise<Response>;
declare function setTimeout(handler: () => void, timeout?: number): unknown;

interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface Response {
  readonly status: number;
  text(): Promise<string>;
}
