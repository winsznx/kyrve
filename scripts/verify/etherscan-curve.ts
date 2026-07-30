/**
 * Etherscan V2 source verification for the Phase 3 curve layer.
 *
 * A near-copy of `etherscan-confidential.ts` in its mechanics — same API, same standard-JSON
 * submission, same GUID polling — because the thing that must not drift is the SOURCE of the
 * source: Hardhat's own build-info input, which is the compilation rather than a reconstruction of
 * it. The differences are the artifact set and the constructor arguments.
 *
 * ONE COMPILER SETTING DIFFERS FROM THE REST OF THE LAYER, and Etherscan has to be told exactly
 * which. `NoxCurveEngine` is compiled at `optimizer.runs: 1` because at 200 it is 25,040 bytes and
 * EIP-170 refuses it (delta R-10). The per-file override lives in `confidential/hardhat.config.ts`,
 * so the engine's build-info carries different settings from its five siblings — and because the
 * standard-JSON input is taken from each artifact's OWN build-info rather than from a constant,
 * that is handled without a special case here.
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

import { CONFIDENTIAL_COMPILER } from "@kyrve/config";

import { assertNoSecrets, etherscanApiKey, safeErrorMessage } from "../lib/env.js";
import { readJson, repoPath, run, stableStringify } from "../lib/shell.js";

const CHAIN_ID = 11155111;
const EXPLORER = "https://sepolia.etherscan.io";
const API = "https://api.etherscan.io/v2/api";

type CurveContract =
  | "CurveUniverseRegistry"
  | "QuoteEpochController"
  | "CurveGraphRegistry"
  | "ReservationLedger"
  | "NoxCurveEngine"
  | "CurveResultVerifier";

const ARTIFACT_PATH: Readonly<Record<CurveContract, string>> = {
  CurveUniverseRegistry: "contracts/CurveUniverseRegistry.sol/CurveUniverseRegistry.json",
  QuoteEpochController: "contracts/QuoteEpochController.sol/QuoteEpochController.json",
  CurveGraphRegistry: "contracts/CurveGraphRegistry.sol/CurveGraphRegistry.json",
  ReservationLedger: "contracts/ReservationLedger.sol/ReservationLedger.json",
  NoxCurveEngine: "contracts/NoxCurveEngine.sol/NoxCurveEngine.json",
  CurveResultVerifier: "contracts/CurveResultVerifier.sol/CurveResultVerifier.json",
};

interface Deployment {
  chainId: number;
  deployer: `0x${string}`;
  phase2: Record<string, `0x${string}`>;
  addresses: Record<CurveContract, `0x${string}`>;
  runtimeHashes: Record<CurveContract, `0x${string}`>;
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
function buildInfoFor(name: CurveContract): {
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
function constructorArgs(name: CurveContract, deployment: Deployment): string {
  const encode = (signature: string, values: string[]): string =>
    run("cast", ["abi-encode", signature, ...values])
      .stdout.trim()
      .replace(/^0x/, "");

  const a = deployment.addresses;
  const p2 = deployment.phase2;

  switch (name) {
    case "CurveUniverseRegistry":
      // The curator, which is the deployer. Immutable: a mutable curator is a mutable universe.
      return encode("f(address)", [deployment.deployer]);
    case "QuoteEpochController":
      return encode("f(address,address,address)", [
        a.CurveUniverseRegistry,
        p2["EncryptedMandateBook"] ?? "",
        p2["ConfidentialRequestBook"] ?? "",
      ]);
    case "CurveGraphRegistry":
      return encode("f(address)", [a.QuoteEpochController]);
    case "ReservationLedger":
      return encode("f(address)", [p2["KyrveEmergencyController"] ?? ""]);
    case "NoxCurveEngine":
      return encode("f(address,address,address,address,address,address,address,address)", [
        a.CurveUniverseRegistry,
        a.QuoteEpochController,
        a.CurveGraphRegistry,
        a.ReservationLedger,
        p2["EncryptedMandateBook"] ?? "",
        p2["ConfidentialRequestBook"] ?? "",
        p2["KyrveConfidentialAssetVault"] ?? "",
        p2["KyrveEmergencyController"] ?? "",
      ]);
    case "CurveResultVerifier":
      return encode("f(address,address,address)", [
        a.CurveGraphRegistry,
        a.NoxCurveEngine,
        a.QuoteEpochController,
      ]);
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
  name: CurveContract,
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
  const recordPath = repoPath("deployments/sepolia/curve.json");
  if (!existsSync(recordPath)) {
    throw new Error("no deployments/sepolia/curve.json — run `pnpm deploy:curve sepolia` first");
  }
  const deployment = readJson<Deployment>(recordPath);
  const apiKey = etherscanApiKey();

  console.log("Etherscan V2 verification — Kyrve curve layer on Ethereum Sepolia\n");
  console.log(
    `  compiler   v${CONFIDENTIAL_COMPILER.solc}, evm ${CONFIDENTIAL_COMPILER.evmVersion}, ` +
      `${CONFIDENTIAL_COMPILER.optimizerRuns} runs except NoxCurveEngine at 1 (EIP-170, delta R-10)`,
  );
  console.log("  source     Hardhat's own standard-JSON input — the compilation, not a rebuild");
  console.log("  API key    set (value never printed)\n");

  const records: Record_[] = [];
  for (const name of Object.keys(ARTIFACT_PATH) as CurveContract[]) {
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
      "`pnpm verify:etherscan:curve`.",
    chainId: CHAIN_ID,
    explorer: EXPLORER,
    compiler: CONFIDENTIAL_COMPILER,
    verified,
    total: records.length,
    contracts: records,
  });
  assertNoSecrets(payload, "deployments/sepolia/curve-etherscan.json");
  writeFileSync(repoPath("deployments/sepolia/curve-etherscan.json"), payload);

  console.log(`\n  ${verified}/${records.length} contracts verified`);
  console.log("  metadata written to deployments/sepolia/curve-etherscan.json");

  if (verified !== records.length) {
    console.error("\nverify:etherscan:curve FAILED — not every contract is verified");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`\nFAILED: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
