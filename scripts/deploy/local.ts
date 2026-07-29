/**
 * Deterministic local deployment of the complete Kyrve public substrate.
 *
 * Starts a fresh anvil, broadcasts `DeployKyrveSubstrate.s.sol` against it, reads the resulting
 * chain state back, and writes the three manifests. Nothing is taken on trust from the broadcast
 * log: every address is re-read from the chain, and every market id is re-derived from the market
 * struct and compared against what Midnight itself returned.
 *
 * Determinism comes from a fixed maturity anchor and a fixed anvil mnemonic, so running this twice
 * produces byte-identical manifests. `scripts/verify/local-reproducibility.ts` asserts exactly that.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, http, keccak256 } from "viem";
import { buildAllRateGrids } from "../generate/rate-grids.js";
import {
  REPO_ROOT,
  readJson,
  repoPath,
  run,
  stableStringify,
  startBackground,
  waitFor,
} from "../lib/shell.js";
import { buildManifest, MARKET_KEYS, type RawDeployment } from "./manifest.js";

/**
 * Fixed so market maturities — and therefore market ids — are reproducible.
 * 2027-01-01T00:00:00Z. Chosen in the future so every launch market is live, and fixed so it never
 * depends on when the deployment ran.
 */
export const MATURITY_ANCHOR = 1_798_761_600;

const ANVIL_PORT = 8545;
const ANVIL_RPC = `http://127.0.0.1:${ANVIL_PORT}`;

/** anvil's documented default mnemonic. Local-only; these keys hold nothing anywhere. */
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
const ANVIL_DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

async function main(): Promise<void> {
  const outDir = repoPath("deployments/local");
  mkdirSync(outDir, { recursive: true });
  const rawPath = repoPath("deployments/local/.raw-deployment.json");

  console.log("starting anvil...");
  const anvil = startBackground("anvil", [
    "--port",
    String(ANVIL_PORT),
    "--mnemonic",
    ANVIL_MNEMONIC,
    "--silent",
  ]);

  try {
    // cacheTime: 0 is load-bearing. viem caches getBlockNumber for cacheTime ms (default =
    // pollingInterval), so the readiness probe below would otherwise poison the later read and
    // write a stale block number into the manifest.
    const client = createPublicClient({ transport: http(ANVIL_RPC), cacheTime: 0 });
    await waitFor(async () => (await client.getBlockNumber()) >= 0n, {
      description: "anvil to accept RPC",
    });

    const chainId = await client.getChainId();
    console.log(`anvil up, chain ${chainId}`);

    console.log("broadcasting DeployKyrveSubstrate...");
    run(
      "forge",
      [
        "script",
        "contracts/script/DeployKyrveSubstrate.s.sol",
        "--rpc-url",
        ANVIL_RPC,
        "--broadcast",
        "--private-key",
        ANVIL_DEPLOYER_KEY,
        "--slow",
      ],
      {
        env: {
          KYRVE_MATURITY_ANCHOR: String(MATURITY_ANCHOR),
          KYRVE_DEPLOYMENT_OUT: rawPath,
        },
      },
    );

    const raw = readJson<RawDeployment>(rawPath);

    // Re-read every CONTRACT address from the chain rather than trusting the broadcast log.
    // `deployer` is deliberately excluded: it is an EOA and correctly has no code.
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
      const address = raw[name];
      const code = await client.getCode({ address });
      if (code === undefined || code === "0x") {
        throw new Error(`${name} at ${address} has no code on chain — the deployment did not land`);
      }
    }

    // Prove Osaka from the deployed probe, not from a recorded result.
    const osakaOk = await client.readContract({
      address: raw.KyrveOsakaProbe as `0x${string}`,
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
    if (osakaOk !== true) {
      throw new Error("the deployed Osaka probe reports the chain does not execute Osaka");
    }

    const block = await client.getBlockNumber();
    if (block === 0n) {
      throw new Error("chain is still at block 0 after broadcasting — nothing was mined");
    }
    const deployedAt = new Date(
      Number((await client.getBlock({ blockNumber: block })).timestamp) * 1000,
    );
    const midnightCode = await client.getCode({ address: raw.Midnight as `0x${string}` });
    if (midnightCode === undefined) throw new Error("Midnight has no code");

    const grids = buildAllRateGrids(MATURITY_ANCHOR);

    const { manifest, addresses, markets } = buildManifest({
      environment: "local",
      chainId,
      raw,
      deploymentBlock: block,
      midnightRuntimeHash: keccak256(midnightCode),
      grids,
      maturityAnchor: MATURITY_ANCHOR,
      deployedAt,
      verifiedSource: "not-applicable",
      explorerBase: null,
    });

    writeFileSync(repoPath("deployments/local/manifest.json"), stableStringify(manifest));
    writeFileSync(repoPath("deployments/local/addresses.json"), stableStringify(addresses));
    writeFileSync(repoPath("deployments/local/markets.json"), stableStringify(markets));

    console.log("\nKyrve local substrate deployed");
    console.log(`  chain            ${chainId}`);
    console.log(`  block            ${block}`);
    console.log(`  Midnight         ${raw.Midnight}`);
    console.log(`  OsakaProbe       ${raw.KyrveOsakaProbe}  (verifyOsaka -> true)`);
    console.log(`  ProtocolRegistry ${raw.KyrveProtocolRegistry}`);
    console.log(`  Verifier         ${raw.KyrveDeploymentVerifier}`);
    for (const [i, key] of MARKET_KEYS.entries()) {
      console.log(`  market ${i} ${key.padEnd(16)} ${raw.marketIds[i]}`);
    }
    console.log(`\nmanifests written to ${outDir.replace(REPO_ROOT, ".")}`);
  } finally {
    anvil.kill();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
