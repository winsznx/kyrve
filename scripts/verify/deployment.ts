/**
 * Read-only verification of a live deployment against its manifest.
 *
 * Every check reads the chain and compares. Nothing is broadcast, no key is required, and no
 * account-level credential is used — this is safe to run in CI against a public RPC.
 *
 * The proxy nuance is stated rather than glossed: `KyrveDeploymentVerifier` cannot read another
 * contract's storage, so the NoxCompute proxy-to-implementation binding is established HERE, off
 * chain, by reading the EIP-1967 slot with `eth_getStorageAt`.
 */

import { existsSync } from "node:fs";
import { createPublicClient, type Hex, http, keccak256 } from "viem";

import {
  chainById,
  parseDeploymentManifest,
  requireContract,
} from "../../packages/config/src/index.js";
import { readJson, repoPath } from "../lib/shell.js";

/** bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1) */
const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;

const OSAKA_PROBE_ABI = [
  {
    type: "function",
    name: "verifyOsaka",
    inputs: [],
    outputs: [{ type: "bool" }],
    stateMutability: "pure",
  },
] as const;

async function main(): Promise<void> {
  const environment = process.argv[2] ?? "sepolia";
  const manifestPath = repoPath(`deployments/${environment}/manifest.json`);

  if (!existsSync(manifestPath)) {
    console.error(
      `no manifest at deployments/${environment}/manifest.json.\n` +
        `  local:   pnpm deploy:local\n` +
        `  sepolia: DEPLOY_SEPOLIA=true pnpm deploy:sepolia`,
    );
    process.exitCode = 1;
    return;
  }

  const manifest = parseDeploymentManifest(readJson(manifestPath));
  const chain = chainById(manifest.chainId);

  const rpcUrl =
    process.env["SEPOLIA_RPC_URL"] ??
    (environment === "local" ? "http://127.0.0.1:8545" : undefined);
  if (rpcUrl === undefined) {
    console.error(
      "SEPOLIA_RPC_URL is not set. See .env.example; the pinned default is https://sepolia.drpc.org",
    );
    process.exitCode = 1;
    return;
  }

  const client = createPublicClient({ transport: http(rpcUrl), cacheTime: 0 });
  const failures: string[] = [];
  const notes: string[] = [];

  // 1. Chain identity and freshness.
  const chainId = await client.getChainId();
  if (chainId !== manifest.chainId) {
    failures.push(`RPC serves chain ${chainId}, manifest is for ${manifest.chainId}`);
  }
  const head = await client.getBlockNumber();
  const headBlock = await client.getBlock({ blockNumber: head });
  const ageSeconds = Math.floor(Date.now() / 1000) - Number(headBlock.timestamp);
  notes.push(`chain ${chainId} (${chain.name}) at block ${head}, head is ${ageSeconds}s old`);
  if (environment !== "local" && ageSeconds > 3600) {
    failures.push(`RPC head is ${ageSeconds}s stale; refusing to verify against a lagging node`);
  }

  // 2. Every contract in the manifest has code.
  for (const [name, record] of Object.entries(manifest.contracts)) {
    const code = await client.getCode({ address: record.address });
    if (code === undefined || code === "0x") {
      failures.push(`${name} at ${record.address} has no code on chain`);
    }
  }

  // 3. Midnight's runtime bytecode is exactly what the manifest recorded. This is the check that
  //    catches a substituted or redeployed protocol core.
  const midnight = requireContract(manifest, "Midnight");
  const midnightCode = await client.getCode({ address: midnight.address });
  if (midnightCode !== undefined && midnightCode !== "0x") {
    const actual = keccak256(midnightCode);
    if (actual !== midnight.runtimeBytecodeHash) {
      failures.push(
        `Midnight runtime bytecode is ${actual}, manifest records ${midnight.runtimeBytecodeHash}. ` +
          "The deployed core is not the one this build expects.",
      );
    } else {
      notes.push(`Midnight runtime bytecode matches the manifest (${actual.slice(0, 18)}..)`);
    }
  }

  // 4. Osaka, executed from the deployed probe rather than assumed.
  const probe = requireContract(manifest, "KyrveOsakaProbe");
  try {
    const ok = await client.readContract({
      address: probe.address,
      abi: OSAKA_PROBE_ABI,
      functionName: "verifyOsaka",
    });
    if (ok !== true)
      failures.push("the deployed Osaka probe reports the chain does not execute Osaka");
    else notes.push("Osaka verified on chain via the deployed CLZ probe");
  } catch (error) {
    failures.push(
      `the Osaka probe reverted, which is what a chain without the CLZ opcode would do: ` +
        `${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
    );
  }

  // 5. NoxCompute proxy -> implementation, read off chain because no contract can read another
  //    contract's storage.
  if (chain.noxCompute !== null) {
    const slot = await client.getStorageAt({
      address: chain.noxCompute,
      slot: EIP1967_IMPLEMENTATION_SLOT,
    });
    const implementation = slot === undefined ? "0x" : (`0x${slot.slice(-40)}` as Hex);
    if (implementation === "0x" || /^0x0+$/.test(implementation)) {
      failures.push(`NoxCompute at ${chain.noxCompute} has an empty EIP-1967 implementation slot`);
    } else {
      const implCode = await client.getCode({ address: implementation });
      notes.push(
        `NoxCompute ${chain.noxCompute} -> implementation ${implementation} ` +
          `(${implCode === undefined ? 0 : (implCode.length - 2) / 2} bytes)`,
      );
    }
  }

  // 6. Market ids resolve. Midnight stores market parameters at the last 20 bytes of the id.
  for (const market of manifest.markets) {
    const paramsAddress = `0x${market.id.slice(-40)}` as Hex;
    const code = await client.getCode({ address: paramsAddress });
    if (code === undefined || code === "0x") {
      failures.push(
        `market ${market.key} (${market.id}) has no parameters contract at ${paramsAddress}; ` +
          "the market was never touched on this chain",
      );
    }
  }

  for (const note of notes) console.log(`  ${note}`);

  if (failures.length > 0) {
    console.error(`\nverify:deployment FAILED (${environment})\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `verify:deployment PASS (${environment}) — ${Object.keys(manifest.contracts).length} contracts, ` +
      `${manifest.markets.length} markets, Osaka confirmed on chain`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
