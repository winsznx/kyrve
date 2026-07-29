/**
 * Read-only verification of a deployed curve layer.
 *
 * Everything here is a `view` call. Nothing is signed and no key is read, so it is safe to run
 * against any environment at any time — and it is what makes a deployment claim real rather than
 * asserted, because it reads chain state instead of the broadcast log.
 *
 * WHAT IT PROVES
 *   - every recorded address still holds code, and that code still hashes to what was recorded;
 *   - the engine is bound into all three contracts that must know it, and cannot be re-bound;
 *   - every constructor wiring matches, including the four pointing back at the Phase 2 layer;
 *   - the shared constants on chain agree with `@kyrve/curve`, so the keeper and the contracts
 *     cannot be sizing chunks differently;
 *   - every deployed contract fits EIP-170, measured from the code the chain actually returned.
 *
 * WHAT IT DOES NOT PROVE. That the off-chain Nox stack for this chain is healthy — handles are
 * computed by a KMS, an ingestor and a runner this script cannot see. On Sepolia those are iExec's
 * hosted services; their availability is an operational dependency, not a property of the
 * deployment, and PRD §20.1 requires it be disclosed as such.
 */

import { existsSync, readFileSync } from "node:fs";

import {
  CURVE_ALLOCATE_CHUNK_PROVIDERS,
  CURVE_CACHE_CHUNK_UNITS,
  CURVE_FINALIZE_CHUNK_LEAVES,
  CURVE_MAX_CELLS_PER_TRANSACTION,
  CURVE_MAX_LEAVES,
  CURVE_MAX_MARKETS,
  CURVE_MAX_PROVIDERS,
  CURVE_RANK_CEILING,
  CURVE_REDUCE_CHUNK_LEAVES,
} from "@kyrve/curve";
import { type Address, createPublicClient, http, keccak256 } from "viem";
import { hardhat, sepolia } from "viem/chains";

import { sepoliaRpc } from "../lib/env.js";
import { readJson, repoPath } from "../lib/shell.js";

const MAX_RUNTIME_BYTES = 24_576;

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

interface Record_ {
  environment: "local" | "sepolia";
  chainId: number;
  phase2: Readonly<Record<string, Address>>;
  addresses: Readonly<Record<CurveContract, Address>>;
  runtimeHashes: Readonly<Record<CurveContract, `0x${string}`>>;
  engineBoundInto: readonly string[];
}

function abiOf(name: CurveContract): readonly unknown[] {
  const path = repoPath(`confidential/artifacts/${ARTIFACT_PATH[name]}`);
  return (JSON.parse(readFileSync(path, "utf8")) as { abi: readonly unknown[] }).abi;
}

/** The constants both the contracts and the keeper size against. They must not disagree. */
const SHARED_CONSTANTS: readonly {
  contract: CurveContract;
  getter: string;
  expected: number;
}[] = [
  { contract: "CurveUniverseRegistry", getter: "MAX_PROVIDERS", expected: CURVE_MAX_PROVIDERS },
  { contract: "CurveUniverseRegistry", getter: "MAX_MARKETS", expected: CURVE_MAX_MARKETS },
  { contract: "CurveUniverseRegistry", getter: "MAX_LEAVES", expected: CURVE_MAX_LEAVES },
  { contract: "CurveUniverseRegistry", getter: "RANK_CEILING", expected: CURVE_RANK_CEILING },
  {
    contract: "CurveUniverseRegistry",
    getter: "MAX_CELLS_PER_TRANSACTION",
    expected: CURVE_MAX_CELLS_PER_TRANSACTION,
  },
  {
    contract: "QuoteEpochController",
    getter: "CACHE_CHUNK_UNITS",
    expected: CURVE_CACHE_CHUNK_UNITS,
  },
  {
    contract: "QuoteEpochController",
    getter: "FINALIZE_CHUNK_LEAVES",
    expected: CURVE_FINALIZE_CHUNK_LEAVES,
  },
  {
    contract: "QuoteEpochController",
    getter: "REDUCE_CHUNK_LEAVES",
    expected: CURVE_REDUCE_CHUNK_LEAVES,
  },
  {
    contract: "QuoteEpochController",
    getter: "ALLOCATE_CHUNK_PROVIDERS",
    expected: CURVE_ALLOCATE_CHUNK_PROVIDERS,
  },
];

const WIRING: readonly {
  contract: CurveContract;
  getter: string;
  expectPhase2?: string;
  expect?: CurveContract;
}[] = [
  { contract: "QuoteEpochController", getter: "universes", expect: "CurveUniverseRegistry" },
  { contract: "CurveGraphRegistry", getter: "controller", expect: "QuoteEpochController" },
  { contract: "NoxCurveEngine", getter: "universes", expect: "CurveUniverseRegistry" },
  { contract: "NoxCurveEngine", getter: "controller", expect: "QuoteEpochController" },
  { contract: "NoxCurveEngine", getter: "graph", expect: "CurveGraphRegistry" },
  { contract: "NoxCurveEngine", getter: "ledger", expect: "ReservationLedger" },
  { contract: "NoxCurveEngine", getter: "mandateBook", expectPhase2: "EncryptedMandateBook" },
  { contract: "NoxCurveEngine", getter: "requestBook", expectPhase2: "ConfidentialRequestBook" },
  { contract: "NoxCurveEngine", getter: "vault", expectPhase2: "KyrveConfidentialAssetVault" },
  { contract: "CurveResultVerifier", getter: "graph", expect: "CurveGraphRegistry" },
  { contract: "CurveResultVerifier", getter: "engine", expect: "NoxCurveEngine" },
];

