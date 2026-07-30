/**
 * Deploys the Phase 2 confidential layer, to a local node or to Ethereum Sepolia.
 *
 * ONE MODULE FOR BOTH ENVIRONMENTS, deliberately. A local deployment that takes a different path
 * from the Sepolia one proves nothing about the Sepolia one. The only differences here are the
 * transport, the two independent broadcast opt-ins, and the funding check — everything about what
 * is deployed and how it is wired is shared.
 *
 * WHY IT READS BACK FROM CHAIN. A broadcast log says what was sent, not what landed. Every address
 * is confirmed to hold code, and every constructor wiring in `CONFIDENTIAL_WIRING` is read back
 * through the deployed contract's own getter. A vault pointing at the wrong controller would
 * otherwise deploy, verify and sit there looking correct.
 *
 * SECRETS. The RPC URL is reduced to scheme and host in every line of output, the private key is
 * never printed, and `assertNoSecrets` inspects the manifest before it is written.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  CONFIDENTIAL_COMPILER,
  CONFIDENTIAL_CONTRACTS,
  CONFIDENTIAL_WIRING,
  type ConfidentialContract,
  NOX_COMPUTE_BY_CHAIN,
} from "@kyrve/config";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  type Hex,
  http,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat, sepolia } from "viem/chains";

import {
  assertBroadcastArmed,
  assertNoSecrets,
  deployer,
  safeErrorMessage,
  sepoliaRpc,
} from "../lib/env.js";
import { repoPath, stableStringify } from "../lib/shell.js";

const LOCAL_RPC = "http://127.0.0.1:8545";

/** Anvil/Hardhat account zero. A published test key; it holds nothing on any public network. */
const LOCAL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

export type Environment = "local" | "sepolia";

export interface ConfidentialDeployment {
  readonly environment: Environment;
  readonly chainId: number;
  readonly deployer: Address;
  readonly deploymentBlock: string;
  readonly deployedAt: string;
  readonly noxCompute: Address;
  readonly compiler: typeof CONFIDENTIAL_COMPILER;
  readonly addresses: Readonly<Record<ConfidentialContract, Address>>;
  readonly runtimeHashes: Readonly<Record<ConfidentialContract, Hex>>;
  readonly wiringVerified: readonly string[];
  readonly gasUsed: string;
  readonly disclosure: string;
}

interface Artifact {
  readonly abi: readonly unknown[];
  readonly bytecode: Hex;
  readonly sourceName: string;
}

/** Test contracts are compiled but never deployed to a manifest environment. */
const ARTIFACT_PATH: Readonly<Record<ConfidentialContract, string>> = {
  KyrveEmergencyController: "contracts/KyrveEmergencyController.sol/KyrveEmergencyController.json",
  TestUnderlyingERC20: "contracts/test/TestUnderlyingERC20.sol/TestUnderlyingERC20.json",
  KyrveWrappedAsset: "contracts/KyrveWrappedAsset.sol/KyrveWrappedAsset.json",
  KyrveConfidentialAssetVault:
    "contracts/KyrveConfidentialAssetVault.sol/KyrveConfidentialAssetVault.json",
  EncryptedMandateBook: "contracts/EncryptedMandateBook.sol/EncryptedMandateBook.json",
  ConfidentialRequestBook: "contracts/ConfidentialRequestBook.sol/ConfidentialRequestBook.json",
};

