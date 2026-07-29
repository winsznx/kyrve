/**
 * The Phase 2 confidential deployment shape, in one place so the deployer, the verifier, the
 * browser application and the Sepolia manifest all agree on it.
 *
 * WHY THE ORDER IS FIXED. Four of the five contracts take another's address in their constructor,
 * so the deployment is a dependency chain rather than a set. Writing it out once removes the
 * commonest deployment bug — a contract wired to the wrong controller — and lets a verifier check
 * the wiring back from the chain rather than trusting a broadcast log.
 */

export const CONFIDENTIAL_CONTRACTS = [
  "KyrveEmergencyController",
  "TestUnderlyingERC20",
  "KyrveWrappedAsset",
  "KyrveConfidentialAssetVault",
  "EncryptedMandateBook",
  "ConfidentialRequestBook",
] as const;

export type ConfidentialContract = (typeof CONFIDENTIAL_CONTRACTS)[number];

/** The wiring every deployment must satisfy, checked back from chain state by `verify:confidential`. */
export const CONFIDENTIAL_WIRING: readonly {
  readonly contract: ConfidentialContract;
  readonly getter: string;
  readonly expected: ConfidentialContract;
  readonly why: string;
}[] = [
  {
    contract: "KyrveWrappedAsset",
    getter: "emergencyController",
    expected: "KyrveEmergencyController",
    why: "wrapping is a pausable entry; a wrapper wired to the wrong controller could not be stopped",
  },
  {
    contract: "KyrveWrappedAsset",
    getter: "underlying",
    expected: "TestUnderlyingERC20",
    why: "the wrapper must hold exactly the ERC-20 it claims to wrap, or coverage is meaningless",
  },
  {
    contract: "KyrveConfidentialAssetVault",
    getter: "asset",
    expected: "KyrveWrappedAsset",
    why: "the vault's single transient-handle recipient is this address and nothing else",
  },
  {
    contract: "KyrveConfidentialAssetVault",
    getter: "emergencyController",
    expected: "KyrveEmergencyController",
    why: "deposits are pausable; withdrawals deliberately are not",
  },
  {
    contract: "EncryptedMandateBook",
    getter: "emergencyController",
    expected: "KyrveEmergencyController",
    why: "mandate submission is a pausable entry; pause, resume and retire are not",
  },
  {
    contract: "ConfidentialRequestBook",
    getter: "emergencyController",
    expected: "KyrveEmergencyController",
    why: "request submission is a pausable entry; cancellation and expiry are not",
  },
];

/**
 * The compiler settings the confidential layer is built with, and why they differ from the
 * substrate's.
 *
 * `nox-protocol-contracts` 0.2.4 declares `pragma solidity ^0.8.35`, and the Midnight substrate is
 * pinned at 0.8.34 so its runtime bytecode stays byte-comparable with the pinned release. The two
 * cannot be reconciled, so the confidential layer is a separate compilation unit. `evmVersion`
 * stays `osaka` — Ethereum Sepolia's fork — so one artifact deploys locally and on Sepolia.
 */
export const CONFIDENTIAL_COMPILER = {
  solc: "0.8.36",
  evmVersion: "osaka",
  optimizer: true,
  optimizerRuns: 200,
  viaIR: true,
  bytecodeHash: "none",
  divergesFromSubstrate: true,
  divergenceReason:
    "nox-protocol-contracts 0.2.4 requires ^0.8.35; the Midnight substrate is pinned at 0.8.34 for " +
    "bytecode comparability. Recorded as Phase 2 delta Q-1.",
} as const;

/** NoxCompute, per chain, as `Nox.noxComputeContract()` resolves it. Not configurable. */
export const NOX_COMPUTE_BY_CHAIN: Readonly<Record<number, `0x${string}`>> = {
  31337: "0x75C6AF4430cc474b1bb9b8540b7E46D6f8e1C685",
  421614: "0xd464B198f06756a1d00be223634b85E0a731c229",
  11155111: "0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF",
};

/** The public handle gateway. There is no Nox mainnet; both testnets share this endpoint. */
export const NOX_GATEWAY_BY_CHAIN: Readonly<Record<number, string>> = {
  421614: "https://gateway-testnets.noxprotocol.dev",
  11155111: "https://gateway-testnets.noxprotocol.dev",
};
