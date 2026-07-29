/**
 * Verifies every deployed Sepolia contract through the Etherscan V2 API and records only PUBLIC
 * metadata.
 *
 * What is recorded: address, transaction hash, verified-source URL, compiler settings, constructor
 * arguments, runtime bytecode hash, deployment block. What is never recorded: the API key, the RPC
 * URL, the deployer key. `assertNoSecrets` checks the artifact before it is written.
 *
 * Verification is idempotent and retryable. Etherscan reports "already verified" as an error
 * string, which is treated as success — re-running this must never turn a verified contract into a
 * failure.
 */

import { writeFileSync } from "node:fs";

import {
  type DeploymentManifest,
  parseDeploymentManifest,
} from "../../packages/config/src/index.js";
import { assertNoSecrets, etherscanApiKey, sepoliaRpc } from "../lib/env.js";
import { readJson, repoPath, run, stableStringify } from "../lib/shell.js";

const CHAIN_ID = 11155111;
const EXPLORER = "https://sepolia.etherscan.io";

/** Fully-qualified source identifiers, needed because several contracts share a source file. */
const CONTRACT_PATHS: Record<string, string> = {
  Midnight: "vendor/midnight/src/Midnight.sol:Midnight",
  TestUSDC: "contracts/integration/TestERC20.sol:TestERC20",
  TestWETH: "contracts/integration/TestERC20.sol:TestERC20",
  TestWstETH: "contracts/integration/TestERC20.sol:TestERC20",
  WethOracle: "contracts/integration/FixedPriceOracle.sol:FixedPriceOracle",
  WstethOracle: "contracts/integration/FixedPriceOracle.sol:FixedPriceOracle",
  KyrveOsakaProbe: "contracts/registry/KyrveOsakaProbe.sol:KyrveOsakaProbe",
  KyrveProtocolRegistry: "contracts/registry/KyrveProtocolRegistry.sol:KyrveProtocolRegistry",
  KyrveDeploymentVerifier: "contracts/registry/KyrveDeploymentVerifier.sol:KyrveDeploymentVerifier",
};

/** ABI-encoded constructor arguments, matching what was actually deployed. */
function constructorArgs(name: string, manifest: DeploymentManifest): string {
  const abiEncode = (signature: string, values: string[]): string =>
    run("cast", ["abi-encode", signature, ...values]).stdout.trim();

  switch (name) {
    case "TestUSDC":
      return abiEncode("f(string,string,uint8)", ["Kyrve Test USDC", "tUSDC", "6"]);
    case "TestWETH":
      return abiEncode("f(string,string,uint8)", ["Kyrve Test WETH", "tWETH", "18"]);
    case "TestWstETH":
      return abiEncode("f(string,string,uint8)", ["Kyrve Test wstETH", "twstETH", "18"]);
    case "WethOracle":
    case "WstethOracle":
      // ORACLE_PRICE_SCALE = 1e36
      return abiEncode("f(uint256)", ["1000000000000000000000000000000000000"]);
    case "KyrveProtocolRegistry":
      return abiEncode("f(address)", [manifest.deployer]);
    case "KyrveDeploymentVerifier":
      return abiEncode("f(address)", [manifest.contracts["KyrveProtocolRegistry"]?.address ?? ""]);
    default:
      return "";
  }
}

interface VerificationRecord {
  readonly contract: string;
  readonly address: string;
  readonly deploymentTxHash: string | null;
  readonly sourcePath: string;
  readonly constructorArgs: string;
  readonly runtimeBytecodeHash: string;
  readonly verifiedSourceUrl: string;
  readonly status: "verified" | "already-verified" | "failed";
  readonly detail: string;
}

