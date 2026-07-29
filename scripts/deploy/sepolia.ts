/**
 * Deploys the Kyrve public substrate to Ethereum Sepolia.
 *
 * This is the only script in the repository that moves real value, and it is built to refuse more
 * readily than to proceed:
 *
 *   - two independent opt-ins (`DEPLOY_SEPOLIA` and `KYRVE_CONFIRM_BROADCAST`), so a leftover
 *     `.env` line cannot on its own broadcast;
 *   - the chain id is checked against Ethereum Sepolia before anything is signed;
 *   - the deployer's balance is checked against a measured gas estimate, and the run stops rather
 *     than half-deploying;
 *   - the local suites and the vendor and bytecode locks must pass first;
 *   - the signing key travels through the child process environment, never argv.
 *
 * No wallet is ever generated. If the configured deployer is absent or unfunded, the correct
 * outcome is to stop and say so.
 *
 * SECRETS. The RPC URL is redacted to scheme and host in every line of output. The private key is
 * never printed. `assertNoSecrets` inspects each artifact before it is written.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, formatEther, type Hex, http, keccak256 } from "viem";
import { sepolia } from "viem/chains";

import { buildAllRateGrids } from "../generate/rate-grids.js";
import { assertBroadcastArmed, assertNoSecrets, deployer, sepoliaRpc } from "../lib/env.js";
import { readJson, repoPath, run, stableStringify } from "../lib/shell.js";
import { buildManifest, MARKET_KEYS, type RawDeployment } from "./manifest.js";
import { preflight } from "./preflight.js";

/**
 * Fixed maturity anchor, shared with the local deployment so market structs — and therefore market
 * ids — differ between chains only by the `chainId` and `midnight` fields embedded in them.
 */
const MATURITY_ANCHOR = 1_798_761_600;

const EXPLORER = "https://sepolia.etherscan.io";

interface BroadcastEntry {
  transactionType: string;
  contractName: string | null;
  contractAddress: string | null;
  hash: string | null;
}

interface BroadcastFile {
  transactions: BroadcastEntry[];
  receipts: Array<{ transactionHash: string; blockNumber: string; gasUsed: string }>;
}

