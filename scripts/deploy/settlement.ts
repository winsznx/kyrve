/**
 * Deploys the Phase 4 settlement layer, to a local node or to Ethereum Sepolia.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * IT REDEPLOYS NOTHING ELSE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Midnight, the four launch markets, the Phase 2 confidential layer and the Phase 3 curve layer are
 * already deployed and Etherscan-verified. The settlement contracts are constructed against those
 * exact addresses. Redeploying any of them would produce a parallel Kyrve whose mandates nobody
 * holds, and would quietly make the earlier phases' evidence describe contracts nothing uses.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE THREE ONE-SHOT BINDINGS ARE PART OF THE DEPLOYMENT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The registry must know its activator and its expiry controller; the activator must know the
 * factory; and the factory needs the activator's address at construction. So the cycle is broken
 * with three bindings, each callable exactly once by the deployer and reverting forever after:
 *
 *   registry.bindActivator        -> without it, `activate` reverts `ActivatorNotBound`
 *   registry.bindExpiryController -> without it, nothing can ever cancel or expire a quote
 *   activator.bindFactory         -> without it, `activate` reverts `FactoryNotBound`
 *
 * A deployment that stopped before them would leave a layer that looks healthy and refuses every
 * call. They happen here, and every one is read back from chain state before the manifest is
 * written, because a broadcast log says what was sent rather than what landed.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * SECRETS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The RPC URL is reduced to scheme and host in every line of output, the private key is never
 * printed, and the manifest is scanned for secrets before it is written.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

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

import { assertBroadcastArmed, assertNoSecrets, deployer, sepoliaRpc } from "../lib/env.js";
import { readJson, repoPath, stableStringify } from "../lib/shell.js";

const LOCAL_RPC = "http://127.0.0.1:8545";
/** Anvil/Hardhat account zero. A published test key; it holds nothing on any public network. */
const LOCAL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

export type Environment = "local" | "sepolia";

export const SETTLEMENT_CONTRACTS = [
  "KyrveQuoteRegistry",
  "KyrveSettlementRatifier",
  "KyrvePublicResultVerifier",
  "QuoteActivator",
  "KyrveQuoteExpiryController",
  "KyrveSeriesFactory",
] as const;

export type SettlementContract = (typeof SETTLEMENT_CONTRACTS)[number];

/**
 * The compiler the settlement layer is built with — the SUBSTRATE compiler, not the confidential
 * one. Recorded in the manifest so a reader never has to guess which of the two produced a given
 * artifact, and so `verify:deployed-bytecode` compares against the right build.
 */
export const SETTLEMENT_COMPILER = {
  solc: "0.8.34",
  evmVersion: "osaka",
  viaIR: true,
  optimizer: true,
  optimizerRuns: 466,
  bytecodeHash: "none",
  matchesSubstrate: true,
  matchesSubstrateReason:
    "Phase 4 imports Midnight interfaces and libraries directly and must stay byte-comparable " +
    "with the pinned release, so it uses the substrate settings rather than the confidential " +
    "layer's 0.8.36. It reaches the confidential layer through ICurveLayer, checked by " +
    "verify:curve-abi.",
} as const;

