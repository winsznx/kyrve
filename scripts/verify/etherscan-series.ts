/**
 * Etherscan V2 source verification for the Phase 5 handle-native set.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * TWO LAYERS, TWO MECHANISMS, AND NEITHER IS A CHOICE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The deployment spans both compiler pins, so it spans both verification routes:
 *
 *   CONFIDENTIAL (solc 0.8.36)   Hardhat's own standard-JSON input, read from its build-info. Foundry
 *                                cannot reproduce these artifacts — `nox-protocol-contracts` requires
 *                                `^0.8.35` and has its own remappings — so asking it to try would
 *                                either fail or, worse, verify a source that is not what was deployed.
 *                                What is submitted is not a reconstruction of the compilation; it IS
 *                                the compilation, byte for byte, including every dependency source and
 *                                every setting.
 *
 *   SETTLEMENT (solc 0.8.34)     `forge verify-contract`, because the settlement layer IS a Foundry
 *                                build at `via_ir`, 466 runs and `evm_version = "osaka"`. Asking
 *                                Foundry to verify Foundry's own output is the shortest path between
 *                                the source and the explorer.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE CONSTRUCTOR ARGUMENTS COME FROM THE DEPLOYMENT RECORD, NOT FROM A SWITCH
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `scripts/deploy/series.ts` records the arguments it actually sent, in order, per contract. This
 * script encodes those, with the signature derived from the artifact's own constructor input types.
 *
 * That is deliberately different from `etherscan-curve.ts`, which writes them out by hand. A
 * hand-written list must be kept in step with the deployer, and eighteen contracts is where that stops
 * being reliable — a wrong value fails at Etherscan with a message that explains nothing. Deriving both
 * halves from the record and the artifact means a drift is impossible rather than merely unlikely.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE RUNTIME HASH IS WHAT MAKES THE REST CHECKABLE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Address, deployment transaction, constructor arguments, compiler settings, runtime bytecode hash,
 * verification status and explorer URL are all recorded. The runtime hash is the field that makes the
 * others mean something: a verified source that compiles to different code than the chain holds would
 * otherwise look identical to a correct record. Each hash is re-read FROM CHAIN here rather than copied
 * from the deployment record, so a record written against a different build fails this script.
 *
 * `KyrveSeriesVault` is included as a DEPLOYED INSTANCE rather than an implementation. There is no
 * proxy: the factory deploys a real vault per series with CREATE2, so it is separately verifiable and
 * its constructor arguments are its own.
 *
 * SECRETS. The API key travels in a POST body over HTTPS or reaches `forge` as an argument, is never
 * printed, and `assertNoSecrets` inspects the artifact before it is written.
 */

import { existsSync, globSync, writeFileSync } from "node:fs";

import { CONFIDENTIAL_COMPILER } from "@kyrve/config";
import { type Address, createPublicClient, type Hex, http, keccak256 } from "viem";
import { sepolia } from "viem/chains";

import { SETTLEMENT_COMPILER } from "../deploy/settlement.js";
import { assertNoSecrets, etherscanApiKey, sepoliaRpc } from "../lib/env.js";
import { readJson, repoPath, run, stableStringify } from "../lib/shell.js";

const CHAIN_ID = 11155111;

/** Replaces every URL in a string with scheme and host, discarding the key-bearing path. */
function redactUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s"')]+/g, (url) => {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}/***`;
    } catch {
      return "<url redacted>";
    }
  });
}
const EXPLORER = "https://sepolia.etherscan.io";
const API = "https://api.etherscan.io/v2/api";

/** The settlement layer, and the source path `forge verify-contract` must be given. */
const FOUNDRY_SOURCE: Readonly<Record<string, string>> = {
  KyrveQuoteRegistry: "contracts/kyrve/KyrveQuoteRegistry.sol",
  KyrveSettlementRatifier: "contracts/kyrve/KyrveSettlementRatifier.sol",
  KyrvePublicResultVerifier: "contracts/kyrve/KyrvePublicResultVerifier.sol",
  QuoteActivator: "contracts/kyrve/QuoteActivator.sol",
  KyrveQuoteExpiryController: "contracts/kyrve/KyrveQuoteExpiryController.sol",
  KyrveSeriesFactory: "contracts/kyrve/KyrveSeriesFactory.sol",
  KyrveSeriesVault: "contracts/kyrve/KyrveSeriesVault.sol",
  // Phase 6. Foundry-built like the rest of the settlement layer: it imports nothing from Nox, so
  // it compiles at the substrate's 0.8.34 alongside the contracts whose roles it declares.
  KyrveRoleRegistry: "contracts/registry/KyrveRoleRegistry.sol",
};

interface DeployedContract {
  readonly address: Address;
  readonly deploymentTx: Hex;
  readonly constructorArgs: readonly string[];
  readonly runtimeHash: Hex;
  readonly layer: "confidential" | "settlement";
}