async function main(): Promise<void> {
  const rpc = sepoliaRpc();

  console.log("Kyrve Sepolia substrate deployment\n");
  console.log(`  RPC  ${rpc.redacted}  (from ${rpc.source})`);

  if (rpc.isPublicEndpoint) {
    throw new Error(
      "refusing to deploy through a keyless public RPC. Configure the owner's Alchemy endpoint " +
        "via ALCHEMY_API_KEY or SEPOLIA_RPC_URL.",
    );
  }

  // Two independent opt-ins, checked before anything else touches the network.
  assertBroadcastArmed();

  console.log("  running preflight...\n");
  const pre = await preflight();

  if (pre.chainId !== 11155111) {
    throw new Error(`connected chain is ${pre.chainId}, not Ethereum Sepolia`);
  }
  if (!pre.sufficientlyFunded) {
    throw new Error(
      `deployer ${pre.deployerAddress} holds ${formatEther(pre.balanceWei)} ETH, below the ` +
        `${formatEther(pre.estimatedCostWei)} ETH estimate. Stopping. No wallet will be generated.`,
    );
  }

  console.log(`  deployer  ${pre.deployerAddress}`);
  console.log(`  balance   ${formatEther(pre.balanceWei)} ETH`);
  console.log(`  estimate  ${formatEther(pre.estimatedCostWei)} ETH at ${pre.gasPriceWei} wei/gas`);
  console.log(`  head      block ${pre.blockNumber}\n`);

  console.log("  local gates must pass before broadcast...");
  run("forge", ["test"]);
  run("pnpm", ["exec", "tsx", "scripts/verify/vendor.ts"]);
  run("pnpm", ["exec", "tsx", "scripts/verify/midnight-bytecode.ts"]);
  console.log("  local gates PASS\n");

  const outDir = repoPath("deployments/sepolia");
  mkdirSync(outDir, { recursive: true });
  const rawPath = `${outDir}/.raw-deployment.json`;

  console.log("  broadcasting DeployKyrveSubstrate to Ethereum Sepolia...");
  console.log("  (--slow: one transaction at a time, each awaited)\n");

  const account = deployer();
  run(
    "forge",
    [
      "script",
      "contracts/script/DeployKyrveSubstrate.s.sol",
      "--rpc-url",
      rpc.url,
      "--broadcast",
      "--slow",
    ],
    {
      env: {
        KYRVE_MATURITY_ANCHOR: String(MATURITY_ANCHOR),
        KYRVE_DEPLOYMENT_OUT: rawPath,
        // Environment, never argv.
        KYRVE_DEPLOYER_KEY: account.privateKey,
      },
    },
  );

  const raw = readJson<RawDeployment>(rawPath);
  const client = createPublicClient({ chain: sepolia, transport: http(rpc.url), cacheTime: 0 });

  // Read every address back from chain rather than trusting the broadcast log.
  const contractKeys = [
    "Midnight",
    "TestUSDC",
    "TestWETH",
    "TestWstETH",
    "WethOracle",
    "WstethOracle",
    "KyrveOsakaProbe",
    "KyrveProtocolRegistry",
    "KyrveDeploymentVerifier",
  ] as const;

  for (const name of contractKeys) {
    const code = await client.getCode({ address: raw[name] });
    if (code === undefined || code === "0x") {
      throw new Error(
        `${name} at ${raw[name]} has no code on Sepolia — the deployment did not land`,
      );
    }
  }

  // Prove Osaka from the deployed probe on the real chain.
  const osakaOk = await client.readContract({
    address: raw.KyrveOsakaProbe,
    abi: [
      {
        type: "function",
        name: "verifyOsaka",
        inputs: [],
        outputs: [{ type: "bool" }],
        stateMutability: "pure",
      },
    ],
    functionName: "verifyOsaka",
  });
  if (osakaOk !== true)
    throw new Error("the deployed Osaka probe reports Sepolia does not execute Osaka");

  const midnightCode = await client.getCode({ address: raw.Midnight });
  if (midnightCode === undefined) throw new Error("Midnight has no code");

  const block = await client.getBlockNumber();
  const deployedAt = new Date(
    Number((await client.getBlock({ blockNumber: block })).timestamp) * 1000,
  );

  // Transaction hashes come from the broadcast log, which is the only place they exist.
  const txByContract = new Map<string, string>();
  const broadcastPath = repoPath("broadcast/DeployKyrveSubstrate.s.sol/11155111/run-latest.json");
  let totalGasUsed = 0n;
  let deploymentBlock = block;

  if (existsSync(broadcastPath)) {
    const broadcast = readJson<BroadcastFile>(broadcastPath);
    for (const tx of broadcast.transactions) {
      if (tx.contractName !== null && tx.contractAddress !== null && tx.hash !== null) {
        txByContract.set(tx.contractAddress.toLowerCase(), tx.hash);
      }
    }
    for (const receipt of broadcast.receipts) {
      totalGasUsed += BigInt(receipt.gasUsed);
      const b = BigInt(receipt.blockNumber);
      if (b < deploymentBlock) deploymentBlock = b;
    }
  }

  const grids = buildAllRateGrids(MATURITY_ANCHOR);

  const { manifest, addresses, markets } = buildManifest({
    environment: "sepolia",
    chainId: 11155111,
    raw,
    deploymentBlock,
    midnightRuntimeHash: keccak256(midnightCode),
    grids,
    maturityAnchor: MATURITY_ANCHOR,
    deployedAt,
    // Etherscan verification is a separate, retryable step.
    verifiedSource: "pending",
    explorerBase: EXPLORER,
    transactionHashes: txByContract,
  });

  for (const [file, payload] of [
    ["manifest.json", stableStringify(manifest)],
    ["addresses.json", stableStringify(addresses)],
    ["markets.json", stableStringify(markets)],
  ] as const) {
    assertNoSecrets(payload, `deployments/sepolia/${file}`);
    writeFileSync(`${outDir}/${file}`, payload);
  }

  const spent = totalGasUsed * pre.gasPriceWei;
  const after = await client.getBalance({ address: pre.deployerAddress });

  console.log("\nKyrve Sepolia substrate deployed\n");
  console.log(`  chain             11155111 (Ethereum Sepolia)`);
  console.log(`  deployment block  ${deploymentBlock}`);
  console.log(`  gas used          ${totalGasUsed} (~${formatEther(spent)} ETH)`);
  console.log(`  balance after     ${formatEther(after)} ETH`);
  console.log(`  Osaka             verifyOsaka() -> true on chain\n`);

  for (const name of contractKeys) {
    console.log(`  ${name.padEnd(24)} ${raw[name]}`);
  }
  console.log("");
  for (const [i, key] of MARKET_KEYS.entries()) {
    console.log(`  market ${i} ${key.padEnd(16)} ${raw.marketIds[i]}`);
  }

  console.log(`\n  manifests written to deployments/sepolia/`);
  console.log("  next: pnpm verify:etherscan   then   pnpm test:sepolia");
}

main().catch((error: unknown) => {
  console.error(`\ndeployment FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
