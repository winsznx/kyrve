/**
 * The chain the terminal is pointed at, and the contracts on it.
 *
 * Nothing here is hardcoded. `pnpm deploy:confidential local` writes
 * `deployments/local/confidential.json`, and the Vite build serves that file verbatim. Baking
 * addresses into the bundle would let the interface show a balance from a deployment that no longer
 * exists — which, in a confidential product, would be a page confidently displaying nothing real.
 */

import { NOX_COMPUTE_BY_CHAIN, NOX_GATEWAY_BY_CHAIN } from "@kyrve/config";
import type { NoxNetwork } from "@kyrve/nox";

export type ContractName =
  | "KyrveEmergencyController"
  | "TestUnderlyingERC20"
  | "KyrveWrappedAsset"
  | "KyrveConfidentialAssetVault"
  | "EncryptedMandateBook"
  | "ConfidentialRequestBook";

export interface Deployment {
  readonly environment: "local" | "sepolia";
  readonly chainId: number;
  readonly noxCompute: `0x${string}`;
  readonly addresses: Readonly<Record<ContractName, `0x${string}`>>;
  readonly disclosure: string;
}

export class DeploymentUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "DeploymentUnavailableError";
  }
}

/**
 * The Nox network for a deployment.
 *
 * The gateway URL is read from the record for a local stack, whose Docker host port is assigned at
 * startup, and from the published constant for a real testnet.
 */
export function noxNetworkFor(deployment: Deployment, localGatewayUrl?: string): NoxNetwork {
  const gatewayUrl =
    deployment.chainId === 31337
      ? (localGatewayUrl ?? "http://127.0.0.1:3000")
      : NOX_GATEWAY_BY_CHAIN[deployment.chainId];

  if (gatewayUrl === undefined) {
    throw new DeploymentUnavailableError(
      `no Nox handle gateway is known for chain ${deployment.chainId}. There is no Nox mainnet, ` +
        "and the two testnets run different contract versions and different KMS keys.",
    );
  }

  return {
    chainId: deployment.chainId,
    name: deployment.environment,
    noxCompute: NOX_COMPUTE_BY_CHAIN[deployment.chainId] ?? deployment.noxCompute,
    gatewayUrl,
  };
}