interface Deployment {
  readonly chainId: number;
  readonly deployer: Address;
  readonly seriesId: Hex;
  readonly seriesVault: Address;
  readonly marketId: Hex;
  readonly loanToken: Address;
  readonly operator: Address;
  readonly contracts: Record<string, DeployedContract>;
}

interface BuildInfo {
  readonly solcLongVersion: string;
  readonly input: {
    readonly language: string;
    readonly settings: unknown;
    readonly sources: Record<string, { content: string }>;
  };
}

interface Outcome {
  readonly contract: string;
  readonly address: Address;
  readonly deploymentTx: Hex;
  readonly layer: "confidential" | "settlement";
  readonly fullyQualifiedName: string;
  readonly constructorArgs: string;
  readonly compiler: typeof CONFIDENTIAL_COMPILER | typeof SETTLEMENT_COMPILER;
  readonly runtimeBytecodeHash: Hex;
  readonly verifiedSourceUrl: string;
  readonly status: "verified" | "already-verified" | "failed";
  readonly detail: string;
}

/**
 * The ABI-encoded constructor arguments, derived rather than written out.
 *
 * The signature comes from the artifact's own constructor input types and the values from the
 * deployment record. `cast abi-encode` does the encoding: hand-rolling the head/tail layout for the
 * dynamic `string` arguments `KyrveSeriesToken` takes is the kind of code that is subtly wrong and
 * produces a verification failure whose message says nothing useful.
 */
function encodeConstructorArgs(abi: readonly unknown[], values: readonly string[]): string {
  const ctor = (abi as { type: string; inputs?: { type: string }[] }[]).find(
    (entry) => entry.type === "constructor",
  );
  const types = (ctor?.inputs ?? []).map((input) => input.type);
  if (types.length !== values.length) {
    throw new Error(
      `the record holds ${values.length} constructor argument(s) and the ABI declares ` +
        `${types.length}. One of the two is from a different build.`,
    );
  }
  if (types.length === 0) return "";
  /**
   * ARRAY ARGUMENTS NEED BRACKETS, and the record cannot carry them.
   *
   * `constructorArgs` is written as `args.map(String)`, so a fixed-size array arrives as a bare
   * comma-joined list — `cast abi-encode` reads that as a malformed value and stops at the first
   * comma with `expected [`. `KyrveRoleRegistry`'s seven role holders are the first array argument
   * any Kyrve constructor has taken, so nothing had needed this before.
   */
  const bracketed = values.map((value, index) => {
    const type = types[index] ?? "";
    if (!type.endsWith("]")) return value;
    return value.startsWith("[") ? value : `[${value}]`;
  });
  return run("cast", ["abi-encode", `f(${types.join(",")})`, ...bracketed])
    .stdout.trim()
    .replace(/^0x/, "");
}

function confidentialArtifact(name: string): {
  abi: readonly unknown[];
  buildInfoId?: string;
  inputSourceName?: string;
  sourceName: string;
  contractName: string;
} {
  return readJson(repoPath(`confidential/artifacts/contracts/${name}.sol/${name}.json`));
}

function foundryArtifact(name: string): { abi: readonly unknown[] } {
  return readJson(repoPath(`out/${name}.sol/${name}.json`));
}

/**
 * The build-info that produced a contract's artifact, and the name solc knows it by.
 *
 * TWO THINGS THAT ARE EASY TO GET WRONG, both producing a failure whose message explains nothing.
 * Hardhat emits one build-info per compilation job and each artifact records which one produced it —
 * submitting the wrong job submits a source set that compiles to different bytecode. And Hardhat 3
 * rewrites source paths for the compiler: `contracts/Foo.sol` becomes `project/contracts/Foo.sol`
 * inside the standard JSON. Etherscan matches `contractname` against the key in that input, so the
 * artifact's own `inputSourceName` is used rather than a constant that could drift from it.
 */
function buildInfoFor(name: string): { info: BuildInfo; fullyQualifiedName: string } {
  const artifact = confidentialArtifact(name);
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
    `no build-info contains ${sourceName}; run \`pnpm --dir confidential exec hardhat compile\``,
  );
}

