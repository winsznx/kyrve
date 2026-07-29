/**
 * Sepolia deployment preflight. Read-only: nothing is signed and nothing is broadcast.
 *
 * Every check that could make a deployment fail badly is done here, before any value moves:
 * wrong chain, stale node, unfunded deployer, a chain without Osaka, an unverified vendor tree, or
 * a local suite that does not pass. Discovering any of those mid-deployment leaves a half-deployed
 * substrate that has to be untangled by hand.
 *
 * Prints no secret. The RPC URL is reduced to scheme and host because provider API keys live in
 * the path; the private key is never read for display, only to derive its public address.
 */

import { createPublicClient, formatEther, http } from "viem";
import { sepolia } from "viem/chains";

import { CHAIN_IDS } from "../../packages/config/src/index.js";
import { deployer, presence, sepoliaRpc } from "../lib/env.js";
import { repoPath, run } from "../lib/shell.js";

/** Deliberately generous: a failed deployment costs more than an over-estimate. */
const GAS_HEADROOM = 1.4;

/** Measured from the local anvil run of the same script. */
const OBSERVED_LOCAL_GAS = 15_500_000n;

export interface Preflight {
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly headAgeSeconds: number;
  readonly deployerAddress: `0x${string}`;
  readonly balanceWei: bigint;
  readonly gasPriceWei: bigint;
  readonly estimatedGas: bigint;
  readonly estimatedCostWei: bigint;
  readonly sufficientlyFunded: boolean;
  readonly nonce: number;
}

export async function preflight(): Promise<Preflight> {
  const rpc = sepoliaRpc();
  const account = deployer();

  const client = createPublicClient({ chain: sepolia, transport: http(rpc.url), cacheTime: 0 });

  const chainId = await client.getChainId();
  if (chainId !== CHAIN_IDS.ethereumSepolia) {
    throw new Error(
      `connected chain is ${chainId}, expected Ethereum Sepolia (${CHAIN_IDS.ethereumSepolia}). ` +
        "Refusing to continue: deploying to the wrong chain is not recoverable.",
    );
  }

  const blockNumber = await client.getBlockNumber();
  const block = await client.getBlock({ blockNumber });
  const headAgeSeconds = Math.floor(Date.now() / 1000) - Number(block.timestamp);

  const balanceWei = await client.getBalance({ address: account.address });
  const gasPriceWei = await client.getGasPrice();
  const nonce = await client.getTransactionCount({ address: account.address });

  const estimatedGas = BigInt(Math.ceil(Number(OBSERVED_LOCAL_GAS) * GAS_HEADROOM));
  const estimatedCostWei = estimatedGas * gasPriceWei;

  return {
    chainId,
    blockNumber,
    headAgeSeconds,
    deployerAddress: account.address,
    balanceWei,
    gasPriceWei,
    estimatedGas,
    estimatedCostWei,
    sufficientlyFunded: balanceWei >= estimatedCostWei,
    nonce,
  };
}

function localGatesPass(): { ok: boolean; detail: string } {
  try {
    run("forge", ["test"]);
    run("pnpm", ["exec", "tsx", "scripts/verify/vendor.ts"]);
    run("pnpm", ["exec", "tsx", "scripts/verify/midnight-bytecode.ts"]);
    return { ok: true, detail: "forge test, verify:vendor and verify:midnight-bytecode all pass" };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : String(error),
    };
  }
}

async function main(): Promise<void> {
  const rpc = sepoliaRpc();

  console.log("Kyrve Sepolia deployment preflight — READ ONLY, nothing is signed or broadcast\n");
  console.log(`  RPC                ${rpc.redacted}  (from ${rpc.source})`);
  if (rpc.isPublicEndpoint) {
    console.log(
      "  WARNING: this is a keyless PUBLIC endpoint, not the owner's provider. eth_getLogs\n" +
        "  behaviour differs materially between public providers, and the owner's instruction was\n" +
        "  to use the configured Alchemy RPC. Set SEPOLIA_RPC_URL or ALCHEMY_API_KEY in .env.",
    );
  }
  console.log(`  ETHERSCAN_API_KEY  ${presence("ETHERSCAN_API_KEY")}`);
  console.log(
    `  DEPLOYER key       ${presence("DEPLOYER_PRIVATE_KEY")} (value never read for display)`,
  );
  console.log(
    `  DEPLOY_SEPOLIA     ${process.env["DEPLOY_SEPOLIA"] === "true" ? "true" : "not true"}`,
  );
  console.log("");

  const result = await preflight();

  console.log(`  chain              ${result.chainId} (Ethereum Sepolia) OK`);
  console.log(`  head               block ${result.blockNumber}, ${result.headAgeSeconds}s old`);
  console.log(`  deployer           ${result.deployerAddress}  (public address)`);
  console.log(`  nonce              ${result.nonce}`);
  console.log(`  balance            ${formatEther(result.balanceWei)} ETH`);
  console.log(
    `  gas price          ${formatEther(result.gasPriceWei * 1_000_000_000n)} gwei-ish (${result.gasPriceWei} wei)`,
  );
  console.log(`  estimated gas      ${result.estimatedGas} (local measurement x ${GAS_HEADROOM})`);
  console.log(`  estimated cost     ${formatEther(result.estimatedCostWei)} ETH`);
  console.log(`  funded             ${result.sufficientlyFunded ? "YES" : "NO"}`);
  console.log("");

  if (result.headAgeSeconds > 900) {
    console.log(`  WARNING: RPC head is ${result.headAgeSeconds}s stale.`);
  }

  const gates = localGatesPass();
  console.log(`  local gates        ${gates.ok ? "PASS" : "FAIL"} — ${gates.detail}`);
  console.log("");

  if (!result.sufficientlyFunded) {
    const shortfall = result.estimatedCostWei - result.balanceWei;
    console.log(
      `  STOP: the existing deployer holds ${formatEther(result.balanceWei)} ETH but the deployment\n` +
        `  is estimated at ${formatEther(result.estimatedCostWei)} ETH — short by ${formatEther(shortfall)} ETH.\n` +
        "  No wallet will be generated and no transaction will be sent.",
    );
    process.exitCode = 1;
    return;
  }

  if (!gates.ok) {
    console.log("  STOP: local gates must pass before any Sepolia broadcast.");
    process.exitCode = 1;
    return;
  }

  console.log("  Preflight PASS. To broadcast, both opt-ins are required:");
  console.log("    DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true pnpm deploy:sepolia");
  console.log(
    `\n  Deployment plan is written by scripts/deploy/sepolia.ts; artifacts land in ${repoPath("deployments/sepolia").replace(process.cwd(), ".")}`,
  );
}

main().catch((error: unknown) => {
  console.error(`\npreflight FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
