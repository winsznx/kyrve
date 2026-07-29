/**
 * Etherscan V2 source verification for the confidential layer.
 *
 * WHY THIS IS NOT `pnpm verify:etherscan`. That script drives `forge verify-contract`, which asks
 * Foundry to recompile the source and submit it. Foundry cannot reproduce these artifacts: the
 * confidential layer is compiled by Hardhat at solc 0.8.36 with its own remappings, because
 * `nox-protocol-contracts` requires `^0.8.35` while the Midnight substrate is pinned at 0.8.34 for
 * bytecode comparability. Asking Foundry to try would either fail or, worse, verify a source that
 * is not what was deployed.
 *
 * WHAT IS SUBMITTED INSTEAD. The exact standard-JSON input solc was given, read from Hardhat's own
 * build-info. That is not a reconstruction of the compilation — it IS the compilation, byte for
 * byte, including every dependency source and every setting. If Etherscan accepts it, the source it
 * shows is provably what produced the runtime code on chain.
 *
 * SECRETS. The API key travels in a POST body over HTTPS, is never printed, and `assertNoSecrets`
 * inspects the artifact before it is written. Only public metadata is recorded.
 */

import { existsSync, globSync, writeFileSync } from "node:fs";

import { CONFIDENTIAL_COMPILER, type ConfidentialContract } from "@kyrve/config";

import { assertNoSecrets, etherscanApiKey } from "../lib/env.js";
import { readJson, repoPath, run, stableStringify } from "../lib/shell.js";

const CHAIN_ID = 11155111;
const EXPLORER = "https://sepolia.etherscan.io";
const API = "https://api.etherscan.io/v2/api";

const ARTIFACT_PATH: Readonly<Record<ConfidentialContract, string>> = {
  KyrveEmergencyController: "contracts/KyrveEmergencyController.sol/KyrveEmergencyController.json",
  TestUnderlyingERC20: "contracts/test/TestUnderlyingERC20.sol/TestUnderlyingERC20.json",
  KyrveWrappedAsset: "contracts/KyrveWrappedAsset.sol/KyrveWrappedAsset.json",
  KyrveConfidentialAssetVault:
    "contracts/KyrveConfidentialAssetVault.sol/KyrveConfidentialAssetVault.json",
  EncryptedMandateBook: "contracts/EncryptedMandateBook.sol/EncryptedMandateBook.json",
  ConfidentialRequestBook: "contracts/ConfidentialRequestBook.sol/ConfidentialRequestBook.json",
};

interface Deployment {
  chainId: number;
  deployer: `0x${string}`;
  addresses: Record<ConfidentialContract, `0x${string}`>;
  runtimeHashes: Record<ConfidentialContract, `0x${string}`>;
}

interface BuildInfo {
  solcLongVersion: string;
  input: { language: string; settings: unknown; sources: Record<string, { content: string }> };
}

/**
 * The build-info that produced a contract's artifact, and the name solc knows it by.
 *
 * TWO THINGS THAT ARE EASY TO GET WRONG HERE, and both produce a verification failure whose message
 * explains nothing.
 *
 * Hardhat emits one build-info per compilation job — three, for this project — and each artifact
 * records which one produced it. Submitting the wrong job means submitting a source set that
 * compiles to different bytecode.
 *
 * And Hardhat 3 rewrites source paths for the compiler: what the repository calls
 * `contracts/Foo.sol` is `project/contracts/Foo.sol` inside the standard JSON, and npm dependencies
 * become `npm/pkg@version/…`. Etherscan matches `contractname` against the key in that input, not
 * against the repository path, so the artifact's own `inputSourceName` is used rather than a
 * constant that could drift from it.
 */
function buildInfoFor(name: ConfidentialContract): {
  info: BuildInfo;
  fullyQualifiedName: string;
} {
  const artifact = readJson<{
    buildInfoId?: string;
    inputSourceName?: string;
    sourceName: string;
    contractName: string;
  }>(repoPath(`confidential/artifacts/${ARTIFACT_PATH[name]}`));

  const sourceName = artifact.inputSourceName ?? artifact.sourceName;
  const fullyQualifiedName = `${sourceName}:${artifact.contractName}`;

  const candidates = globSync(repoPath("confidential/artifacts/build-info/*.json")).filter(
    (path) => !path.endsWith(".output.json"),
  );

  for (const path of candidates) {
    const info = readJson<BuildInfo & { id?: string }>(path);
    if (artifact.buildInfoId !== undefined && info.id !== artifact.buildInfoId) continue;
    if (info.input.sources[sourceName] !== undefined) return { info, fullyQualifiedName };
  }
  throw new Error(
    `no build-info contains ${sourceName}; run \`pnpm --filter @kyrve/confidential build\``,
  );
}

/**
 * ABI-encoded constructor arguments, hex without the `0x` prefix, exactly as deployed.
 *
 * Encoded with `cast abi-encode` rather than by hand. Hand-rolling the head/tail layout for the
 * dynamic `string` arguments is the kind of code that is subtly wrong and produces a verification
 * failure whose message says nothing useful; `cast` is already a required tool and gets it right.
 *
 * These MUST match `scripts/deploy/confidential.ts` exactly. They are written out rather than
 * derived because a wrong value here fails loudly at Etherscan, whereas a clever derivation that
 * drifts from the deployer would fail silently on the next contract added.
 */
