/**
 * Supported chains.
 *
 * Kyrve targets exactly one public chain: Ethereum Sepolia. That is not a placeholder for a
 * mainnet — no Nox mainnet exists (source-lock.json), and the pinned Midnight release is deployed
 * here as a labelled non-production replica.
 *
 * The `requiredFork` field is load-bearing. The pinned Midnight release compiles with
 * `evm_version = "osaka"`; a chain that silently lacks Osaka would accept the deployment and then
 * behave incorrectly. Every deployment path runs the CLZ probe before broadcasting.
 */

export const CHAIN_IDS = {
  ethereumSepolia: 11155111,
  arbitrumSepolia: 421614,
  hardhat: 31337,
  anvil: 31337,
} as const;

export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

export interface ChainConfig {
  readonly id: number;
  readonly name: string;
  readonly shortName: string;
  /** EVM fork the pinned Midnight release requires to deploy unmodified. */
  readonly requiredFork: "osaka" | "cancun";
  /** Whether Kyrve deploys its own Midnight replica here, or expects a pre-existing one. */
  readonly deploysMidnightReplica: boolean;
  /** Nox NoxCompute proxy, or null where Nox is not deployed. */
  readonly noxCompute: `0x${string}` | null;
  readonly explorerUrl: string | null;
  /**
   * Maximum block span a single `eth_getLogs` call may request. This is a property of the pinned
   * RPC provider, not of the chain — see docs/day0/THREAT-MODEL.md T-9.
   */
  readonly defaultLogRange: number;
}

export const ETHEREUM_SEPOLIA: ChainConfig = {
  id: CHAIN_IDS.ethereumSepolia,
  name: "Ethereum Sepolia",
  shortName: "sepolia",
  requiredFork: "osaka",
  deploysMidnightReplica: true,
  // Verified live 2026-07-28 by eth_getCode + eth_getStorageAt(EIP-1967 slot) + eth_call gateway().
  noxCompute: "0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF",
  explorerUrl: "https://sepolia.etherscan.io",
  defaultLogRange: 200,
};

export const LOCAL_CHAIN: ChainConfig = {
  id: CHAIN_IDS.hardhat,
  name: "Local development chain",
  shortName: "local",
  requiredFork: "osaka",
  deploysMidnightReplica: true,
  // The Nox Hardhat plugin etches NoxCompute at this address via hardhat_setCode. It is local-only
  // development infrastructure and is unusable on any public network.
  noxCompute: "0x75C6AF4430cc474b1bb9b8540b7E46D6f8e1C685",
  explorerUrl: null,
  defaultLogRange: 10_000,
};

export const SUPPORTED_CHAINS: readonly ChainConfig[] = [ETHEREUM_SEPOLIA, LOCAL_CHAIN];

export function chainById(id: number): ChainConfig {
  const found = SUPPORTED_CHAINS.find((c) => c.id === id);
  if (found === undefined) {
    throw new Error(
      `Unsupported chain id ${id}. Kyrve supports ${SUPPORTED_CHAINS.map((c) => `${c.name} (${c.id})`).join(", ")}. ` +
        "Adding a chain requires re-proving the Osaka fork and re-deploying the pinned Midnight release.",
    );
  }
  return found;
}

/**
 * Arbitrum Sepolia is deliberately absent from SUPPORTED_CHAINS despite Nox supporting it.
 * The two Nox testnets run different contract versions and different KMS keys, so portability
 * must be proven rather than assumed. Recorded as assumption AS-2.
 */
export const KNOWN_UNSUPPORTED = {
  arbitrumSepolia: {
    id: CHAIN_IDS.arbitrumSepolia,
    reason:
      "Nox runs a different contract version and a different KMS key here than on Ethereum Sepolia. " +
      "Portability is UNVERIFIED (docs/day0/ASSUMPTIONS.md AS-2).",
  },
} as const;