/** Every constructor wiring, read back from the deployed contract's own getter. */
const SETTLEMENT_WIRING: readonly {
  readonly contract: SettlementContract;
  readonly getter: string;
  readonly expected: SettlementContract | "midnight" | "curve";
  readonly curveKey?: string;
  readonly why: string;
}[] = [
  {
    contract: "KyrveQuoteRegistry",
    getter: "MIDNIGHT",
    expected: "midnight",
    why: "every callback and every group consumption is checked against it",
  },
  {
    contract: "KyrveSettlementRatifier",
    getter: "REGISTRY",
    expected: "KyrveQuoteRegistry",
    why: "the ratifier and the vault must read ONE quote state, or exact fill is not composed",
  },
  {
    contract: "KyrveSettlementRatifier",
    getter: "MIDNIGHT",
    expected: "midnight",
    why: "the offer's embedded Midnight address is checked against it",
  },
  {
    contract: "KyrvePublicResultVerifier",
    getter: "CURVE_VERIFIER",
    expected: "curve",
    curveKey: "CurveResultVerifier",
    why: "the only route by which a gateway proof reaches the settlement layer",
  },
  {
    contract: "KyrvePublicResultVerifier",
    getter: "GRAPH",
    expected: "curve",
    curveKey: "CurveGraphRegistry",
    why: "a handle the graph never registered must be refused before the gateway is asked",
  },
  {
    contract: "KyrvePublicResultVerifier",
    getter: "ENGINE",
    expected: "curve",
    curveKey: "NoxCurveEngine",
    why: "the published handle set is read from the engine at call time, never from the caller",
  },
  {
    contract: "KyrvePublicResultVerifier",
    getter: "EPOCHS",
    expected: "curve",
    curveKey: "QuoteEpochController",
    why: "only a Complete epoch may be settled against",
  },
  {
    contract: "QuoteActivator",
    getter: "REGISTRY",
    expected: "KyrveQuoteRegistry",
    why: "the activator is the registry's only writer",
  },
  {
    contract: "QuoteActivator",
    getter: "VERIFIER",
    expected: "KyrvePublicResultVerifier",
    why: "no quote is activated without a verified, bound curve result",
  },
  {
    contract: "QuoteActivator",
    getter: "UNIVERSES",
    expected: "curve",
    curveKey: "CurveUniverseRegistry",
    why: "the winning leaf's tick and price come from the frozen universe, not from the caller",
  },
  {
    contract: "QuoteActivator",
    getter: "RATIFIER",
    expected: "KyrveSettlementRatifier",
    why: "the ratifier is bound into every offer the activator builds",
  },
  {
    contract: "KyrveQuoteExpiryController",
    getter: "REGISTRY",
    expected: "KyrveQuoteRegistry",
    why: "it reads the quote it is being asked to retire",
  },
  {
    contract: "KyrveSeriesFactory",
    getter: "REGISTRY",
    expected: "KyrveQuoteRegistry",
    why: "every vault it deploys is constructed against this registry",
  },
  {
    contract: "KyrveSeriesFactory",
    getter: "ACTIVATOR",
    expected: "QuoteActivator",
    why: "a vault accepts preparation from exactly one activator",
  },
  {
    contract: "KyrveSeriesFactory",
    getter: "EXPIRY_CONTROLLER",
    expected: "KyrveQuoteExpiryController",
    why: "a vault accepts retirement instructions from exactly one controller",
  },
];

interface Artifact {
  readonly abi: readonly unknown[];
  readonly bytecode: { readonly object: Hex };
}

export interface SettlementDeployment {
  readonly environment: Environment;
  readonly chainId: number;
  readonly deployer: Address;
  readonly deploymentBlock: string;
  readonly deployedAt: string;
  readonly midnight: Address;
  readonly loanToken: Address;
  readonly keeper: Address;
  readonly operator: Address;
  readonly curator: Address;
  readonly compiler: typeof SETTLEMENT_COMPILER;
  readonly curve: Readonly<Record<string, Address>>;
  readonly addresses: Readonly<Record<SettlementContract, Address>>;
  readonly runtimeHashes: Readonly<Record<SettlementContract, Hex>>;
  readonly deploymentId: Hex;
  readonly bindings: readonly string[];
  readonly wiringVerified: readonly string[];
  readonly gasUsed: string;
  readonly ethSpent: string;
}

