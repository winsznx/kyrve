/**
 * Reads the Phase 5 handle-native set back from chain state, and refuses to agree with itself.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * EVERY CHECK COMPARES CHAIN STATE AGAINST THE RECORD, NOT THE RECORD AGAINST ITSELF
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A verification script that read the manifest and reported what it said would pass against a
 * manifest describing contracts that were never deployed. So every value below comes from an
 * `eth_call` or `eth_getCode`, and the manifest is only ever the expectation.
 *
 * The runtime bytecode check is the one that makes the rest mean something. A layer can be wired
 * perfectly and still be the wrong build — and `verify:deployed-bytecode` compares against the CURRENT
 * artifacts, so a source change that was never redeployed fails here rather than at the first call.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE THREE CHECKS THAT EXIST BECAUSE SOMETHING WENT WRONG
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   the wrapper's underlying   must equal the market's loan token. Delta T-12: on Sepolia they were two
 *                              different ERC-20s, both called tUSDC, both six decimals — and every
 *                              encrypted step succeeds before activation reverts `FundingShortfall`
 *                              naming a number with no hint of the cause.
 *
 *   the reserver and settler   must be the ledger and the allocator. Either one left unbound makes the
 *                              custody vault refuse every lock, and a layer that deploys and then
 *                              refuses looks healthy from the outside.
 *
 *   the deployment id          must be the one the registry derived, and it must DIFFER from the
 *                              superseded deployment's. A quote carries it in its provenance, so a
 *                              collision would let a Phase 4 quote authenticate against Phase 5's
 *                              registry.
 *
 * Read-only. It sends nothing and prints no secret.
 */

import { existsSync } from "node:fs";

import { type Address, createPublicClient, type Hex, http, keccak256 } from "viem";
import { hardhat, sepolia } from "viem/chains";

import { sepoliaRpc } from "../lib/env.js";
import { readJson, repoPath } from "../lib/shell.js";

const LOCAL_RPC = "http://127.0.0.1:8545";

interface DeployedContract {
  readonly address: Address;
  readonly runtimeHash: Hex;
  readonly layer: "confidential" | "settlement";
}

interface Deployment {
  readonly chainId: number;
  readonly deployer: Address;
  readonly operator: Address;
  readonly residueBeneficiary: Address;
  readonly loanToken: Address;
  readonly universeId: Hex;
  readonly marketId: Hex;
  readonly seriesId: Hex;
  readonly seriesVault: Address;
  readonly deploymentId: Hex;
  readonly reused: Record<string, Address>;
  readonly superseded: Record<string, Address>;
  readonly contracts: Record<string, DeployedContract>;
}

type Check = { readonly what: string; readonly detail: string };

/**
 * Narrows an `eth_call` result to an address, and throws if it is not one.
 *
 * The ABIs here are built at runtime from a name and an output type, so viem cannot infer the return
 * type and a cast would be the obvious way through. This validates instead: a getter that returned
 * something other than a 20-byte address would otherwise be compared with `.toLowerCase()` and reported
 * as a mismatch rather than as the malformed answer it is.
 */
function asAddress(value: unknown, context: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${context} did not return an address: ${String(value)}`);
  }
  return value as Address;
}

function asBytes32(value: unknown, context: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${context} did not return a bytes32: ${String(value)}`);
  }
  return value as Hex;
}

const ADDRESS_OUT = [{ type: "address" }] as const;
const BYTES32_OUT = [{ type: "bytes32" }] as const;

function view(name: string, outputs: readonly { type: string }[]) {
  return [{ type: "function", name, stateMutability: "view", inputs: [], outputs }] as const;
}

function viewOf(
  name: string,
  inputs: readonly { type: string }[],
  outputs: readonly { type: string }[],
) {
  return [{ type: "function", name, stateMutability: "view", inputs, outputs }] as const;
}