async function verifyConfidential(
  name: string,
  entry: DeployedContract,
  runtimeHash: Hex,
  apiKey: string,
): Promise<Outcome> {
  const { info, fullyQualifiedName } = buildInfoFor(name);
  const args = encodeConstructorArgs(confidentialArtifact(name).abi, entry.constructorArgs);

  const base: Omit<Outcome, "status" | "detail"> = {
    contract: name,
    address: entry.address,
    deploymentTx: entry.deploymentTx,
    layer: "confidential",
    fullyQualifiedName,
    constructorArgs: args,
    compiler: CONFIDENTIAL_COMPILER,
    runtimeBytecodeHash: runtimeHash,
    verifiedSourceUrl: `${EXPLORER}/address/${entry.address}#code`,
  };

  const body = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    apikey: apiKey,
    codeformat: "solidity-standard-json-input",
    sourceCode: JSON.stringify(info.input),
    contractaddress: entry.address,
    contractname: fullyQualifiedName,
    compilerversion: `v${info.solcLongVersion}`,
    constructorArguements: args,
  });

  // `chainid` must be a QUERY parameter on the V2 API. Sent in the body it is silently ignored and the
  // endpoint answers "Missing or unsupported chainid parameter", which reads like a value problem
  // rather than a placement one.
  const response = await fetch(`${API}?chainid=${CHAIN_ID}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await response.json()) as { status: string; result: string; message?: string };

  // "already verified" arrives as an error string. Treating it as a failure would mean re-running this
  // script could turn a verified contract into a red gate.
  if (/already verified/i.test(json.result)) {
    return { ...base, status: "already-verified", detail: json.result };
  }
  if (json.status !== "1") {
    return { ...base, status: "failed", detail: `${json.message ?? ""} ${json.result}`.trim() };
  }

  const guid = json.result;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    const check = await fetch(
      `${API}?chainid=${CHAIN_ID}&module=contract&action=checkverifystatus&guid=${guid}` +
        `&apikey=${encodeURIComponent(apiKey)}`,
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

function verifySettlement(
  name: string,
  entry: DeployedContract,
  runtimeHash: Hex,
  apiKey: string,
): Outcome {
  const sourcePath = FOUNDRY_SOURCE[name];
  if (sourcePath === undefined) throw new Error(`no Foundry source path is known for ${name}`);
  const args = encodeConstructorArgs(foundryArtifact(name).abi, entry.constructorArgs);

  const base: Omit<Outcome, "status" | "detail"> = {
    contract: name,
    address: entry.address,
    deploymentTx: entry.deploymentTx,
    layer: "settlement",
    // Always fully qualified. Two Solidity files may not share a basename — `verify:basenames` refuses
    // it — but a bare contract name can still be ambiguous to `forge verify-contract`, and the compiler
    // must never be asked to guess which source produced the code on chain.
    fullyQualifiedName: `${sourcePath}:${name}`,
    constructorArgs: args,
    compiler: SETTLEMENT_COMPILER,
    runtimeBytecodeHash: runtimeHash,
    verifiedSourceUrl: `${EXPLORER}/address/${entry.address}#code`,
  };

  const result = run(
    "forge",
    [
      "verify-contract",
      entry.address,
      `${sourcePath}:${name}`,
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
  if (/already verified/i.test(output)) {
    return { ...base, status: "already-verified", detail: "already verified" };
  }
  if (/Contract successfully verified/i.test(output)) {
    return { ...base, status: "verified", detail: "Contract successfully verified" };
  }
  return { ...base, status: "failed", detail: output.split("\n").slice(-3).join(" ").trim() };
}

async function main(): Promise<void> {
  /**
   * WHICH LAYER. `--suffix b` verifies `series-b.json` and writes `series-b-etherscan.json`.
   *
   * A roll needs two complete layers (delta U-1) and both must be Etherscan-verified, so the record
   * this reads cannot be a constant. The suffix is the same one `deploy:series` writes with, so the
   * two cannot drift apart.
   */
  const suffixArg = process.argv.indexOf("--suffix");
  const suffix = suffixArg === -1 ? "" : `-${process.argv[suffixArg + 1]}`;
  /**
   * `--record market` verifies the Phase 6 market layer, whose contracts live in their own record
   * because `KyrveRollBook` cannot exist until a second layer does. Everything there is
   * confidential-layer, so the record carries `layer` and `compiler` and this reads one shape.
   */
  const recordArg = process.argv.indexOf("--record");
  const recordName = recordArg === -1 ? `series${suffix}` : (process.argv[recordArg + 1] as string);
  const recordPath = repoPath(`deployments/sepolia/${recordName}.json`);
  if (!existsSync(recordPath)) {
    throw new Error(`no deployments/sepolia/${recordName}.json — deploy that layer first`);
  }
  const deployment = readJson<Deployment>(recordPath);
  const apiKey = etherscanApiKey();
  const client = createPublicClient({ chain: sepolia, transport: http(sepoliaRpc().url) });

  console.log("Etherscan V2 verification — Kyrve Phase 5 on Ethereum Sepolia\n");
  console.log(
    `  confidential  v${CONFIDENTIAL_COMPILER.solc}, evm ${CONFIDENTIAL_COMPILER.evmVersion}, ` +
      `${CONFIDENTIAL_COMPILER.optimizerRuns} runs except NoxCurveEngine at 1 (EIP-170, delta R-10)`,
  );
  console.log(
    `  settlement    v${SETTLEMENT_COMPILER.solc}, evm ${SETTLEMENT_COMPILER.evmVersion}, ` +
      `${SETTLEMENT_COMPILER.optimizerRuns} runs, matching the pinned Midnight release`,
  );
  console.log("  API key       set (value never printed)\n");

  /**
   * The series vault, added as a deployed instance.
   *
   * Its constructor arguments are not in the deployment record because the FACTORY sent them, not the
   * deployer — so they are reconstructed from the same immutables the factory used, every one of which
   * is in the record.
   */
  const isSeriesRecord = deployment.seriesVault !== undefined;
  const vaultEntry: DeployedContract | null = !isSeriesRecord
    ? null
    : {
        address: deployment.seriesVault,
        deploymentTx: deployment.contracts["KyrveSeriesFactory"]?.deploymentTx ?? "0x",
        constructorArgs: [
          (await client.readContract({
            address: deployment.seriesVault,
            abi: [
              {
                type: "function",
                name: "MIDNIGHT",
                stateMutability: "view",
                inputs: [],
                outputs: [{ type: "address" }],
              },
            ],
            functionName: "MIDNIGHT",
          })) as Address,
          deployment.contracts["KyrveQuoteRegistry"]?.address ?? "",
          deployment.contracts["QuoteActivator"]?.address ?? "",
          deployment.contracts["KyrveQuoteExpiryController"]?.address ?? "",
          deployment.loanToken,
          deployment.operator,
          deployment.seriesId,
        ],
        runtimeHash: "0x",
        layer: "settlement",
      };

  const targets: readonly [string, DeployedContract][] = [
    ...Object.entries(deployment.contracts),
    // The series vault is deployed BY THE FACTORY, so it is not in the record and is appended here.
    // A market record has no vault of its own, and appending a null one would verify nothing while
    // failing on the first read.
    ...(vaultEntry === null
      ? []
      : ([["KyrveSeriesVault", vaultEntry]] as [string, DeployedContract][])),
  ];

  const outcomes: Outcome[] = [];
  for (const [name, entry] of targets) {
    // The runtime hash is re-read FROM CHAIN, never copied from the record. A record written against a
    // different build would otherwise be verified against itself.
    const code = await client.getCode({ address: entry.address });
    if (code === undefined || code === "0x") {
      throw new Error(`${name} at ${entry.address} has no code on Sepolia`);
    }
    const runtimeHash = keccak256(code);
    if (entry.runtimeHash !== "0x" && entry.runtimeHash !== runtimeHash) {
      throw new Error(
        `${name} on chain hashes to ${runtimeHash} but the record says ${entry.runtimeHash}. ` +
          "The record describes a different build than the chain holds.",
      );
    }

    process.stdout.write(`  ${name.padEnd(28)} `);
    const outcome =
      entry.layer === "confidential"
        ? await verifyConfidential(name, entry, runtimeHash, apiKey)
        : verifySettlement(name, entry, runtimeHash, apiKey);
    outcomes.push(outcome);
    console.log(outcome.status.toUpperCase());
    if (outcome.status === "failed") console.log(`    ${outcome.detail}`);
  }

  const verified = outcomes.filter((outcome) => outcome.status !== "failed").length;
  const payload = stableStringify({
    $comment:
      "PUBLIC verification metadata only. No API key, no RPC URL, no key material. GENERATED by " +
      "`pnpm verify:etherscan:series`. Runtime hashes are read from chain, not copied from the " +
      "deployment record.",
    chainId: CHAIN_ID,
    explorer: EXPLORER,
    confidentialCompiler: CONFIDENTIAL_COMPILER,
    settlementCompiler: SETTLEMENT_COMPILER,
    verified,
    total: outcomes.length,
    contracts: outcomes,
  });
  assertNoSecrets(payload, `deployments/sepolia/${recordName}-etherscan.json`);
  writeFileSync(repoPath(`deployments/sepolia/${recordName}-etherscan.json`), payload);

  console.log(`\n  ${verified}/${outcomes.length} contracts verified`);
  console.log(`  metadata written to deployments/sepolia/${recordName}-etherscan.json`);

  if (verified !== outcomes.length) {
    console.error("\nverify:etherscan:series FAILED — not every contract is verified");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  /**
   * REDACT BEFORE PRINTING. viem embeds the transport URL in its error text, and a provider API key
   * lives in the PATH — so a raw `console.error` of a failed read publishes the owner's Alchemy key
   * to the terminal and to any captured log. `assertNoSecrets` guards files; nothing guarded this
   * until a market-record run failed and printed it.
   */
  const raw = error instanceof Error ? error.message : String(error);
  console.error(`\nFAILED: ${redactUrls(raw)}`);
  process.exitCode = 1;
});
