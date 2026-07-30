/**
 * Read-only verification of a deployed confidential layer.
 *
 * Everything here is a `view` call. Nothing is signed and no key is read, so this is safe to run
 * against any environment at any time — and it is the check that makes a deployment claim real
 * rather than asserted, because it reads the chain rather than the broadcast log.
 *
 * WHAT IT PROVES
 *   - every recorded address still holds code, and that code still hashes to what was recorded;
 *   - every constructor wiring matches (a vault pointing at the wrong controller would otherwise
 *     look perfectly healthy);
 *   - NoxCompute is live at the address `Nox.noxComputeContract()` hardcodes for this chain,
 *     because a confidential layer on a chain without it compiles, deploys and then reverts on the
 *     first encrypted input;
 *   - the reservation capability is UNSET, which is the correct Phase 2 state;
 *   - the emergency controller's pausable set contains no recovery path.
 *
 * WHAT IT DOES NOT PROVE. That the off-chain Nox stack for this chain is healthy. Handles are
 * computed by a KMS, an ingestor and a runner this script cannot see. On Sepolia those are iExec's
 * hosted services; their availability is an operational dependency, not a property of the
 * deployment, and PRD §20.1 requires it be disclosed as such.
 */

import { existsSync, readFileSync } from "node:fs";
import {
  CONFIDENTIAL_WIRING,
  type ConfidentialContract,
  NOX_COMPUTE_BY_CHAIN,
} from "@kyrve/config";
import { type Address, createPublicClient, http, keccak256 } from "viem";
import { hardhat, sepolia } from "viem/chains";

import { safeErrorMessage, sepoliaRpc } from "../lib/env.js";
import { readJson, repoPath } from "../lib/shell.js";

const ARTIFACT_PATH: Readonly<Record<ConfidentialContract, string>> = {
  KyrveEmergencyController: "contracts/KyrveEmergencyController.sol/KyrveEmergencyController.json",
  TestUnderlyingERC20: "contracts/test/TestUnderlyingERC20.sol/TestUnderlyingERC20.json",
  KyrveWrappedAsset: "contracts/KyrveWrappedAsset.sol/KyrveWrappedAsset.json",
  KyrveConfidentialAssetVault:
    "contracts/KyrveConfidentialAssetVault.sol/KyrveConfidentialAssetVault.json",
  EncryptedMandateBook: "contracts/EncryptedMandateBook.sol/EncryptedMandateBook.json",
  ConfidentialRequestBook: "contracts/ConfidentialRequestBook.sol/ConfidentialRequestBook.json",
};

interface Record_ {
  environment: "local" | "sepolia";
  chainId: number;
  deployer: Address;
  deploymentBlock: string;
  noxCompute: Address;
  addresses: Record<ConfidentialContract, Address>;
  runtimeHashes: Record<ConfidentialContract, `0x${string}`>;
}

function abiOf(name: ConfidentialContract): readonly unknown[] {
  const path = repoPath(`confidential/artifacts/${ARTIFACT_PATH[name]}`);
  return (JSON.parse(readFileSync(path, "utf8")) as { abi: readonly unknown[] }).abi;
}

