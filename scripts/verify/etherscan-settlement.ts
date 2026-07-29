/**
 * Etherscan V2 source verification for the Phase 4 settlement layer.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS DRIVES FOUNDRY AND `etherscan-curve.ts` DOES NOT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The confidential layer is compiled by Hardhat at solc 0.8.36 with its own remappings, so Foundry
 * cannot reproduce those artifacts and `etherscan-curve.ts` submits Hardhat's own standard-JSON input
 * instead. The settlement layer is the opposite case: it IS a Foundry build, at 0.8.34 with
 * `via_ir`, 466 optimizer runs and `evm_version = "osaka"`, so `forge verify-contract` recompiles
 * exactly what was deployed. Asking Foundry to verify Foundry's own output is the shortest path
 * between the source and the explorer.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE FULLY QUALIFIED NAME IS NOT OPTIONAL
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Two Solidity files may not share a basename — `verify:basenames` refuses it, because Foundry
 * silently drops one artifact — but two CONTRACT names can still be ambiguous to `forge
 * verify-contract` if it is given a bare name. Every submission here passes `path:Contract`, so the
 * compiler is never asked to guess which source produced the runtime code on chain.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IS RECORDED, AND WHY EACH FIELD
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Address, deployment transaction hash, ABI-encoded constructor arguments, compiler settings,
 * runtime bytecode hash, verification status and the explorer URL. The runtime hash is the one field
 * that makes the rest checkable: a verified source that compiles to different code than the chain
 * holds would otherwise look identical to a correct record.
 *
 * `KyrveSeriesVault` is included as a DEPLOYED INSTANCE rather than as an implementation. There is no
 * proxy: the factory deploys a real vault per series with CREATE2, so each instance is separately
 * verifiable and its constructor arguments differ. Every instance the factory has created is
 * enumerated from chain state and submitted.
 *
 * SECRETS. The API key reaches `forge` through the environment, is never printed, and
 * `assertNoSecrets` inspects the artifact before it is written.
 */

import { existsSync, writeFileSync } from "node:fs";

import { type Address, createPublicClient, type Hex, http, keccak256 } from "viem";
import { sepolia } from "viem/chains";
import { SETTLEMENT_COMPILER } from "../deploy/settlement.js";
import { assertNoSecrets, etherscanApiKey, sepoliaRpc } from "../lib/env.js";
import { readJson, repoPath, run, stableStringify } from "../lib/shell.js";

const CHAIN_ID = 11155111;
const EXPLORER = "https://sepolia.etherscan.io";

/** Every settlement contract, and the source path `forge verify-contract` must be given. */
const SOURCE_PATH: Readonly<Record<string, string>> = {
  KyrveQuoteRegistry: "contracts/kyrve/KyrveQuoteRegistry.sol",
  KyrveSettlementRatifier: "contracts/kyrve/KyrveSettlementRatifier.sol",
  KyrvePublicResultVerifier: "contracts/kyrve/KyrvePublicResultVerifier.sol",
  QuoteActivator: "contracts/kyrve/QuoteActivator.sol",
  KyrveQuoteExpiryController: "contracts/kyrve/KyrveQuoteExpiryController.sol",
  KyrveSeriesFactory: "contracts/kyrve/KyrveSeriesFactory.sol",
  KyrveSeriesVault: "contracts/kyrve/KyrveSeriesVault.sol",
};

interface Deployment {
  readonly chainId: number;
  readonly midnight: Address;
  readonly loanToken: Address;
  readonly keeper: Address;
  readonly operator: Address;
  readonly curator: Address;
  readonly curve: Readonly<Record<string, Address>>;
  readonly addresses: Readonly<Record<string, Address>>;
  readonly runtimeHashes: Readonly<Record<string, Hex>>;
}

interface Submission {
  readonly contract: string;
  readonly fullyQualifiedName: string;
  readonly address: Address;
  readonly deploymentTxHash: string | null;
  readonly constructorArgs: string;
  readonly runtimeBytecodeHash: Hex;
  readonly status: "verified" | "already-verified" | "failed";
  readonly detail: string;
  readonly explorerUrl: string;
}

/**
 * ABI-encoded constructor arguments, hex without `0x`, exactly as deployed.
 *
 * Encoded with `cast abi-encode` rather than by hand, for the same reason `etherscan-curve.ts` does:
 * a hand-rolled head/tail layout is the kind of code that is subtly wrong and produces a
 * verification failure whose message explains nothing.
 *
 * These MUST match `scripts/deploy/settlement.ts`. Written out rather than derived because a wrong
 * value fails loudly at Etherscan, whereas a clever derivation that drifts from the deployer would
 * fail silently on the next contract added.
 */