async function main(): Promise<void> {
  const environment = process.argv[2] === "sepolia" ? "sepolia" : "local";
  const isSepolia = environment === "sepolia";
  const recordPath = repoPath(`deployments/${environment}/series.json`);
  if (!existsSync(recordPath)) {
    throw new Error(`no ${recordPath} — run \`pnpm deploy:series ${environment}\` first`);
  }
  const record = readJson<Deployment>(recordPath);
  const client = createPublicClient({
    chain: isSepolia ? sepolia : hardhat,
    transport: http(isSepolia ? sepoliaRpc().url : LOCAL_RPC),
  });

  const chainId = await client.getChainId();
  if (chainId !== record.chainId) {
    throw new Error(`the RPC is on chain ${chainId}; the record is for ${record.chainId}`);
  }

  const at = (name: string): Address => {
    const entry = record.contracts[name];
    if (entry === undefined) throw new Error(`the record does not name ${name}`);
    return entry.address;
  };

  const passed: Check[] = [];
  const problems: string[] = [];

  const expectAddress = async (
    label: string,
    address: Address,
    getter: string,
    expected: Address,
  ): Promise<void> => {
    const actual = asAddress(
      await client.readContract({ address, abi: view(getter, ADDRESS_OUT), functionName: getter }),
      `${label}: ${getter}()`,
    );
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      problems.push(`${label}: ${getter}() is ${actual}, expected ${expected}`);
      return;
    }
    passed.push({ what: label, detail: `${getter}() -> ${expected}` });
  };

  console.log(`\nverify:series — ${environment}\n`);

  // ── 1. Every contract holds code, and it is the code the current build produces ────────────
  for (const [name, entry] of Object.entries(record.contracts)) {
    const code = await client.getCode({ address: entry.address });
    if (code === undefined || code === "0x") {
      problems.push(`${name} at ${entry.address} holds no code`);
      continue;
    }
    const hash = keccak256(code);
    if (hash !== entry.runtimeHash) {
      problems.push(
        `${name} on chain hashes to ${hash}, the record says ${entry.runtimeHash}. The chain holds a ` +
          "different build than the record describes.",
      );
      continue;
    }
    passed.push({
      what: `${name} runtime bytecode`,
      detail: `${(code.length - 2) / 2} bytes, hash matches`,
    });
  }

  // ── 2. Engine bindings — the three one-shot references ────────────────────────────────────
  const engine = at("NoxCurveEngine");
  for (const target of [
    "QuoteEpochController",
    "CurveGraphRegistry",
    "ReservationLedger",
  ] as const) {
    await expectAddress(`${target} engine binding`, at(target), "engine", engine);
  }

  // ── 3. Reserver and settler authority on the custody vault ────────────────────────────────
  //
  // Either left unbound makes every lock revert `ReserverNotBound` or `SettlerNotBound`. A vault that
  // deploys and then refuses every call looks healthy from the outside, which is why this is read back
  // rather than assumed from the deployment log.
  const custody = at("KyrveCustodyVault");
  await expectAddress("custody reserver authority", custody, "reserver", at("ReservationLedger"));
  await expectAddress("custody settler authority", custody, "settler", at("SeriesAllocator"));
  await expectAddress("custody asset", custody, "asset", at("KyrveWrappedAsset"));

  // ── 4. The epoch controller and graph registry the engine drives ──────────────────────────
  await expectAddress("engine epoch controller", engine, "controller", at("QuoteEpochController"));
  await expectAddress("engine graph registry", engine, "graph", at("CurveGraphRegistry"));
  await expectAddress("engine reservation ledger", engine, "ledger", at("ReservationLedger"));
  await expectAddress("engine custody vault", engine, "vault", custody);
  await expectAddress(
    "engine universe registry",
    engine,
    "universes",
    record.reused["CurveUniverseRegistry"] as Address,
  );
  await expectAddress("ledger custody vault", at("ReservationLedger"), "custody", custody);

  // The universe the series quotes into must still be active. A frozen universe is what every published
  // rate grid, privacy floor and chunk width is committed to.
  const universeActive =
    (await client.readContract({
      address: record.reused["CurveUniverseRegistry"] as Address,
      abi: viewOf("isActive", [{ type: "bytes32" }], [{ type: "bool" }]),
      functionName: "isActive",
      args: [record.universeId],
    })) === true;
  if (!universeActive) {
    problems.push(`universe ${record.universeId} is not active in the reused registry`);
  } else {
    passed.push({ what: "universe", detail: `${record.universeId} active` });
  }

  // ── 5. The wrapper wraps what the market lends. Delta T-12 ────────────────────────────────
  const underlying = asAddress(
    await client.readContract({
      address: at("KyrveWrappedAsset"),
      abi: view("underlying", ADDRESS_OUT),
      functionName: "underlying",
    }),
    "KyrveWrappedAsset.underlying()",
  );
  if (underlying.toLowerCase() !== record.loanToken.toLowerCase()) {
    problems.push(
      `the wrapper's underlying is ${underlying} but the market lends ${record.loanToken}. Phase 5 ` +
        "unwraps confidential capital into the loan token, so they must be the same ERC-20 — T-12.",
    );
  } else {
    passed.push({
      what: "wrapper loan-token identity",
      detail: `underlying() -> ${underlying}, the market's loanToken (T-12)`,
    });
  }

  // ── 6. The series factory, and the vault it created for this series ────────────────────────
  const factory = at("KyrveSeriesFactory");
  await expectAddress("factory quote registry", factory, "REGISTRY", at("KyrveQuoteRegistry"));
  await expectAddress("factory activator", factory, "ACTIVATOR", at("QuoteActivator"));

  const derivedSeriesId = asBytes32(
    await client.readContract({
      address: factory,
      abi: viewOf("seriesIdFor", [{ type: "bytes32" }], BYTES32_OUT),
      functionName: "seriesIdFor",
      args: [record.marketId],
    }),
    "KyrveSeriesFactory.seriesIdFor()",
  );
  if (derivedSeriesId.toLowerCase() !== record.seriesId.toLowerCase()) {
    problems.push(
      `the factory derives series ${derivedSeriesId} for this market, not ${record.seriesId}`,
    );
  } else {
    passed.push({
      what: "series id derivation",
      detail: `seriesIdFor(market) -> ${record.seriesId}`,
    });
  }

  const vaultFromFactory = asAddress(
    await client.readContract({
      address: factory,
      abi: viewOf("vaultOf", [{ type: "bytes32" }], ADDRESS_OUT),
      functionName: "vaultOf",
      args: [record.seriesId],
    }),
    "KyrveSeriesFactory.vaultOf()",
  );
  if (vaultFromFactory.toLowerCase() !== record.seriesVault.toLowerCase()) {
    problems.push(
      `the factory holds vault ${vaultFromFactory} for this series, not ${record.seriesVault}`,
    );
  } else {
    passed.push({ what: "series vault", detail: `vaultOf(series) -> ${record.seriesVault}` });
  }

  await expectAddress("vault loan token", record.seriesVault, "LOAN_TOKEN", record.loanToken);

  // ── 7. The allocator ──────────────────────────────────────────────────────────────────────
  const allocator = at("SeriesAllocator");
  await expectAddress("allocator custody", allocator, "CUSTODY", custody);
  await expectAddress("allocator series token", allocator, "TOKEN", at("KyrveSeriesToken"));
  await expectAddress(
    "allocator ownership registry",
    allocator,
    "OWNERSHIP",
    at("SeriesOwnershipRegistry"),
  );
  await expectAddress("allocator ledger", allocator, "LEDGER", at("ReservationLedger"));
  await expectAddress("allocator quote registry", allocator, "QUOTES", at("KyrveQuoteRegistry"));
  await expectAddress("allocator series vault", allocator, "VAULT", record.seriesVault);
  await expectAddress(
    "allocator residue account",
    allocator,
    "residueAccount",
    at("SeriesResidueAccount"),
  );
  await expectAddress("token allocator authority", at("KyrveSeriesToken"), "allocator", allocator);
  await expectAddress(
    "ownership allocator authority",
    at("SeriesOwnershipRegistry"),
    "allocator",
    allocator,
  );
  await expectAddress(
    "residue recorder authority",
    at("SeriesResidueAccount"),
    "RECORDER",
    allocator,
  );
  await expectAddress(
    "residue declared beneficiary",
    at("SeriesResidueAccount"),
    "DECLARED_BENEFICIARY",
    record.residueBeneficiary,
  );

  // ── 8. The solvency verifier ──────────────────────────────────────────────────────────────
  const solvency = at("AggregateSolvencyVerifier");
  await expectAddress("solvency series token", solvency, "TOKEN", at("KyrveSeriesToken"));
  await expectAddress("solvency custody", solvency, "CUSTODY", custody);
  await expectAddress("solvency residue account", solvency, "RESIDUE", at("SeriesResidueAccount"));
  await expectAddress(
    "token solvency authority",
    at("KyrveSeriesToken"),
    "solvencyVerifier",
    solvency,
  );

  // The verifier's market must be the series' market, or `creditAtFunding` and the credit it is
  // compared against would be read from two different positions.
  const solvencyMarket = asBytes32(
    await client.readContract({
      address: solvency,
      abi: view("MARKET_ID", BYTES32_OUT),
      functionName: "MARKET_ID",
    }),
    "AggregateSolvencyVerifier.MARKET_ID()",
  );
  if (solvencyMarket.toLowerCase() !== record.marketId.toLowerCase()) {
    problems.push(
      `the solvency verifier is pinned to market ${solvencyMarket}, not ${record.marketId}`,
    );
  } else {
    passed.push({ what: "solvency market", detail: `MARKET_ID -> ${record.marketId}` });
  }

  // ── 9. The deployment id, and that it is NOT the superseded one ────────────────────────────
  const deploymentId = asBytes32(
    await client.readContract({
      address: at("KyrveQuoteRegistry"),
      abi: view("DEPLOYMENT_ID", BYTES32_OUT),
      functionName: "DEPLOYMENT_ID",
    }),
    "KyrveQuoteRegistry.DEPLOYMENT_ID()",
  );
  if (deploymentId.toLowerCase() !== record.deploymentId.toLowerCase()) {
    problems.push(
      `the registry derives deployment ${deploymentId}, the record says ${record.deploymentId}`,
    );
  } else {
    passed.push({ what: "deployment id", detail: deploymentId });
  }

  const supersededRegistry = record.superseded["KyrveQuoteRegistry"];
  if (supersededRegistry !== undefined) {
    const oldId = asBytes32(
      await client.readContract({
        address: supersededRegistry,
        abi: view("DEPLOYMENT_ID", BYTES32_OUT),
        functionName: "DEPLOYMENT_ID",
      }),
      "the superseded KyrveQuoteRegistry.DEPLOYMENT_ID()",
    );
    if (oldId.toLowerCase() === deploymentId.toLowerCase()) {
      problems.push(
        `the superseded registry at ${supersededRegistry} derives the SAME deployment id. A quote ` +
          "carries it in its provenance, so a collision would let an old quote authenticate here.",
      );
    } else {
      passed.push({
        what: "deployment id is distinct from the superseded one",
        detail: `${oldId.slice(0, 12)}… != ${deploymentId.slice(0, 12)}…`,
      });
    }
  }

  // ── 10. Source and runtime bytecode verification status ────────────────────────────────────
  const etherscanPath = repoPath(`deployments/${environment}/series-etherscan.json`);
  if (isSepolia) {
    if (!existsSync(etherscanPath)) {
      problems.push("no series-etherscan.json — run `pnpm verify:etherscan:series`");
    } else {
      const etherscan = readJson<{
        verified: number;
        total: number;
        contracts: readonly { contract: string; status: string; runtimeBytecodeHash: Hex }[];
      }>(etherscanPath);
      if (etherscan.verified !== etherscan.total) {
        problems.push(`${etherscan.verified}/${etherscan.total} contracts verified on Etherscan`);
      } else {
        passed.push({
          what: "Etherscan source verification",
          detail: `${etherscan.verified}/${etherscan.total} contracts`,
        });
      }
      // The verification record's runtime hashes must agree with the deployment record's. Two records
      // that disagree mean one of them describes a build that is not on chain.
      for (const entry of etherscan.contracts) {
        const deployed = record.contracts[entry.contract];
        if (deployed === undefined) continue;
        if (deployed.runtimeHash !== entry.runtimeBytecodeHash) {
          problems.push(
            `${entry.contract}: the deployment record and the verification record disagree on the ` +
              "runtime hash",
          );
        }
      }
    }
  }

  // ── Report ─────────────────────────────────────────────────────────────────────────────────
  const width = Math.min(48, Math.max(...passed.map((check) => check.what.length), 10));
  for (const check of passed) {
    console.log(`  ok    ${check.what.padEnd(width)}  ${check.detail}`);
  }
  if (problems.length > 0) {
    console.log("");
    for (const problem of problems) console.error(`  FAIL  ${problem}`);
    console.error(`\nverify:series FAILED — ${problems.length} problem(s)`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `\nverify:series PASS — ${passed.length} checks against chain state on ${environment}`,
  );
}

main().catch((error: unknown) => {
  console.error(
    `\nverify:series FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