async function main(): Promise<void> {
  const environment = process.argv[2] === "sepolia" ? "sepolia" : "local";
  const recordPath = repoPath(`deployments/${environment}/confidential.json`);
  if (!existsSync(recordPath)) {
    throw new Error(
      `no deployment record at deployments/${environment}/confidential.json. Deploy first with ` +
        `\`pnpm deploy:confidential ${environment}\`.`,
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

  console.log(`verify:confidential ${environment}\n`);
  console.log(`  RPC    ${rpc.redacted}`);

  const observed = await client.getChainId();
  if (observed !== record.chainId) {
    throw new Error(`connected chain is ${observed}, but the record says ${record.chainId}`);
  }

  const failures: string[] = [];

  // 1. NoxCompute must be live at the address the SDK hardcodes for this chain.
  const expectedNox = NOX_COMPUTE_BY_CHAIN[record.chainId];
  if (expectedNox === undefined) {
    failures.push(`no NoxCompute address is known for chain ${record.chainId}`);
  } else {
    if (record.noxCompute.toLowerCase() !== expectedNox.toLowerCase()) {
      failures.push(`the record's NoxCompute ${record.noxCompute} is not the SDK's ${expectedNox}`);
    }
    const noxCode = await client.getCode({ address: expectedNox });
    if (noxCode === undefined || noxCode === "0x") {
      failures.push(
        `NoxCompute has no code at ${expectedNox} — no encrypted input can be accepted`,
      );
    } else {
      console.log(`  Nox    ${expectedNox} live, ${(noxCode.length - 2) / 2} bytes\n`);
    }
  }

  // 2. Every contract still holds exactly the code that was recorded.
  for (const [name, address] of Object.entries(record.addresses) as [
    ConfidentialContract,
    Address,
  ][]) {
    const code = await client.getCode({ address });
    if (code === undefined || code === "0x") {
      failures.push(`${name} at ${address} has no code`);
      continue;
    }
    const hash = keccak256(code);
    const status = hash === record.runtimeHashes[name] ? "matches" : "DIFFERS FROM RECORD";
    if (hash !== record.runtimeHashes[name]) {
      failures.push(
        `${name} runtime hash ${hash} does not match the recorded ${record.runtimeHashes[name]}`,
      );
    }
    console.log(`  ${name.padEnd(28)} ${address}  runtime ${status}`);
  }

  // 3. Constructor wiring, read back through each contract's own getter.
  console.log("");
  for (const rule of CONFIDENTIAL_WIRING) {
    const actual = (await client.readContract({
      address: record.addresses[rule.contract],
      abi: abiOf(rule.contract) as never,
      functionName: rule.getter,
    })) as Address;
    const expected = record.addresses[rule.expected];
    const ok = actual.toLowerCase() === expected.toLowerCase();
    if (!ok) failures.push(`${rule.contract}.${rule.getter}() is ${actual}, expected ${expected}`);
    console.log(`  ${ok ? "ok " : "BAD"}  ${rule.contract}.${rule.getter}() -> ${rule.expected}`);
  }

  // 4. The reservation capability must be unset in Phase 2.
  const reserver = (await client.readContract({
    address: record.addresses.KyrveConfidentialAssetVault,
    abi: abiOf("KyrveConfidentialAssetVault") as never,
    functionName: "reserver",
  })) as Address;
  const unset = /^0x0+$/.test(reserver);
  if (!unset) {
    failures.push(
      `the vault's reserver is ${reserver}, but the curve engine and quote activator that should ` +
        "hold it are Phase 3. An address here can open reservations that nothing yet authorises.",
    );
  }
  console.log(`\n  reserver unset (Phase 2 expected state) : ${unset}`);

  // 5. Nothing is paused, and the pausable set contains no recovery path.
  const controllerAbi = abiOf("KyrveEmergencyController");
  const paused: number[] = [];
  for (let activity = 0; activity < 5; activity++) {
    const isPaused = (await client.readContract({
      address: record.addresses.KyrveEmergencyController,
      abi: controllerAbi as never,
      functionName: "isPaused",
      args: [activity],
    })) as boolean;
    if (isPaused) paused.push(activity);
  }
  console.log(
    `  activities paused                       : ${paused.length === 0 ? "none" : paused.join(", ")}`,
  );

  // The enum has exactly five members; a sixth would mean a recovery path became pausable.
  let sixthExists = true;
  try {
    await client.readContract({
      address: record.addresses.KyrveEmergencyController,
      abi: controllerAbi as never,
      functionName: "isPaused",
      args: [5],
    });
  } catch {
    sixthExists = false;
  }
  if (sixthExists) {
    failures.push("the emergency controller accepts a sixth activity — check what became pausable");
  }
  console.log(`  pausable activities                     : 5, all entries (invariant 20)`);

  if (failures.length > 0) {
    console.error(`\nverify:confidential FAIL — ${failures.length} problem(s)\n`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nverify:confidential PASS — ${environment}`);
  console.log(
    `  6 contracts live, runtime hashes match, ${CONFIDENTIAL_WIRING.length} wiring checks ok`,
  );
  console.log("  NOT PROVEN HERE: the health of the off-chain Nox KMS, ingestor and runner");
}

main().catch((error: unknown) => {
  console.error(`\nverify:confidential FAILED: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