function verifyOne(name: string, manifest: DeploymentManifest, apiKey: string): VerificationRecord {
  const record = manifest.contracts[name];
  if (record === undefined) throw new Error(`${name} is not in the Sepolia manifest`);

  const path = CONTRACT_PATHS[name];
  if (path === undefined) throw new Error(`no source path mapping for ${name}`);

  const args = constructorArgs(name, manifest);

  const argv = [
    "verify-contract",
    record.address,
    path,
    "--chain-id",
    String(CHAIN_ID),
    "--compiler-version",
    `v${manifest.compiler.solc}`,
    "--num-of-optimizations",
    String(manifest.compiler.optimizerRuns),
    "--watch",
  ];
  if (args.length > 0) argv.push("--constructor-args", args);

  // The API key travels through the environment, never argv.
  const result = run("forge", argv, {
    env: { ETHERSCAN_API_KEY: apiKey },
    allowFailure: true,
  });

  const combined = `${result.stdout}\n${result.stderr}`;
  const alreadyVerified = /already verified/i.test(combined);
  const succeeded = result.code === 0 || /successfully verified|OK/i.test(combined);

  return {
    contract: name,
    address: record.address,
    deploymentTxHash: record.deploymentTxHash,
    sourcePath: record.sourcePath,
    constructorArgs: args,
    runtimeBytecodeHash: record.runtimeBytecodeHash,
    verifiedSourceUrl: `${EXPLORER}/address/${record.address}#code`,
    status: alreadyVerified ? "already-verified" : succeeded ? "verified" : "failed",
    detail: alreadyVerified
      ? "Etherscan already holds verified source for this address"
      : succeeded
        ? "source verified through the Etherscan V2 API"
        : combined
            .split("\n")
            .filter((l) => l.trim().length > 0)
            .slice(-3)
            .join(" | ") || "verification failed",
  };
}

function main(): void {
  const rpc = sepoliaRpc();
  const apiKey = etherscanApiKey();
  const manifestPath = repoPath("deployments/sepolia/manifest.json");
  const manifest = parseDeploymentManifest(readJson(manifestPath));

  console.log("Etherscan V2 verification — Ethereum Sepolia\n");
  console.log(`  RPC              ${rpc.redacted} (from ${rpc.source})`);
  console.log(`  API key          set (value never printed)`);
  console.log(
    `  compiler         v${manifest.compiler.solc}, ${manifest.compiler.optimizerRuns} runs, evm ${manifest.compiler.evmVersion}\n`,
  );

  const records: VerificationRecord[] = [];
  for (const name of Object.keys(CONTRACT_PATHS)) {
    process.stdout.write(`  ${name.padEnd(24)} `);
    const record = verifyOne(name, manifest, apiKey);
    records.push(record);
    console.log(record.status.toUpperCase());
    if (record.status === "failed") console.log(`    ${record.detail}`);
  }

  const verified = records.filter((r) => r.status !== "failed").length;

  const payload = stableStringify({
    $comment:
      "PUBLIC verification metadata only. Contains no API key, no RPC URL and no key material. " +
      "GENERATED by `pnpm verify:etherscan`.",
    chainId: CHAIN_ID,
    explorer: EXPLORER,
    compiler: manifest.compiler,
    verifiedCount: verified,
    totalCount: records.length,
    contracts: records,
  });

  assertNoSecrets(payload, "deployments/sepolia/etherscan-verification.json");
  writeFileSync(repoPath("deployments/sepolia/etherscan-verification.json"), payload);

  // Promote the manifest's verifiedSource field now that Etherscan holds the source.
  if (verified === records.length) {
    const updated = {
      ...(readJson<Record<string, unknown>>(manifestPath) as Record<string, unknown>),
    };
    const contracts = updated["contracts"] as Record<string, Record<string, unknown>>;
    for (const record of records) {
      const entry = contracts[record.contract];
      if (entry !== undefined) entry["verifiedSource"] = "verified";
    }
    const manifestPayload = stableStringify(updated);
    assertNoSecrets(manifestPayload, "deployments/sepolia/manifest.json");
    writeFileSync(manifestPath, manifestPayload);
  }

  console.log(`\n  ${verified}/${records.length} contracts verified`);
  console.log("  metadata written to deployments/sepolia/etherscan-verification.json");

  if (verified !== records.length) {
    console.error("\nverify:etherscan FAILED — not every contract is verified");
    process.exitCode = 1;
  }
}

main();