function artifact(name: string): Artifact {
  const path = repoPath(`out/${name}.sol/${name}.json`);
  if (!existsSync(path)) {
    throw new Error(`${name} has no artifact at ${path}. Run \`forge build\` first.`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as Artifact;
}

export async function deploySettlement(environment: Environment): Promise<SettlementDeployment> {
  const isSepolia = environment === "sepolia";
  const chain = isSepolia ? sepolia : hardhat;
  const chainId = isSepolia ? 11_155_111 : 31_337;

  const substratePath = repoPath(`deployments/${environment}/addresses.json`);
  const curvePath = repoPath(`deployments/${environment}/curve.json`);
  for (const [what, path] of [
    ["the Midnight substrate", substratePath],
    ["the Phase 3 curve layer", curvePath],
  ] as const) {
    if (!existsSync(path)) {
      throw new Error(
        `no record of ${what} at ${path}. The settlement layer is constructed against those exact ` +
          "addresses and deliberately does not redeploy them.",
      );
    }
  }
  const substrate = readJson<Record<string, Address>>(substratePath);
  const curve = readJson<{ addresses: Record<string, Address> }>(curvePath).addresses;

  const midnight = substrate["Midnight"];
  const loanToken = substrate["TestUSDC"];
  if (midnight === undefined) throw new Error(`${substratePath} records no Midnight address`);
  if (loanToken === undefined) throw new Error(`${substratePath} records no TestUSDC address`);

  let rpcUrl = LOCAL_RPC;
  let redacted = LOCAL_RPC;
  let account = privateKeyToAccount(LOCAL_KEY);

  if (isSepolia) {
    const rpc = sepoliaRpc();
    if (rpc.isPublicEndpoint) {
      throw new Error(
        "refusing to deploy through a keyless public RPC. Configure ALCHEMY_API_KEY or " +
          "SEPOLIA_RPC_URL.",
      );
    }
    assertBroadcastArmed();
    rpcUrl = rpc.url;
    redacted = rpc.redacted;
    account = privateKeyToAccount(deployer().privateKey);
  }

  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport, cacheTime: 0 });
  const wallet = createWalletClient({ account, chain, transport });

  console.log(`Kyrve settlement layer -> ${environment}\n`);
  console.log(`  RPC       ${redacted}`);
  console.log(`  deployer  ${account.address}`);

  const observed = await publicClient.getChainId();
  if (observed !== chainId) {
    throw new Error(`connected chain is ${observed}, expected ${chainId} for ${environment}`);
  }

  // Every address the settlement layer is constructed against must still hold code. Constructing
  // against an address that does not would produce a layer that deploys and then reverts on its
  // first activation.
  for (const [name, address] of [
    ["Midnight", midnight],
    ["TestUSDC", loanToken],
    ...Object.entries(curve),
  ] as const) {
    const code = await publicClient.getCode({ address });
    if (code === undefined || code === "0x") {
      throw new Error(`${name} at ${address} has no code`);
    }
  }
  console.log(`  Midnight  ${midnight}`);
  console.log(`  curve     ${Object.keys(curve).length} contracts, all live\n`);

  const balanceBefore = await publicClient.getBalance({ address: account.address });
  console.log(`  balance   ${formatEther(balanceBefore)} ETH\n`);

  const addresses = {} as Record<SettlementContract, Address>;
  const runtimeHashes = {} as Record<SettlementContract, Hex>;
  let gasUsed = 0n;

  async function deploy(name: SettlementContract, args: readonly unknown[]): Promise<Address> {
    const { abi, bytecode } = artifact(name);
    const hash = await wallet.deployContract({
      abi: abi as never,
      bytecode: bytecode.object,
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

    const code = await publicClient.getCode({ address: deployed });
    if (code === undefined || code === "0x") {
      throw new Error(`${name} at ${deployed} has no code — it did not land`);
    }
    addresses[name] = deployed;
    runtimeHashes[name] = keccak256(code);
    console.log(`  ${name.padEnd(28)} ${deployed}  ${receipt.gasUsed} gas`);
    return deployed;
  }

  /**
   * The keeper, the operator and the curator.
   *
   * All three are the deployer in this release, and that is stated rather than hidden. The keeper
   * activates quotes (which commits the maker's capital), the operator cancels and recovers
   * funding, and the curator creates series. Separating them is a key-management change, not a
   * contract change: every one of the three is an immutable constructor argument, so splitting them
   * is a redeployment away and needs no code.
   */
  const keeper = account.address;
  const operator = account.address;
  const curator = account.address;

  const registry = await deploy("KyrveQuoteRegistry", [midnight]);
  const ratifier = await deploy("KyrveSettlementRatifier", [midnight, registry]);
  const verifier = await deploy("KyrvePublicResultVerifier", [
    curve["CurveResultVerifier"],
    curve["CurveGraphRegistry"],
    curve["NoxCurveEngine"],
    curve["QuoteEpochController"],
  ]);
  const activator = await deploy("QuoteActivator", [
    registry,
    verifier,
    curve["CurveUniverseRegistry"],
    ratifier,
    keeper,
  ]);
  const expiryController = await deploy("KyrveQuoteExpiryController", [registry, operator]);
  await deploy("KyrveSeriesFactory", [registry, activator, expiryController, curator]);

  // ── The three one-shot bindings ──────────────────────────────────────────────────────────
  console.log("\n  binding (one-shot, irreversible)...");
  const bindings: string[] = [];

  async function bind(
    contract: SettlementContract,
    functionName: string,
    argument: Address,
    getter: string,
  ): Promise<void> {
    const { abi } = artifact(contract);
    const hash = await wallet.writeContract({
      address: addresses[contract],
      abi: abi as never,
      functionName,
      args: [argument] as never,
      account,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${contract}.${functionName} reverted`);
    gasUsed += receipt.gasUsed;

    const bound = (await publicClient.readContract({
      address: addresses[contract],
      abi: abi as never,
      functionName: getter,
    })) as Address;
    if (bound.toLowerCase() !== argument.toLowerCase()) {
      throw new Error(`${contract}.${getter}() is ${bound}, expected ${argument}`);
    }
    bindings.push(`${contract}.${getter}() -> ${argument}`);
    console.log(`  ${contract.padEnd(28)} ${getter}() -> ${argument}`);
  }

  await bind("KyrveQuoteRegistry", "bindActivator", activator, "activator");
  await bind("KyrveQuoteRegistry", "bindExpiryController", expiryController, "expiryController");
  await bind("QuoteActivator", "bindFactory", addresses["KyrveSeriesFactory"], "factory");

  // ── Wiring, read back from chain state ───────────────────────────────────────────────────
  console.log("\n  verifying constructor wiring from chain state...");
  const wiringVerified: string[] = [];
  for (const rule of SETTLEMENT_WIRING) {
    const { abi } = artifact(rule.contract);
    const actual = (await publicClient.readContract({
      address: addresses[rule.contract],
      abi: abi as never,
      functionName: rule.getter,
    })) as Address;
    const expected =
      rule.expected === "midnight"
        ? midnight
        : rule.expected === "curve"
          ? curve[rule.curveKey ?? ""]
          : addresses[rule.expected];
    if (expected === undefined || actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(
        `${rule.contract}.${rule.getter}() is ${actual}, expected ${expected}. ${rule.why}`,
      );
    }
    wiringVerified.push(`${rule.contract}.${rule.getter}() -> ${expected}`);
  }
  console.log(`  ${wiringVerified.length}/${SETTLEMENT_WIRING.length} wiring checks PASS`);

  const deploymentId = (await publicClient.readContract({
    address: registry,
    abi: artifact("KyrveQuoteRegistry").abi as never,
    functionName: "DEPLOYMENT_ID",
  })) as Hex;

  const block = await publicClient.getBlockNumber();
  const timestamp = (await publicClient.getBlock({ blockNumber: block })).timestamp;
  const balanceAfter = await publicClient.getBalance({ address: account.address });

  const deployment: SettlementDeployment = {
    environment,
    chainId,
    deployer: account.address,
    deploymentBlock: block.toString(),
    deployedAt: new Date(Number(timestamp) * 1000).toISOString(),
    midnight,
    loanToken,
    keeper,
    operator,
    curator,
    compiler: SETTLEMENT_COMPILER,
    curve,
    addresses,
    runtimeHashes,
    deploymentId,
    bindings,
    wiringVerified,
    gasUsed: gasUsed.toString(),
    ethSpent: formatEther(balanceBefore - balanceAfter),
  };

  const payload = `${stableStringify(deployment)}\n`;
  assertNoSecrets(payload, `deployments/${environment}/settlement.json`);
  mkdirSync(repoPath(`deployments/${environment}`), { recursive: true });
  writeFileSync(repoPath(`deployments/${environment}/settlement.json`), payload);

  console.log(`\n  deployment id ${deploymentId}`);
  console.log(`  ${gasUsed} gas total, ${deployment.ethSpent} ETH`);
  console.log(`  recorded in deployments/${environment}/settlement.json\n`);
  return deployment;
}

// Only run when invoked directly; `deploySettlement` is imported by the local flow driver.
if (process.argv[1]?.endsWith("settlement.ts")) {
  const target: Environment = process.argv[2] === "sepolia" ? "sepolia" : "local";
  deploySettlement(target).catch((error: unknown) => {
    console.error(
      `\ndeploy:settlement FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