function constructorArgs(contract: string, deployment: Deployment, vault?: VaultInstance): string {
  const encode = (signature: string, values: string[]): string =>
    run("cast", ["abi-encode", signature, ...values])
      .stdout.trim()
      .replace(/^0x/, "");

  const a = deployment.addresses;
  switch (contract) {
    case "KyrveQuoteRegistry":
      return encode("f(address)", [deployment.midnight]);
    case "KyrveSettlementRatifier":
      return encode("f(address,address)", [deployment.midnight, a["KyrveQuoteRegistry"] ?? ""]);
    case "KyrvePublicResultVerifier":
      return encode("f(address,address,address,address)", [
        deployment.curve["CurveResultVerifier"] ?? "",
        deployment.curve["CurveGraphRegistry"] ?? "",
        deployment.curve["NoxCurveEngine"] ?? "",
        deployment.curve["QuoteEpochController"] ?? "",
      ]);
    case "QuoteActivator":
      return encode("f(address,address,address,address,address)", [
        a["KyrveQuoteRegistry"] ?? "",
        a["KyrvePublicResultVerifier"] ?? "",
        deployment.curve["CurveUniverseRegistry"] ?? "",
        a["KyrveSettlementRatifier"] ?? "",
        deployment.keeper,
      ]);
    case "KyrveQuoteExpiryController":
      return encode("f(address,address)", [a["KyrveQuoteRegistry"] ?? "", deployment.operator]);
    case "KyrveSeriesFactory":
      return encode("f(address,address,address,address)", [
        a["KyrveQuoteRegistry"] ?? "",
        a["QuoteActivator"] ?? "",
        a["KyrveQuoteExpiryController"] ?? "",
        deployment.curator,
      ]);
    case "KyrveSeriesVault": {
      if (vault === undefined) throw new Error("a vault submission needs its instance details");
      return encode("f(address,address,address,address,address,address,bytes32)", [
        deployment.midnight,
        a["KyrveQuoteRegistry"] ?? "",
        a["QuoteActivator"] ?? "",
        a["KyrveQuoteExpiryController"] ?? "",
        vault.loanToken,
        vault.operator,
        vault.seriesId,
      ]);
    }
    default:
      throw new Error(`no constructor encoding is declared for ${contract}`);
  }
}

interface VaultInstance {
  readonly address: Address;
  readonly seriesId: Hex;
  readonly loanToken: Address;
  readonly operator: Address;
  readonly runtimeHash: Hex;
}

