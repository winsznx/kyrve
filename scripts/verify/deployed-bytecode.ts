/**
 * Compares the CURRENT build of every Kyrve contract in a deployment manifest against the runtime
 * bytecode actually on chain.
 *
 * `verify:midnight-bytecode` proves the build is reproducible; this proves the build still matches
 * what was deployed. They are different guarantees, and the gap between them is exactly where
 * "source matches the verified contract" quietly stops being true after an innocuous edit.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createPublicClient, http, keccak256 } from "viem";

import { parseDeploymentManifest } from "../../packages/config/src/index.js";
import { sepoliaRpc } from "../lib/env.js";
import { readJson, repoPath, run } from "../lib/shell.js";

/** Kyrve-authored contracts in the manifest. Midnight is covered by verify:midnight-bytecode. */
const KYRVE_CONTRACTS: Record<string, string> = {
  KyrveOsakaProbe: "KyrveOsakaProbe",
  KyrveProtocolRegistry: "KyrveProtocolRegistry",
  KyrveDeploymentVerifier: "KyrveDeploymentVerifier",
  TestUSDC: "TestERC20",
  TestWETH: "TestERC20",
  TestWstETH: "TestERC20",
  WethOracle: "FixedPriceOracle",
  WstethOracle: "FixedPriceOracle",
};

/**
 * Zeroes the byte ranges occupied by immutables.
 *
 * Solidity embeds immutable values directly into RUNTIME bytecode, so on-chain code carries the
 * constructor's arguments while a freshly-compiled template carries zeroed placeholders. Comparing
 * them raw reports a mismatch for every contract with an immutable — which is most of them — and
 * is how this check would have become noise that gets switched off.
 *
 * Foundry records the exact offsets in the artifact's `immutableReferences`, so both sides are
 * masked and the comparison becomes one of CODE rather than of code-plus-constructor-arguments.
 */
function maskImmutables(hex: string, contract: string): string {
  const bytes = Buffer.from(hex.replace(/^0x/, ""), "hex");

  const outDir = repoPath("out");
  for (const dir of readdirSync(outDir)) {
    const file = `${outDir}/${dir}/${contract}.json`;
    if (!existsSync(file)) continue;
    const artifact = JSON.parse(readFileSync(file, "utf8")) as {
      deployedBytecode?: {
        immutableReferences?: Record<string, Array<{ start: number; length: number }>>;
      };
    };
    const refs = artifact.deployedBytecode?.immutableReferences ?? {};
    for (const ranges of Object.values(refs)) {
      for (const range of ranges) bytes.fill(0, range.start, range.start + range.length);
    }
    break;
  }

  return `0x${bytes.toString("hex")}`;
}

async function main(): Promise<void> {
  const environment = process.argv[2] ?? "sepolia";
  const manifestPath = repoPath(`deployments/${environment}/manifest.json`);
  if (!existsSync(manifestPath)) {
    console.log(`no ${environment} manifest; nothing to compare`);
    return;
  }

  const manifest = parseDeploymentManifest(readJson(manifestPath));
  const rpcUrl = environment === "local" ? "http://127.0.0.1:8545" : sepoliaRpc().url;
  const client = createPublicClient({ transport: http(rpcUrl), cacheTime: 0 });

  run("forge", ["build"]);

  const mismatches: string[] = [];
  let compared = 0;

  for (const [name, contract] of Object.entries(KYRVE_CONTRACTS)) {
    const record = manifest.contracts[name];
    if (record === undefined) continue;

    const built = run("forge", ["inspect", contract, "deployedBytecode"]).stdout.trim();
    const onChain = await client.getCode({ address: record.address });
    if (onChain === undefined || onChain === "0x") {
      mismatches.push(`${name}: no code at ${record.address}`);
      continue;
    }

    compared++;
    const a = keccak256(maskImmutables(onChain, contract) as `0x${string}`);
    const b = keccak256(maskImmutables(built, contract) as `0x${string}`);
    if (a !== b) {
      mismatches.push(
        `${name} at ${record.address}: the current build differs from the deployed and ` +
          "verified bytecode. Either redeploy and re-verify, or revert the source change.",
      );
    }
  }

  console.log(`deployed-bytecode comparison (${environment}): ${compared} Kyrve contracts`);

  if (mismatches.length > 0) {
    console.error(`\nverify:deployed-bytecode FAILED\n`);
    for (const m of mismatches) console.error(`  - ${m}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    "verify:deployed-bytecode PASS — every Kyrve contract on chain matches the current build",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
