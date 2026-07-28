/**
 * Deployment environments.
 *
 * An environment is the tuple (chain, manifest location, RPC policy). Nothing else in Kyrve is
 * allowed to invent one: adding an environment means adding a manifest and re-running the whole
 * verification chain.
 */

import { type ChainConfig, ETHEREUM_SEPOLIA, LOCAL_CHAIN } from "./chains.js";

export type EnvironmentName = "local" | "sepolia";

export interface Environment {
  readonly name: EnvironmentName;
  readonly chain: ChainConfig;
  /** Repository-relative directory holding addresses.json, manifest.json, markets.json. */
  readonly manifestDir: string;
  /** Wrangler environment this maps to. `local` uses no remote bindings. */
  readonly wranglerEnv: string | null;
  /**
   * Whether a broadcast to this environment requires explicit opt-in. Only `local` may be
   * deployed without it — every path to a public chain demands DEPLOY_SEPOLIA=true.
   */
  readonly requiresBroadcastOptIn: boolean;
}

export const LOCAL: Environment = {
  name: "local",
  chain: LOCAL_CHAIN,
  manifestDir: "deployments/local",
  wranglerEnv: null,
  requiresBroadcastOptIn: false,
};

export const SEPOLIA: Environment = {
  name: "sepolia",
  chain: ETHEREUM_SEPOLIA,
  manifestDir: "deployments/sepolia",
  wranglerEnv: "sepolia",
  requiresBroadcastOptIn: true,
};

export const ENVIRONMENTS: readonly Environment[] = [LOCAL, SEPOLIA];

export function environmentByName(name: string): Environment {
  const found = ENVIRONMENTS.find((e) => e.name === name);
  if (found === undefined) {
    throw new Error(
      `Unknown environment "${name}". Kyrve defines ${ENVIRONMENTS.map((e) => e.name).join(", ")}.`,
    );
  }
  return found;
}