function constructorArgs(name: ConfidentialContract, deployment: Deployment): string {
  const encode = (signature: string, values: string[]): string =>
    run("cast", ["abi-encode", signature, ...values])
      .stdout.trim()
      .replace(/^0x/, "");

  const controller = deployment.addresses.KyrveEmergencyController;

  switch (name) {
    case "KyrveEmergencyController":
      return encode("f(address)", [deployment.deployer]);
    case "TestUnderlyingERC20":
      return encode("f(string,string,uint8)", ["Kyrve Test USDC", "tUSDC", "6"]);
    case "KyrveWrappedAsset":
      return encode("f(string,string,string,address,address)", [
        "Kyrve Confidential USDC",
        "cUSDC",
        "",
        deployment.addresses.TestUnderlyingERC20,
        controller,
      ]);
    case "KyrveConfidentialAssetVault":
      return encode("f(address,address,address)", [
        deployment.addresses.KyrveWrappedAsset,
        // The reserver, deliberately unset: the curve engine that will hold it is Phase 3.
        "0x0000000000000000000000000000000000000000",
        controller,
      ]);
    case "EncryptedMandateBook":
    case "ConfidentialRequestBook":
      return encode("f(address)", [controller]);
  }
}

interface Record_ {
  readonly contract: string;
  readonly address: string;
  readonly fullyQualifiedName: string;
  readonly runtimeBytecodeHash: string;
  readonly verifiedSourceUrl: string;
  readonly status: "verified" | "already-verified" | "failed";
  readonly detail: string;
}

async function submit(
  name: ConfidentialContract,
  deployment: Deployment,
  apiKey: string,
): Promise<Record_> {
  const { info, fullyQualifiedName } = buildInfoFor(name);
  const address = deployment.addresses[name];

  const body = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    apikey: apiKey,
    codeformat: "solidity-standard-json-input",
    sourceCode: JSON.stringify(info.input),
    contractaddress: address,
    contractname: fullyQualifiedName,
    compilerversion: `v${info.solcLongVersion}`,
    constructorArguements: constructorArgs(name, deployment),
  });

  // `chainid` must be a QUERY parameter on the V2 API. Sent in the body it is silently ignored and
  // the endpoint answers "Missing or unsupported chainid parameter", which reads like a value
  // problem rather than a placement one.
  const response = await fetch(`${API}?chainid=${CHAIN_ID}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await response.json()) as { status: string; result: string; message?: string };

  const base: Omit<Record_, "status" | "detail"> = {
    contract: name,
    address,
    fullyQualifiedName,
    runtimeBytecodeHash: deployment.runtimeHashes[name],
    verifiedSourceUrl: `${EXPLORER}/address/${address}#code`,
  };

  // "already verified" arrives as an error string. Treating it as a failure would mean re-running
  // this script could turn a verified contract into a red gate.
  if (/already verified/i.test(json.result)) {
    return { ...base, status: "already-verified", detail: json.result };
  }
  if (json.status !== "1") {
    return { ...base, status: "failed", detail: `${json.message ?? ""} ${json.result}`.trim() };
  }

  const guid = json.result;
  // Etherscan compiles asynchronously; the submission GUID is polled until it settles.
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    const check = await fetch(
      `${API}?chainid=${CHAIN_ID}&module=contract&action=checkverifystatus&guid=${guid}&apikey=${encodeURIComponent(apiKey)}`,
    );
    const status = (await check.json()) as { status: string; result: string };
    if (/pending/i.test(status.result)) continue;
    if (/already verified/i.test(status.result)) {
      return { ...base, status: "already-verified", detail: status.result };
    }
    if (status.status === "1") return { ...base, status: "verified", detail: status.result };
    return { ...base, status: "failed", detail: status.result };
  }
  return {
    ...base,
    status: "failed",
    detail: "Etherscan did not settle the submission in 2 minutes",
  };
}

async function main(): Promise<void> {
  const recordPath = repoPath("deployments/sepolia/confidential.json");
  if (!existsSync(recordPath)) {
    throw new Error("no deployments/sepolia/confidential.json — deploy the layer first");
  }
  const deployment = readJson<Deployment>(recordPath);
  const apiKey = etherscanApiKey();

  console.log("Etherscan V2 verification — Kyrve confidential layer on Ethereum Sepolia\n");
  console.log(
    `  compiler   v${CONFIDENTIAL_COMPILER.solc}, ${CONFIDENTIAL_COMPILER.optimizerRuns} runs, evm ${CONFIDENTIAL_COMPILER.evmVersion}`,
  );
  console.log("  source     Hardhat's own standard-JSON input — the compilation, not a rebuild");
  console.log("  API key    set (value never printed)\n");

  const records: Record_[] = [];
  for (const name of Object.keys(ARTIFACT_PATH) as ConfidentialContract[]) {
    process.stdout.write(`  ${name.padEnd(28)} `);
    const record = await submit(name, deployment, apiKey);
    records.push(record);
    console.log(record.status.toUpperCase());
    if (record.status === "failed") console.log(`    ${record.detail}`);
  }

  const verified = records.filter((record) => record.status !== "failed").length;
  const payload = stableStringify({
    $comment:
      "PUBLIC verification metadata only. No API key, no RPC URL, no key material. GENERATED by " +
      "`pnpm verify:etherscan:confidential`.",
    chainId: CHAIN_ID,
    explorer: EXPLORER,
    compiler: CONFIDENTIAL_COMPILER,
    verified,
    total: records.length,
    contracts: records,
  });
  assertNoSecrets(payload, "deployments/sepolia/confidential-etherscan.json");
  writeFileSync(repoPath("deployments/sepolia/confidential-etherscan.json"), payload);

  console.log(`\n  ${verified}/${records.length} contracts verified`);
  console.log("  metadata written to deployments/sepolia/confidential-etherscan.json");

  if (verified !== records.length) {
    console.error("\nverify:etherscan:confidential FAILED — not every contract is verified");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