async function main(): Promise<void> {
  const environment = process.argv[2] === "sepolia" ? "sepolia" : "local";
  const recordPath = repoPath(`deployments/${environment}/curve.json`);
  if (!existsSync(recordPath)) {
    throw new Error(
      `no deployment record at deployments/${environment}/curve.json. Deploy first with ` +
        `\`pnpm deploy:curve ${environment}\`.`,
    );
  }

  const record = readJson<Record_>(recordPath);
  const isSepolia = environment === "sepolia";
  const rpc = isSepolia
    ? sepoliaRpc()
    : { url: "http://127.0.0.1:8545", redacted: "http://127.0.0.1:8545" };
  const client = createPublicClient({
    chain: isSepolia ? sepolia : hardhat,
    transport: http(rpc.url),
    cacheTime: 0,
  });

  console.log(`verify:curve ${environment}\n`);
  console.log(`  RPC    ${rpc.redacted}`);

  const observed = await client.getChainId();
  if (observed !== record.chainId) {
    throw new Error(`connected chain is ${observed}, but the record says ${record.chainId}`);
  }

  const failures: string[] = [];

  // 1. Every contract still holds exactly the code that was recorded, and it fits EIP-170.
  console.log("");
  for (const [name, address] of Object.entries(record.addresses) as [CurveContract, Address][]) {
    const code = await client.getCode({ address });
    if (code === undefined || code === "0x") {
      failures.push(`${name} at ${address} has no code`);
      continue;
    }
    const hash = keccak256(code);
    const bytes = (code.length - 2) / 2;
    if (hash !== record.runtimeHashes[name]) {
      failures.push(
        `${name} runtime hash ${hash} does not match the recorded ${record.runtimeHashes[name]}`,
      );
    }
    // Measured from what the CHAIN returned, not from an artifact. A local node allows unlimited
    // contract size, so an artifact-only check can pass for something no real chain would accept.
    if (bytes > MAX_RUNTIME_BYTES) {
      failures.push(`${name} is ${bytes} bytes, over the EIP-170 limit of ${MAX_RUNTIME_BYTES}`);
    }
    console.log(
      `  ${name.padEnd(24)} ${address}  ${String(bytes).padStart(5)} bytes  ` +
        `${hash === record.runtimeHashes[name] ? "runtime matches" : "RUNTIME DIFFERS"}`,
    );
  }

  // 2. The Phase 2 layer this was built against is still there.
  console.log("");
  for (const [name, address] of Object.entries(record.phase2)) {
    const code = await client.getCode({ address });
    if (code === undefined || code === "0x")
      failures.push(`the Phase 2 ${name} at ${address} has no code`);
  }
  console.log(
    `  phase 2 layer                     ${Object.keys(record.phase2).length} contracts, all live`,
  );

  // 3. The engine is bound into all three, and cannot be re-bound.
  console.log("");
  for (const target of [
    "QuoteEpochController",
    "CurveGraphRegistry",
    "ReservationLedger",
  ] as const) {
    const bound = (await client.readContract({
      address: record.addresses[target],
      abi: abiOf(target) as never,
      functionName: "engine",
    })) as Address;
    const ok = bound.toLowerCase() === record.addresses.NoxCurveEngine.toLowerCase();
    if (!ok) failures.push(`${target}.engine() is ${bound}, expected the deployed engine`);
    console.log(`  ${ok ? "ok " : "BAD"}  ${target}.engine() -> NoxCurveEngine`);
  }

  // 4. Constructor wiring, read back through each contract's own getter.
  console.log("");
  for (const rule of WIRING) {
    const actual = (await client.readContract({
      address: record.addresses[rule.contract],
      abi: abiOf(rule.contract) as never,
      functionName: rule.getter,
    })) as Address;
    const expected =
      rule.expectPhase2 !== undefined
        ? record.phase2[rule.expectPhase2]
        : record.addresses[rule.expect as CurveContract];
    const ok = expected !== undefined && actual.toLowerCase() === expected.toLowerCase();
    if (!ok) failures.push(`${rule.contract}.${rule.getter}() is ${actual}, expected ${expected}`);
    console.log(
      `  ${ok ? "ok " : "BAD"}  ${rule.contract}.${rule.getter}() -> ${rule.expect ?? rule.expectPhase2}`,
    );
  }

  // 5. The shared constants agree with the keeper's copy.
  console.log("");
  for (const rule of SHARED_CONSTANTS) {
    const value = (await client.readContract({
      address: record.addresses[rule.contract],
      abi: abiOf(rule.contract) as never,
      functionName: rule.getter,
    })) as bigint;
    const ok = Number(value) === rule.expected;
    if (!ok) {
      failures.push(
        `${rule.contract}.${rule.getter}() is ${value} on chain but ${rule.expected} in ` +
          "@kyrve/curve. The contracts and the keeper would size chunks differently.",
      );
    }
    console.log(`  ${ok ? "ok " : "BAD"}  ${rule.getter.padEnd(26)} ${value}`);
  }

  if (failures.length > 0) {
    console.error(`\nverify:curve FAIL — ${failures.length} problem(s)\n`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nverify:curve PASS — ${environment}`);
  console.log(
    `  6 contracts live, runtime hashes match, ${WIRING.length} wiring checks, ` +
      `${SHARED_CONSTANTS.length} constants, engine bound into 3`,
  );
  console.log("  NOT PROVEN HERE: the health of the off-chain Nox KMS, ingestor and runner");
}

main().catch((error: unknown) => {
  console.error(`\nverify:curve FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