function artifact(name: ConfidentialContract): Artifact {
  const path = repoPath(`confidential/artifacts/${ARTIFACT_PATH[name]}`);
  if (!existsSync(path)) {
    throw new Error(
      `${name} has no artifact at ${path}. Run \`pnpm --filter @kyrve/confidential build\` first — ` +
        "the confidential layer compiles with solc 0.8.36 under Hardhat, not with the Foundry profile.",
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as Artifact;
}

/**
 * The reservation capability, which does not exist yet.
 *
 * `openReservation` and `releaseReservation` belong to the curve engine and quote activator, and
 * those are Phase 3. Deploying with the zero address means every reservation entry point reverts
 * `ReserverNotConfigured` — the correct public behaviour for a capability nothing can yet perform,
 * and much safer than pointing it at a placeholder that could be called.
 */
const RESERVER_UNSET = "0x0000000000000000000000000000000000000000" as const;

const DISCLOSURE =
  "Kyrve is open-source software integrating an unmodified, source-available Morpho Midnight " +
  "testnet replica under its applicable non-production licence.";

export async function deployConfidential(
  environment: Environment,
): Promise<ConfidentialDeployment> {
  const isSepolia = environment === "sepolia";
  const chain = isSepolia ? sepolia : hardhat;
  const chainId = isSepolia ? 11155111 : 31337;

  let rpcUrl = LOCAL_RPC;
  let redacted = LOCAL_RPC;
  let account = privateKeyToAccount(LOCAL_KEY);

  if (isSepolia) {
    const rpc = sepoliaRpc();
    if (rpc.isPublicEndpoint) {
      throw new Error(
        "refusing to deploy through a keyless public RPC. Configure the owner's Alchemy endpoint " +
          "via ALCHEMY_API_KEY or SEPOLIA_RPC_URL.",
      );
    }
    // Two independent opt-ins, checked before anything touches the network.
    assertBroadcastArmed();
    rpcUrl = rpc.url;
    redacted = rpc.redacted;
    account = privateKeyToAccount(deployer().privateKey);
  }

  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport, cacheTime: 0 });
  const wallet = createWalletClient({ account, chain, transport });

  console.log(`Kyrve confidential layer -> ${environment}\n`);
  console.log(`  RPC       ${redacted}`);
  console.log(`  deployer  ${account.address}`);

  const observed = await publicClient.getChainId();
  if (observed !== chainId) {
    throw new Error(`connected chain is ${observed}, expected ${chainId} for ${environment}`);
  }

  // Nox must actually be there. Deploying a confidential layer onto a chain with no NoxCompute
  // produces contracts that compile, deploy, and revert on the first encrypted input.
  const noxCompute = NOX_COMPUTE_BY_CHAIN[chainId];
  if (noxCompute === undefined) {
    throw new Error(`no NoxCompute address is known for chain ${chainId}`);
  }
  const noxCode = await publicClient.getCode({ address: noxCompute });
  if (noxCode === undefined || noxCode === "0x") {
    throw new Error(
      `NoxCompute has no code at ${noxCompute} on chain ${chainId}. The confidential layer cannot ` +
        "function without it, so the deployment stops here rather than landing something broken.",
    );
  }
  console.log(`  Nox       ${noxCompute} (${(noxCode.length - 2) / 2} bytes of code)\n`);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`  balance   ${formatEther(balance)} ETH\n`);

  const addresses = {} as Record<ConfidentialContract, Address>;
  const runtimeHashes = {} as Record<ConfidentialContract, Hex>;
  let gasUsed = 0n;

  async function deploy(name: ConfidentialContract, args: readonly unknown[]): Promise<Address> {
    const { abi, bytecode } = artifact(name);
    const hash = await wallet.deployContract({
      abi: abi as never,
      bytecode,
      args: args as never,
      account,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const deployed = receipt.contractAddress ?? undefined;
    if (receipt.status !== "success" || deployed === undefined) {
      throw new Error(`${name} deployment reverted or produced no contract address`);
    }
    gasUsed += receipt.gasUsed;

    // Read the code back rather than trusting the receipt.
    const code = await publicClient.getCode({ address: deployed });
    if (code === undefined || code === "0x") {
      throw new Error(`${name} at ${deployed} has no code — it did not land`);
    }

    addresses[name] = deployed;
    runtimeHashes[name] = keccak256(code);
    console.log(`  ${name.padEnd(28)} ${deployed}  ${receipt.gasUsed} gas`);
    return deployed;
  }

  const controller = await deploy("KyrveEmergencyController", [account.address]);
  const underlying = await deploy("TestUnderlyingERC20", ["Kyrve Test USDC", "tUSDC", 6]);
  const asset = await deploy("KyrveWrappedAsset", [
    "Kyrve Confidential USDC",
    "cUSDC",
    "",
    underlying,
    controller,
  ]);
  await deploy("KyrveConfidentialAssetVault", [asset, RESERVER_UNSET, controller]);
  await deploy("EncryptedMandateBook", [controller]);
  await deploy("ConfidentialRequestBook", [controller]);

  // Wiring, read back from each deployed contract's own getter.
  console.log("\n  verifying constructor wiring from chain state...");
  const wiringVerified: string[] = [];
  for (const rule of CONFIDENTIAL_WIRING) {
    const { abi } = artifact(rule.contract);
    const actual = (await publicClient.readContract({
      address: addresses[rule.contract],
      abi: abi as never,
      functionName: rule.getter,
    })) as Address;
    const expected = addresses[rule.expected];
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(
        `${rule.contract}.${rule.getter}() is ${actual}, expected ${rule.expected} at ${expected}. ` +
          rule.why,
      );
    }
    wiringVerified.push(`${rule.contract}.${rule.getter}() -> ${rule.expected}`);
  }
  console.log(`  ${wiringVerified.length}/${CONFIDENTIAL_WIRING.length} wiring checks PASS`);

  const block = await publicClient.getBlockNumber();
  const timestamp = (await publicClient.getBlock({ blockNumber: block })).timestamp;

  const deployment: ConfidentialDeployment = {
    environment,
    chainId,
    deployer: account.address,
    deploymentBlock: block.toString(),
    deployedAt: new Date(Number(timestamp) * 1000).toISOString(),
    noxCompute,
    compiler: CONFIDENTIAL_COMPILER,
    addresses,
    runtimeHashes,
    wiringVerified,
    gasUsed: gasUsed.toString(),
    disclosure: DISCLOSURE,
  };

  const outDir = repoPath(`deployments/${environment}`);
  mkdirSync(outDir, { recursive: true });
  const payload = stableStringify(deployment);
  assertNoSecrets(payload, `deployments/${environment}/confidential.json`);
  writeFileSync(`${outDir}/confidential.json`, payload);

  console.log(`\n  total gas ${gasUsed}`);
  console.log(`  written   deployments/${environment}/confidential.json`);

  return deployment;
}

async function main(): Promise<void> {
  const requested = process.argv[2];
  if (requested !== "local" && requested !== "sepolia") {
    throw new Error("usage: tsx scripts/deploy/confidential.ts <local|sepolia>");
  }
  await deployConfidential(requested);
  if (requested === "sepolia") {
    console.log(
      "\n  next: pnpm verify:confidential sepolia   then   pnpm verify:etherscan:confidential",
    );
  }
}

// Only run when invoked directly; `deployConfidential` is imported by the local flow driver.
if (process.argv[1]?.endsWith("confidential.ts")) {
  main().catch((error: unknown) => {
    console.error(`\ndeployment FAILED: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  });
}

export { CONFIDENTIAL_CONTRACTS, DISCLOSURE, RESERVER_UNSET };
