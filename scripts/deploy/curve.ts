/**
 * Deploys the Phase 3 curve layer, to a local node or to Ethereum Sepolia.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * IT DOES NOT REDEPLOY PHASE 2
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The mandate book, the request book, the vault, the wrapped asset and the emergency controller
 * are already deployed and Etherscan-verified on Sepolia, and the curve engine is constructed
 * against those exact addresses. Redeploying them would produce a second confidential layer whose
 * mandates nobody holds and whose Sepolia verification would have to be redone — and would quietly
 * make the Phase 2 gate's evidence describe contracts nothing uses.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE-SHOT BINDINGS ARE PART OF THE DEPLOYMENT, NOT A FOLLOW-UP
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The controller, the graph registry and the ledger each reference the engine, and the engine
 * references all three, so one side of the cycle cannot be a constructor argument. `bindEngine` is
 * callable exactly once by the deployer and reverts forever after. A deployment that stopped
 * before binding would leave a layer that looks healthy and refuses every call, so the bindings
 * happen here and are read back from chain state before the manifest is written.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * SECRETS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The RPC URL is reduced to scheme and host in every line of output, the private key is never
 * printed, and the manifest is inspected for secrets before it is written.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { CONFIDENTIAL_COMPILER, NOX_COMPUTE_BY_CHAIN } from "@kyrve/config";
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
import { readJson, repoPath, stableStringify } from "../lib/shell.js";

const LOCAL_RPC = "http://127.0.0.1:8545";
/** Anvil/Hardhat account zero. A published test key; it holds nothing on any public network. */
const LOCAL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

export type Environment = "local" | "sepolia";

export const CURVE_CONTRACTS = [
  "CurveUniverseRegistry",
  "QuoteEpochController",
  "CurveGraphRegistry",
  "ReservationLedger",
  "NoxCurveEngine",
  "CurveResultVerifier",
] as const;

export type CurveContract = (typeof CURVE_CONTRACTS)[number];

const ARTIFACT_PATH: Readonly<Record<CurveContract, string>> = {
  CurveUniverseRegistry: "contracts/CurveUniverseRegistry.sol/CurveUniverseRegistry.json",
  QuoteEpochController: "contracts/QuoteEpochController.sol/QuoteEpochController.json",
  CurveGraphRegistry: "contracts/CurveGraphRegistry.sol/CurveGraphRegistry.json",
  ReservationLedger: "contracts/ReservationLedger.sol/ReservationLedger.json",
  NoxCurveEngine: "contracts/NoxCurveEngine.sol/NoxCurveEngine.json",
  CurveResultVerifier: "contracts/CurveResultVerifier.sol/CurveResultVerifier.json",
};

/**
 * Every constructor wiring, read back from the deployed contract's own getter.
 *
 * A broadcast log says what was sent, not what landed. An engine pointing at the wrong ledger
 * would deploy, verify on Etherscan and sit there looking correct until the first reservation went
 * somewhere nobody was watching.
 */
const CURVE_WIRING: readonly {
  contract: CurveContract;
  getter: string;
  expected: CurveContract | "phase2";
  phase2Key?: string;
  why: string;
}[] = [
  {
    contract: "QuoteEpochController",
    getter: "universes",
    expected: "CurveUniverseRegistry",
    why: "the controller sizes every stage from the universe's shape",
  },
  {
    contract: "CurveGraphRegistry",
    getter: "controller",
    expected: "QuoteEpochController",
    why: "the graph derives chunk ids from the controller",
  },
  {
    contract: "NoxCurveEngine",
    getter: "universes",
    expected: "CurveUniverseRegistry",
    why: "the engine reads the leaf table and the privacy floor from it",
  },
  {
    contract: "NoxCurveEngine",
    getter: "controller",
    expected: "QuoteEpochController",
    why: "the engine claims chunks and advances stages through it",
  },
  {
    contract: "NoxCurveEngine",
    getter: "graph",
    expected: "CurveGraphRegistry",
    why: "the engine registers every published handle there before publishing it",
  },
  {
    contract: "NoxCurveEngine",
    getter: "ledger",
    expected: "ReservationLedger",
    why: "the engine's only transient-handle recipient is fixed at deployment",
  },
  {
    contract: "NoxCurveEngine",
    getter: "mandateBook",
    expected: "phase2",
    phase2Key: "EncryptedMandateBook",
    why: "the engine reads the REAL mandate handles, so a different book is a different mandate set",
  },
  {
    contract: "NoxCurveEngine",
    getter: "requestBook",
    expected: "phase2",
    phase2Key: "ConfidentialRequestBook",
    why: "the request commitment is folded into the graph's genesis",
  },
  {
    contract: "NoxCurveEngine",
    getter: "vault",
    expected: "phase2",
    phase2Key: "KyrveConfidentialAssetVault",
    why: "the sealed balance snapshot is the sixth eligibility predicate",
  },
  {
    contract: "CurveResultVerifier",
    getter: "graph",
    expected: "CurveGraphRegistry",
    why: "the verifier's whole job is refusing a proof the graph never registered",
  },
  {
    contract: "CurveResultVerifier",
    getter: "engine",
    expected: "NoxCurveEngine",
    why: "the verifier reads the published handle set from the engine",
  },
];