const VAULT_ABI = [
  {
    type: "function",
    name: "SERIES_ID",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "LOAN_TOKEN",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "OPERATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

const FACTORY_ABI = [
  {
    type: "function",
    name: "vaultCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "vaultAt",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

/**
 * Every vault the factory has created, read from chain state.
 *
 * Enumerated rather than assumed: the factory is the only thing that knows how many series exist,
 * and a record that verified a fixed list would silently stop covering the newest vault.
 */
async function vaultInstances(deployment: Deployment): Promise<VaultInstance[]> {
  const rpc = sepoliaRpc();
  const client = createPublicClient({ chain: sepolia, transport: http(rpc.url), cacheTime: 0 });
  const factory = deployment.addresses["KyrveSeriesFactory"];
  if (factory === undefined) throw new Error("the manifest records no factory address");

  const count = (await client.readContract({
    address: factory,
    abi: FACTORY_ABI,
    functionName: "vaultCount",
  })) as bigint;

  const instances: VaultInstance[] = [];
  for (let index = 0n; index < count; index += 1n) {
    const address = (await client.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: "vaultAt",
      args: [index],
    })) as Address;

    const [seriesId, loanToken, operator, code] = await Promise.all([
      client.readContract({ address, abi: VAULT_ABI, functionName: "SERIES_ID" }) as Promise<Hex>,
      client.readContract({
        address,
        abi: VAULT_ABI,
        functionName: "LOAN_TOKEN",
      }) as Promise<Address>,
      client.readContract({
        address,
        abi: VAULT_ABI,
        functionName: "OPERATOR",
      }) as Promise<Address>,
      client.getCode({ address }),
    ]);
    if (code === undefined || code === "0x") throw new Error(`vault ${address} has no code`);
    instances.push({ address, seriesId, loanToken, operator, runtimeHash: keccak256(code) });
  }
  return instances;
}

/** The transaction that created a contract, from Etherscan. Recorded, never required. */
async function creationTx(address: Address, apiKey: string): Promise<string | null> {
  const response = await fetch(
    `https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}&module=contract` +
      `&action=getcontractcreation&contractaddresses=${address}&apikey=${encodeURIComponent(apiKey)}`,
  );
  const json = (await response.json()) as { status: string; result?: { txHash?: string }[] };
  if (json.status !== "1") return null;
  return json.result?.[0]?.txHash ?? null;
}

function submit(
  contract: string,
  address: Address,
  args: string,
  apiKey: string,
): { status: Submission["status"]; detail: string } {
  const sourcePath = SOURCE_PATH[contract];
  if (sourcePath === undefined) throw new Error(`no source path is declared for ${contract}`);

  const result = run(
    "forge",
    [
      "verify-contract",
      address,
      `${sourcePath}:${contract}`,
      "--chain",
      String(CHAIN_ID),
      "--constructor-args",
      `0x${args}`,
      "--watch",
      "--etherscan-api-key",
      apiKey,
    ],
    { allowFailure: true },
  );

  const output = `${result.stdout}\n${result.stderr}`;
  // "already verified" arrives as an error. Treating it as a failure would mean re-running this
  // script could turn a verified contract into a red gate.
  if (/already verified/i.test(output))
    return { status: "already-verified", detail: "already verified" };
  if (/Contract successfully verified/i.test(output)) {
    return { status: "verified", detail: "Contract successfully verified" };
  }
  return {
    status: "failed",
    detail: output
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .slice(-2)
      .join(" | "),
  };
}

async function main(): Promise<void> {
  const recordPath = repoPath("deployments/sepolia/settlement.json");
  if (!existsSync(recordPath)) {
    throw new Error(
      "no deployments/sepolia/settlement.json — run `pnpm deploy:settlement sepolia` first. " +
        "Verifying a deployment that was never recorded would be verifying nothing.",
    );
  }
  const deployment = readJson<Deployment>(recordPath);
  const apiKey = etherscanApiKey();

  console.log("Etherscan V2 verification — Kyrve settlement layer on Ethereum Sepolia\n");
  console.log(
    `  compiler   v${SETTLEMENT_COMPILER.solc}, evm ${SETTLEMENT_COMPILER.evmVersion}, ` +
      `${SETTLEMENT_COMPILER.optimizerRuns} runs, via_ir, bytecode_hash none`,
  );
  console.log("  source     recompiled by Foundry — the same build that produced the deployment");
  console.log("  API key    set (value never printed)\n");

  const vaults = await vaultInstances(deployment);
  console.log(`  the factory has created ${vaults.length} vault instance(s)\n`);

  const submissions: Submission[] = [];

  for (const contract of Object.keys(SOURCE_PATH).filter((name) => name !== "KyrveSeriesVault")) {
    const address = deployment.addresses[contract];
    if (address === undefined) throw new Error(`the manifest records no address for ${contract}`);
    const args = constructorArgs(contract, deployment);

    process.stdout.write(`  ${contract.padEnd(28)} `);
    const outcome = submit(contract, address, args, apiKey);
    const runtimeHash = deployment.runtimeHashes[contract];
    if (runtimeHash === undefined)
      throw new Error(`the manifest records no runtime hash for ${contract}`);

    submissions.push({
      contract,
      fullyQualifiedName: `${SOURCE_PATH[contract]}:${contract}`,
      address,
      deploymentTxHash: await creationTx(address, apiKey),
      constructorArgs: args,
      runtimeBytecodeHash: runtimeHash,
      status: outcome.status,
      detail: outcome.detail,
      explorerUrl: `${EXPLORER}/address/${address}#code`,
    });
    console.log(outcome.status.toUpperCase());
    if (outcome.status === "failed") console.log(`    ${outcome.detail}`);
  }

  for (const vault of vaults) {
    const args = constructorArgs("KyrveSeriesVault", deployment, vault);
    process.stdout.write(`  ${"KyrveSeriesVault".padEnd(28)} `);
    const outcome = submit("KyrveSeriesVault", vault.address, args, apiKey);
    submissions.push({
      contract: "KyrveSeriesVault",
      fullyQualifiedName: `${SOURCE_PATH["KyrveSeriesVault"]}:KyrveSeriesVault`,
      address: vault.address,
      deploymentTxHash: await creationTx(vault.address, apiKey),
      constructorArgs: args,
      runtimeBytecodeHash: vault.runtimeHash,
      status: outcome.status,
      detail: outcome.detail,
      explorerUrl: `${EXPLORER}/address/${vault.address}#code`,
    });
    console.log(`${outcome.status.toUpperCase()}  ${vault.address}`);
    if (outcome.status === "failed") console.log(`    ${outcome.detail}`);
  }

  const verified = submissions.filter((entry) => entry.status !== "failed").length;
  const payload = stableStringify({
    $comment:
      "PUBLIC verification metadata only. No API key, no RPC URL, no key material. GENERATED by " +
      "`pnpm verify:etherscan:settlement`. Vault instances are enumerated from the factory's own " +
      "chain state, so the record covers every series that exists rather than a fixed list.",
    chainId: CHAIN_ID,
    explorer: EXPLORER,
    compiler: SETTLEMENT_COMPILER,
    verified,
    total: submissions.length,
    vaultInstances: vaults.length,
    contracts: submissions,
  });
  assertNoSecrets(payload, "deployments/sepolia/settlement-etherscan.json");
  writeFileSync(repoPath("deployments/sepolia/settlement-etherscan.json"), payload);

  console.log(`\n  ${verified}/${submissions.length} contracts verified`);
  console.log("  metadata written to deployments/sepolia/settlement-etherscan.json");

  if (verified !== submissions.length) {
    console.error("\nverify:etherscan:settlement FAILED — not every contract is verified");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