interface Artifact {
  readonly abi: readonly unknown[];
  readonly bytecode: Hex;
}

interface Phase2Record {
  readonly addresses: Readonly<Record<string, Address>>;
}

export interface CurveDeployment {
  readonly environment: Environment;
  readonly chainId: number;
  readonly deployer: Address;
  readonly deploymentBlock: string;
  readonly deployedAt: string;
  readonly noxCompute: Address;
  readonly compiler: typeof CONFIDENTIAL_COMPILER;
  readonly phase2: Readonly<Record<string, Address>>;
  readonly addresses: Readonly<Record<CurveContract, Address>>;
  readonly runtimeHashes: Readonly<Record<CurveContract, Hex>>;
  readonly engineBoundInto: readonly string[];
  readonly wiringVerified: readonly string[];
  readonly gasUsed: string;
  readonly ethSpent: string;
}

function artifact(name: CurveContract): Artifact {
  const path = repoPath(`confidential/artifacts/${ARTIFACT_PATH[name]}`);
  if (!existsSync(path)) {
    throw new Error(
      `${name} has no artifact at ${path}. Run \`pnpm --filter @kyrve/confidential build\` first.`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as Artifact;
}

export async function deployCurve(environment: Environment): Promise<CurveDeployment> {
  const isSepolia = environment === "sepolia";
  const chain = isSepolia ? sepolia : hardhat;
  const chainId = isSepolia ? 11_155_111 : 31_337;

  const phase2Path = repoPath(`deployments/${environment}/confidential.json`);
  if (!existsSync(phase2Path)) {
    throw new Error(
      `no Phase 2 confidential deployment at ${phase2Path}. The curve layer is constructed against ` +
        "those exact addresses and deliberately does not redeploy them.",
    );
  }
  const phase2 = readJson<Phase2Record>(phase2Path).addresses;

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

  console.log(`Kyrve curve layer -> ${environment}\n`);
  console.log(`  RPC       ${redacted}`);
  console.log(`  deployer  ${account.address}`);

  const observed = await publicClient.getChainId();
  if (observed !== chainId) {
    throw new Error(`connected chain is ${observed}, expected ${chainId} for ${environment}`);
  }

  const noxCompute = NOX_COMPUTE_BY_CHAIN[chainId];
  if (noxCompute === undefined)
    throw new Error(`no NoxCompute address is known for chain ${chainId}`);
  const noxCode = await publicClient.getCode({ address: noxCompute });
  if (noxCode === undefined || noxCode === "0x") {
    throw new Error(`NoxCompute has no code at ${noxCompute}; the curve engine cannot function`);
  }

  // Every Phase 2 address must still hold code. Constructing the engine against an address that
  // does not would produce a layer that deploys and then reverts on its first seal.
  for (const [name, address] of Object.entries(phase2)) {
    const code = await publicClient.getCode({ address });
    if (code === undefined || code === "0x") {
      throw new Error(`the Phase 2 ${name} at ${address} has no code`);
    }
  }
  console.log(`  Nox       ${noxCompute}`);
  console.log(`  phase 2   ${Object.keys(phase2).length} contracts, all live\n`);

  const balanceBefore = await publicClient.getBalance({ address: account.address });
  console.log(`  balance   ${formatEther(balanceBefore)} ETH\n`);

  const addresses = {} as Record<CurveContract, Address>;
  const runtimeHashes = {} as Record<CurveContract, Hex>;
  let gasUsed = 0n;

  async function deploy(name: CurveContract, args: readonly unknown[]): Promise<Address> {
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
    console.log(`  ${name.padEnd(24)} ${deployed}  ${receipt.gasUsed} gas`);
    return deployed;
  }

  const universes = await deploy("CurveUniverseRegistry", [account.address]);
  const epochs = await deploy("QuoteEpochController", [
    universes,
    phase2["EncryptedMandateBook"],
    phase2["ConfidentialRequestBook"],
  ]);
  const graph = await deploy("CurveGraphRegistry", [epochs]);
  const ledger = await deploy("ReservationLedger", [phase2["KyrveEmergencyController"]]);
  const engine = await deploy("NoxCurveEngine", [
    universes,
    epochs,
    graph,
    ledger,
    phase2["EncryptedMandateBook"],
    phase2["ConfidentialRequestBook"],
    phase2["KyrveConfidentialAssetVault"],
    phase2["KyrveEmergencyController"],
  ]);
  await deploy("CurveResultVerifier", [graph, engine, epochs]);

  // ── The one-shot bindings ────────────────────────────────────────────────────────────────
  console.log("\n  binding the engine (one-shot, irreversible)...");
  const engineBoundInto: string[] = [];
  for (const target of [
    "QuoteEpochController",
    "CurveGraphRegistry",
    "ReservationLedger",
  ] as const) {
    const { abi } = artifact(target);
    const hash = await wallet.writeContract({
      address: addresses[target],
      abi: abi as never,
      functionName: "bindEngine",
      args: [engine] as never,
      account,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${target}.bindEngine reverted`);
    gasUsed += receipt.gasUsed;

    const bound = (await publicClient.readContract({
      address: addresses[target],
      abi: abi as never,
      functionName: "engine",
    })) as Address;
    if (bound.toLowerCase() !== engine.toLowerCase()) {
      throw new Error(`${target}.engine() is ${bound}, expected ${engine}`);
    }
    engineBoundInto.push(target);
    console.log(`  ${target.padEnd(24)} engine() -> ${engine}`);
  }

  // ── Wiring, read back from chain state ───────────────────────────────────────────────────
  console.log("\n  verifying constructor wiring from chain state...");
  const wiringVerified: string[] = [];
  for (const rule of CURVE_WIRING) {
    const { abi } = artifact(rule.contract);
    const actual = (await publicClient.readContract({
      address: addresses[rule.contract],
      abi: abi as never,
      functionName: rule.getter,
    })) as Address;
    const expected =
      rule.expected === "phase2" ? phase2[rule.phase2Key ?? ""] : addresses[rule.expected];
    if (expected === undefined || actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(
        `${rule.contract}.${rule.getter}() is ${actual}, expected ${expected}. ${rule.why}`,
      );
    }
    wiringVerified.push(`${rule.contract}.${rule.getter}() -> ${expected}`);
  }
  console.log(`  ${wiringVerified.length}/${CURVE_WIRING.length} wiring checks PASS`);

  const block = await publicClient.getBlockNumber();
  const timestamp = (await publicClient.getBlock({ blockNumber: block })).timestamp;
  const balanceAfter = await publicClient.getBalance({ address: account.address });

  const deployment: CurveDeployment = {
    environment,
    chainId,
    deployer: account.address,
    deploymentBlock: block.toString(),
    deployedAt: new Date(Number(timestamp) * 1000).toISOString(),
    noxCompute,
    compiler: CONFIDENTIAL_COMPILER,
    phase2,
    addresses,
    runtimeHashes,
    engineBoundInto,
    wiringVerified,
    gasUsed: gasUsed.toString(),
    ethSpent: formatEther(balanceBefore - balanceAfter),
  };

  const payload = `${stableStringify(deployment)}\n`;
  assertNoSecrets(payload, `deployments/${environment}/curve.json`);
  mkdirSync(repoPath(`deployments/${environment}`), { recursive: true });
  writeFileSync(repoPath(`deployments/${environment}/curve.json`), payload);

  console.log(`\n  ${gasUsed} gas total, ${deployment.ethSpent} ETH`);
  console.log(`  recorded in deployments/${environment}/curve.json\n`);
  return deployment;
}

const environment: Environment = process.argv[2] === "sepolia" ? "sepolia" : "local";
deployCurve(environment).catch((error: unknown) => {
  console.error(`\ndeploy:curve FAILED: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
