/**
 * Deploys the coherent Phase 5 handle-native set, to a local node or to Ethereum Sepolia.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY SEVENTEEN CONTRACTS AND NOT FIVE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Phase 5 adds five contracts. It cannot deploy only five, and the reason is mechanical rather than
 * a matter of taste:
 *
 *   `NoxCurveEngine` holds the vault it reads eligibility balances from as an `immutable`, so a new
 *   custody vault means a new engine. `bindEngine` is one-shot on `QuoteEpochController`,
 *   `CurveGraphRegistry` and `ReservationLedger`, so a new engine means new instances of all three.
 *   `CurveResultVerifier` holds the engine. `KyrvePublicResultVerifier` holds the engine, the graph
 *   and the epoch controller. `QuoteActivator` holds that verifier, `KyrveQuoteRegistry.bindActivator`
 *   is one-shot, and the ratifier, expiry controller and factory all hold the registry.
 *
 * `docs/phase5/P5-1-DECISION.md` §3 shows the REJECTED option needed exactly the same set, so this is
 * not a cost the architecture choice introduced.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IT DELIBERATELY DOES NOT REDEPLOY
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   `EncryptedMandateBook`       providers keep their mandates; they re-grant the new engine (T-8)
 *   `ConfidentialRequestBook`    borrowers keep their requests
 *   `KyrveEmergencyController`   its enum has no recovery member and must never gain one (Q-6)
 *   `CurveUniverseRegistry`      keeps every registered universe and rate grid
 *   `KyrveConfidentialAssetVault` still on chain, superseded, and the record says so
 *
 * A redeployment of any of those would produce a second layer whose mandates nobody holds.
 *
 * `KyrveWrappedAsset` IS redeployed, and only because it has to be. The Phase 2 wrapper on Sepolia
 * wraps its own `TestUnderlyingERC20`, and the Midnight market lends a DIFFERENT tUSDC — so unwrapping
 * through it would move an asset the series vault cannot pay Midnight in. Delta T-12. Provider balances
 * in the old wrapper are not lost: `unwrap` is never pausable and always available.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE TWELVE ONE-SHOT BINDINGS ARE PART OF THE DEPLOYMENT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every one is callable exactly once and reverts forever after, and every one is read back from chain
 * state before the manifest is written. A deployment that stopped before binding would leave a layer
 * that looks healthy and refuses every call.
 *
 * The series vault is created BEFORE the allocator and the solvency verifier, because both read it in
 * their constructors — `SeriesAllocator` checks `vault.SERIES_ID()` against its own series id and
 * `AggregateSolvencyVerifier` reads `vault.LOAN_TOKEN()`. That ordering also means the unwrap
 * recipient is an `immutable` chosen at deployment rather than an address derived from a quote, which
 * is strictly stronger. Threat T-G.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * IT RESUMES, AND THAT IS DELTA S-9 APPLIED TO A DEPLOYMENT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every contract address is appended to `.raw-deployment.json` THE MOMENT IT LANDS, before anything
 * else can fail. Phase 4 learned this the expensive way: an activation that could not be recovered
 * afterwards, discovered on a resume, when the alternative to recovery was paying for another epoch.
 *
 * On a re-run, a contract whose recorded address still holds code is REUSED rather than redeployed,
 * and a binding whose getter already points at the right address is skipped rather than re-sent. So a
 * run that fails in the read-back — as the first Sepolia run did, on a stale reference in this file
 * rather than anything on chain — costs nothing to finish.
 *
 * A resumed contract's creation transaction is recovered from Etherscan's `getcontractcreation` and
 * its gas from the receipt, so the manifest is identical whether the run was fresh or resumed. The raw
 * file is gitignored: it is scaffolding, and `series.json` is the record.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * SECRETS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The RPC URL is reduced to scheme and host in every line of output, the private key is never
 * printed, and the manifest is inspected for secrets before it is written.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { CONFIDENTIAL_COMPILER, NOX_COMPUTE_BY_CHAIN } from "@kyrve/config";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  type Hex,
  http,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat, sepolia } from "viem/chains";

import {
  assertBroadcastArmed,
  assertNoSecrets,
  deployer,
  etherscanApiKey,
  sepoliaRpc,
} from "../lib/env.js";
import { readJson, repoPath, stableStringify } from "../lib/shell.js";
import { SETTLEMENT_COMPILER } from "./settlement.js";

const LOCAL_RPC = "http://127.0.0.1:8545";
/** Anvil/Hardhat account zero. A published test key; it holds nothing on any public network. */
const LOCAL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

export type Environment = "local" | "sepolia";

/** The 0.8.36 confidential layer, from Hardhat artifacts. */
const CONFIDENTIAL = [
  "KyrveWrappedAsset",
  "KyrveCustodyVault",
  "QuoteEpochController",
  "CurveGraphRegistry",
  "ReservationLedger",
  "NoxCurveEngine",
  "CurveResultVerifier",
  "KyrveSeriesToken",
  "SeriesOwnershipRegistry",
  "SeriesAllocator",
  "SeriesResidueAccount",
  "AggregateSolvencyVerifier",
] as const;

/** The 0.8.34 settlement layer, from Foundry artifacts. */
const SETTLEMENT = [
  "KyrveQuoteRegistry",
  "KyrveSettlementRatifier",
  "KyrvePublicResultVerifier",
  "QuoteActivator",
  "KyrveQuoteExpiryController",
  "KyrveSeriesFactory",
] as const;

type ConfidentialContract = (typeof CONFIDENTIAL)[number];
type SettlementContract = (typeof SETTLEMENT)[number];
type Contract = ConfidentialContract | SettlementContract;

interface Artifact {
  readonly abi: readonly unknown[];
  readonly bytecode: Hex | { readonly object: Hex };
}

/** One deployed contract, with everything needed to re-verify it independently. */
interface DeployedContract {
  readonly address: Address;
  readonly deploymentTx: Hex;
  readonly block: string;
  readonly gasUsed: string;
  /** Constructor arguments as sent, in order. Etherscan needs these to reproduce the bytecode. */
  readonly constructorArgs: readonly string[];
  readonly runtimeHash: Hex;
  readonly runtimeSize: number;
  readonly layer: "confidential" | "settlement";
  readonly compiler: typeof CONFIDENTIAL_COMPILER | typeof SETTLEMENT_COMPILER;
  readonly explorerUrl: string | null;
}

export interface SeriesDeployment {
  readonly environment: Environment;
  readonly chainId: number;
  readonly deployer: Address;
  readonly keeper: Address;
  readonly operator: Address;
  readonly curator: Address;
  /** The declared, immutable destination for the funding residue. PRD §19.8. */
  readonly residueBeneficiary: Address;
  readonly deployedAt: string;
  readonly deploymentBlock: string;
  readonly noxCompute: Address;
  readonly midnight: Address;
  readonly loanToken: Address;
  readonly universeId: Hex;
  readonly marketId: Hex;
  readonly seriesId: Hex;
  readonly seriesVault: Address;
  readonly deploymentId: Hex;
  /** Reused, not redeployed. Each is still Etherscan-verified from an earlier phase. */
  readonly reused: Readonly<Record<string, Address>>;
  /** Superseded by this deployment, and still on chain. */
  readonly superseded: Readonly<Record<string, Address>>;
  readonly contracts: Readonly<Record<Contract, DeployedContract>>;
  readonly bindings: readonly string[];
  readonly wiringVerified: readonly string[];
  /**
   * The sum of every contract's creation gas, whether this run sent it or recovered it.
   *
   * THE DURABLE FIGURE. A resumed run sends nothing, so its own balance delta is zero — reporting that
   * as what the deployment cost would understate it by the whole deployment.
   */
  readonly contractCreationGas: string;
  /** What THIS invocation broadcast. Zero on a fully resumed run, and that is the correct zero. */
  readonly gasUsedThisRun: string;
  readonly ethSpentThisRun: string;
}

function confidentialArtifact(name: string): Artifact {
  const path = repoPath(`confidential/artifacts/contracts/${name}.sol/${name}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `${name} has no artifact at ${path}. Run \`pnpm --dir confidential exec hardhat compile\`.`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as Artifact;
}

function settlementArtifact(name: string): Artifact {
  const path = repoPath(`out/${name}.sol/${name}.json`);
  if (!existsSync(path))
    throw new Error(`${name} has no artifact at ${path}. Run \`forge build\`.`);
  return JSON.parse(readFileSync(path, "utf8")) as Artifact;
}

function bytecodeOf(artifact: Artifact): Hex {
  return typeof artifact.bytecode === "string" ? artifact.bytecode : artifact.bytecode.object;
}

function isSettlement(name: Contract): name is SettlementContract {
  return (SETTLEMENT as readonly string[]).includes(name);
}

export async function deploySeries(environment: Environment): Promise<SeriesDeployment> {
  const isSepolia = environment === "sepolia";
  const chain = isSepolia ? sepolia : hardhat;
  const chainId = isSepolia ? 11_155_111 : 31_337;
  const explorer = isSepolia ? "https://sepolia.etherscan.io" : null;

  if (isSepolia) assertBroadcastArmed();

  const rpcUrl = isSepolia ? sepoliaRpc().url : LOCAL_RPC;
  const redacted = isSepolia ? sepoliaRpc().redacted : LOCAL_RPC;
  // The key never leaves this line. `deployer()` returns it alongside the public address and refuses
  // to echo it anywhere, so the account object is built here and the raw value is never held.
  const account = privateKeyToAccount(isSepolia ? deployer().privateKey : LOCAL_KEY);

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });

  const onChainId = await publicClient.getChainId();
  if (onChainId !== chainId)
    throw new Error(`the RPC is on chain ${onChainId}, expected ${chainId}`);

  console.log(`\ndeploy:series — ${environment} — ${redacted}\n`);

  // ── What this builds on, all of it already deployed ────────────────────────────────────────
  const curveRecord = readJson<{
    addresses: Record<string, Address>;
    phase2: Record<string, Address>;
  }>(repoPath(`deployments/${environment}/curve.json`));
  const settlementRecord = readJson<{
    addresses: Record<string, Address>;
    midnight: Address;
    loanToken: Address;
  }>(repoPath(`deployments/${environment}/settlement.json`));

  const reused = {
    KyrveEmergencyController: curveRecord.phase2["KyrveEmergencyController"],
    EncryptedMandateBook: curveRecord.phase2["EncryptedMandateBook"],
    ConfidentialRequestBook: curveRecord.phase2["ConfidentialRequestBook"],
    CurveUniverseRegistry: curveRecord.addresses["CurveUniverseRegistry"],
    Midnight: settlementRecord.midnight,
    LoanToken: settlementRecord.loanToken,
  } as Record<string, Address>;

  for (const [name, address] of Object.entries(reused)) {
    if (address === undefined) throw new Error(`the ${environment} records do not name ${name}`);
    const code = await publicClient.getCode({ address });
    if (code === undefined || code === "0x") {
      throw new Error(`the reused ${name} at ${address} has no code`);
    }
  }
  console.log(`  reused    ${Object.keys(reused).length} contracts, all live`);

  const loanTokenCode = await publicClient.getCode({ address: settlementRecord.loanToken });
  if (loanTokenCode === undefined || loanTokenCode === "0x") {
    throw new Error(`the market's loan token at ${settlementRecord.loanToken} has no code`);
  }
  console.log(
    `  loan token ${settlementRecord.loanToken} — what the market lends, and what the new`,
  );
  console.log("            wrapper will wrap (delta T-12)");

  const superseded = {
    KyrveConfidentialAssetVault: curveRecord.phase2["KyrveConfidentialAssetVault"],
    ...curveRecord.addresses,
    ...settlementRecord.addresses,
  } as Record<string, Address>;
  delete superseded["CurveUniverseRegistry"];

  const noxCompute = NOX_COMPUTE_BY_CHAIN[chainId];
  if (noxCompute === undefined)
    throw new Error(`no NoxCompute address is known for chain ${chainId}`);

  const balanceBefore = await publicClient.getBalance({ address: account.address });
  console.log(`  balance   ${formatEther(balanceBefore)} ETH\n`);

  const contracts = {} as Record<Contract, DeployedContract>;
  let gasUsed = 0n;

  /**
   * The scaffolding record, appended to as each contract lands.
   *
   * Gitignored on purpose. It exists so a run that fails after a broadcast can be finished instead of
   * repaid, and `series.json` remains the only record anything else reads.
   */
  const rawPath = repoPath(`deployments/${environment}/.raw-deployment.json`);
  const raw: { addresses: Record<string, Address>; seriesVault?: Address } = existsSync(rawPath)
    ? readJson(rawPath)
    : { addresses: {} };
  const rememberRaw = (): void => {
    mkdirSync(repoPath(`deployments/${environment}`), { recursive: true });
    writeFileSync(rawPath, `${stableStringify(raw)}\n`);
  };

  /** Recovers a resumed contract's creation transaction, so a resumed manifest is a full manifest. */
  async function recoverCreation(
    address: Address,
  ): Promise<{ tx: Hex; block: string; gas: string } | undefined> {
    if (!isSepolia) return undefined;
    try {
      const response = await fetch(
        `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract` +
          `&action=getcontractcreation&contractaddresses=${address}` +
          `&apikey=${encodeURIComponent(etherscanApiKey())}`,
      );
      const json = (await response.json()) as {
        status: string;
        result?: { txHash?: string }[];
      };
      const tx = json.status === "1" ? json.result?.[0]?.txHash : undefined;
      if (tx === undefined) return undefined;
      const receipt = await publicClient.getTransactionReceipt({ hash: tx as Hex });
      return {
        tx: tx as Hex,
        block: receipt.blockNumber.toString(),
        gas: receipt.gasUsed.toString(),
      };
    } catch {
      return undefined;
    }
  }

  async function record(
    name: Contract,
    address: Address,
    args: readonly unknown[],
    landed: { tx: Hex; block: string; gas: string } | undefined,
  ): Promise<void> {
    const code = await publicClient.getCode({ address });
    if (code === undefined || code === "0x") {
      throw new Error(`${name} at ${address} has no code — it did not land`);
    }
    contracts[name] = {
      address,
      deploymentTx: landed?.tx ?? "0x",
      block: landed?.block ?? "0",
      gasUsed: landed?.gas ?? "0",
      // Stringified so a bigint survives JSON and a reader can paste them into Etherscan.
      constructorArgs: args.map((arg) => String(arg)),
      runtimeHash: keccak256(code),
      runtimeSize: (code.length - 2) / 2,
      layer: isSettlement(name) ? "settlement" : "confidential",
      compiler: isSettlement(name) ? SETTLEMENT_COMPILER : CONFIDENTIAL_COMPILER,
      explorerUrl: explorer === null ? null : `${explorer}/address/${address}#code`,
    };
    raw.addresses[name] = address;
    rememberRaw();
  }

  async function deploy(name: Contract, args: readonly unknown[]): Promise<Address> {
    // RESUME. A recorded address that still holds code is the contract this run would have deployed,
    // so redeploying it would spend gas to produce a second copy nothing references.
    const known = raw.addresses[name];
    if (known !== undefined) {
      const code = await publicClient.getCode({ address: known });
      if (code !== undefined && code !== "0x") {
        await record(name, known, args, await recoverCreation(known));
        console.log(`  ${name.padEnd(26)} ${known}  resumed, already on chain`);
        return known;
      }
    }

    const artifact = isSettlement(name) ? settlementArtifact(name) : confidentialArtifact(name);
    const hash = await wallet.deployContract({
      abi: artifact.abi as never,
      bytecode: bytecodeOf(artifact),
      args: args as never,
      account,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const address = receipt.contractAddress ?? undefined;
    if (receipt.status !== "success" || address === undefined) {
      throw new Error(`${name} deployment reverted or produced no contract address`);
    }
    gasUsed += receipt.gasUsed;

    // Read the code back rather than trusting the receipt, and record before anything else can fail.
    await record(name, address, args, {
      tx: hash,
      block: receipt.blockNumber.toString(),
      gas: receipt.gasUsed.toString(),
    });
    console.log(`  ${name.padEnd(26)} ${address}  ${receipt.gasUsed} gas`);
    return address;
  }

  const bindings: string[] = [];

  async function bind(
    name: Contract,
    functionName: string,
    args: readonly unknown[],
    getter: string,
    expected: Address,
  ): Promise<void> {
    const artifact = isSettlement(name) ? settlementArtifact(name) : confidentialArtifact(name);

    // RESUME. Every binding here is one-shot and reverts forever after, so re-sending one on a resumed
    // run would fail the whole deployment on a step that had already succeeded.
    const already = (await publicClient.readContract({
      address: contracts[name].address,
      abi: artifact.abi as never,
      functionName: getter as never,
    })) as Address;
    if (already.toLowerCase() === expected.toLowerCase()) {
      bindings.push(`${name}.${getter}() -> ${expected}`);
      console.log(`  ${name.padEnd(26)} ${getter}() -> ${expected}  (already bound)`);
      return;
    }

    const hash = await wallet.writeContract({
      address: contracts[name].address,
      abi: artifact.abi as never,
      functionName: functionName as never,
      args: args as never,
      account,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${name}.${functionName} reverted`);
    gasUsed += receipt.gasUsed;

    // Read back from chain state. A binding transaction that succeeded and wrote nothing would
    // otherwise leave a layer that looks healthy and refuses every call.
    const actual = (await publicClient.readContract({
      address: contracts[name].address,
      abi: artifact.abi as never,
      functionName: getter as never,
    })) as Address;
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`${name}.${getter}() is ${actual}, expected ${expected}`);
    }
    bindings.push(`${name}.${getter}() -> ${expected}`);
    console.log(`  ${name.padEnd(26)} ${getter}() -> ${expected}`);
  }

  // ── 1. Custody, then the curve layer ──────────────────────────────────────────────────────
  console.log("  confidential layer (solc 0.8.36)");

  /**
   * THE WRAPPER MUST WRAP WHAT THE MARKET LENDS, so it is deployed rather than reused. Delta T-12.
   *
   * The Phase 2 wrapper on Sepolia wraps its own `TestUnderlyingERC20`; the Midnight market lends a
   * different tUSDC. Unwrapping through the old one would move an asset the series vault cannot pay
   * Midnight in — every encrypted step would succeed and activation would revert `FundingShortfall`
   * naming a number with no hint of the cause. That is exactly how this surfaced locally, and the guard
   * below caught it on Sepolia before a single contract was deployed.
   *
   * Provider balances in the old wrapper are not stranded. `unwrap` has no pause flag and never can
   * have one, so anyone holding the old confidential token can always take the underlying back out.
   */
  const asset = await deploy("KyrveWrappedAsset", [
    "Kyrve Confidential USDC",
    "cUSDC",
    "",
    settlementRecord.loanToken,
    reused["KyrveEmergencyController"],
  ]);

  const underlying = (await publicClient.readContract({
    address: asset,
    abi: [
      {
        type: "function",
        name: "underlying",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "address" }],
      },
    ],
    functionName: "underlying",
  })) as Address;
  if (underlying.toLowerCase() !== settlementRecord.loanToken.toLowerCase()) {
    throw new Error(
      `the new wrapper's underlying is ${underlying} but the market lends ` +
        `${settlementRecord.loanToken}. Delta T-10.`,
    );
  }

  const custody = await deploy("KyrveCustodyVault", [asset, reused["KyrveEmergencyController"]]);
  const epochs = await deploy("QuoteEpochController", [
    reused["CurveUniverseRegistry"],
    reused["EncryptedMandateBook"],
    reused["ConfidentialRequestBook"],
  ]);
  const graph = await deploy("CurveGraphRegistry", [epochs]);
  const ledger = await deploy("ReservationLedger", [custody, reused["KyrveEmergencyController"]]);
  const engine = await deploy("NoxCurveEngine", [
    reused["CurveUniverseRegistry"],
    epochs,
    graph,
    ledger,
    reused["EncryptedMandateBook"],
    reused["ConfidentialRequestBook"],
    custody,
    reused["KyrveEmergencyController"],
  ]);
  const curveVerifier = await deploy("CurveResultVerifier", [graph, engine, epochs]);

  console.log("\n  one-shot bindings (irreversible)");
  await bind("QuoteEpochController", "bindEngine", [engine], "engine", engine);
  await bind("CurveGraphRegistry", "bindEngine", [engine], "engine", engine);
  await bind("ReservationLedger", "bindEngine", [engine], "engine", engine);
  // The custody vault's reserver. A mutable one would be an arbitrary-spend surface over every
  // balance the vault holds — threat T-B.
  await bind("KyrveCustodyVault", "bindReserver", [ledger], "reserver", ledger);

  // ── 2. The settlement layer ───────────────────────────────────────────────────────────────
  console.log("\n  settlement layer (solc 0.8.34)");
  const registry = await deploy("KyrveQuoteRegistry", [settlementRecord.midnight]);
  const ratifier = await deploy("KyrveSettlementRatifier", [settlementRecord.midnight, registry]);
  const resultVerifier = await deploy("KyrvePublicResultVerifier", [
    curveVerifier,
    graph,
    engine,
    epochs,
  ]);
  const activator = await deploy("QuoteActivator", [
    registry,
    resultVerifier,
    reused["CurveUniverseRegistry"],
    ratifier,
    account.address,
  ]);
  const expiryController = await deploy("KyrveQuoteExpiryController", [registry, account.address]);
  const factory = await deploy("KyrveSeriesFactory", [
    registry,
    activator,
    expiryController,
    account.address,
  ]);

  console.log("\n  one-shot bindings (irreversible)");
  await bind("KyrveQuoteRegistry", "bindActivator", [activator], "activator", activator);
  await bind(
    "KyrveQuoteRegistry",
    "bindExpiryController",
    [expiryController],
    "expiryController",
    expiryController,
  );
  await bind("QuoteActivator", "bindFactory", [factory], "factory", factory);

  const deploymentId = (await publicClient.readContract({
    address: registry,
    abi: settlementArtifact("KyrveQuoteRegistry").abi as never,
    functionName: "DEPLOYMENT_ID",
  })) as Hex;

  // ── 3. The series vault, created before the contracts that read it ─────────────────────────
  //
  // `SeriesAllocator` checks `vault.SERIES_ID()` against its own series id and
  // `AggregateSolvencyVerifier` reads `vault.LOAN_TOKEN()`, so the vault must exist first. That
  // ordering also makes the unwrap recipient an `immutable` chosen at deployment rather than an
  // address derived from a quote. Threat T-G.
  const { universeId, marketId } = await resolveMarketId(
    publicClient,
    reused["CurveUniverseRegistry"] as Address,
    environment,
  );
  const factoryAbi = settlementArtifact("KyrveSeriesFactory").abi;
  const seriesId = (await publicClient.readContract({
    address: factory,
    abi: factoryAbi as never,
    functionName: "seriesIdFor",
    args: [marketId] as never,
  })) as Hex;

  console.log(`\n  market    ${marketId}`);
  console.log(`  series    ${seriesId}`);

  /**
   * RESUME. `createSeries` is one-shot per series and reverts on a second call, so the factory is asked
   * first. A vault that already exists is the vault this run would have created.
   */
  let seriesVault = (await publicClient.readContract({
    address: factory,
    abi: factoryAbi as never,
    functionName: "vaultOf",
    args: [seriesId] as never,
  })) as Address;

  if (seriesVault === "0x0000000000000000000000000000000000000000") {
    const createHash = await wallet.writeContract({
      address: factory,
      abi: factoryAbi as never,
      functionName: "createSeries" as never,
      args: [marketId, settlementRecord.loanToken, account.address] as never,
      account,
      chain,
    });
    const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
    if (createReceipt.status !== "success") throw new Error("createSeries reverted");
    gasUsed += createReceipt.gasUsed;

    seriesVault = (await publicClient.readContract({
      address: factory,
      abi: factoryAbi as never,
      functionName: "vaultOf",
      args: [seriesId] as never,
    })) as Address;
    if (seriesVault === "0x0000000000000000000000000000000000000000") {
      throw new Error("createSeries succeeded and the factory reports no vault");
    }
    console.log(`  vault     ${seriesVault}  ${createReceipt.gasUsed} gas`);
  } else {
    console.log(`  vault     ${seriesVault}  resumed, already created`);
  }

  raw.seriesVault = seriesVault;
  rememberRaw();

  // The vault must be the maker for THIS series. A factory that returned a vault for a different
  // series id would make every later series check pass against the wrong maker.
  const vaultSeries = (await publicClient.readContract({
    address: seriesVault,
    abi: [
      {
        type: "function",
        name: "SERIES_ID",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "bytes32" }],
      },
    ],
    functionName: "SERIES_ID",
  })) as Hex;
  if (vaultSeries.toLowerCase() !== seriesId.toLowerCase()) {
    throw new Error(`the vault at ${seriesVault} serves series ${vaultSeries}, not ${seriesId}`);
  }

  // ── 4. The series layer ───────────────────────────────────────────────────────────────────
  console.log("\n  series layer (solc 0.8.36)");
  const token = await deploy("KyrveSeriesToken", [
    "Kyrve Series",
    "kSER",
    "",
    seriesId,
    settlementRecord.loanToken,
    account.address,
    reused["KyrveEmergencyController"],
  ]);
  const ownership = await deploy("SeriesOwnershipRegistry", [
    seriesId,
    reused["KyrveEmergencyController"],
  ]);
  const allocator = await deploy("SeriesAllocator", [
    seriesId,
    custody,
    token,
    ownership,
    epochs,
    graph,
    ledger,
    registry,
    seriesVault,
    marketId,
    account.address,
    reused["KyrveEmergencyController"],
  ]);
  // The residue account's RECORDER is `immutable` and set here, so the allocator must exist first —
  // and the allocator's reference to it is bound after the fact. The stronger authority belongs in
  // immutable storage.
  const residue = await deploy("SeriesResidueAccount", [
    seriesId,
    settlementRecord.loanToken,
    account.address,
    allocator,
  ]);
  const solvency = await deploy("AggregateSolvencyVerifier", [
    seriesId,
    marketId,
    token,
    custody,
    seriesVault,
    residue,
    reused["KyrveEmergencyController"],
  ]);

  console.log("\n  one-shot bindings (irreversible)");
  await bind("KyrveSeriesToken", "bindAllocator", [allocator], "allocator", allocator);
  await bind("KyrveSeriesToken", "bindSolvencyVerifier", [solvency], "solvencyVerifier", solvency);
  await bind("SeriesOwnershipRegistry", "bindAllocator", [allocator], "allocator", allocator);
  await bind("SeriesAllocator", "bindResidueAccount", [residue], "residueAccount", residue);
  // The custody vault's settler: the only address that can consume a lock. Threat T-B.
  await bind("KyrveCustodyVault", "bindSettler", [allocator], "settler", allocator);

  // ── 5. Read every constructor reference back from chain state ──────────────────────────────
  console.log("\n  verifying constructor wiring from chain state...");
  const wiringVerified: string[] = [];
  const rules: readonly { contract: Contract; getter: string; expected: Address }[] = [
    {
      contract: "KyrveCustodyVault",
      getter: "asset",
      expected: asset,
    },
    { contract: "ReservationLedger", getter: "custody", expected: custody },
    { contract: "NoxCurveEngine", getter: "vault", expected: custody },
    { contract: "NoxCurveEngine", getter: "ledger", expected: ledger },
    { contract: "NoxCurveEngine", getter: "graph", expected: graph },
    { contract: "NoxCurveEngine", getter: "controller", expected: epochs },
    {
      contract: "NoxCurveEngine",
      getter: "universes",
      expected: reused["CurveUniverseRegistry"] as Address,
    },
    { contract: "CurveResultVerifier", getter: "engine", expected: engine },
    { contract: "KyrvePublicResultVerifier", getter: "ENGINE", expected: engine },
    { contract: "KyrvePublicResultVerifier", getter: "GRAPH", expected: graph },
    { contract: "KyrvePublicResultVerifier", getter: "CURVE_VERIFIER", expected: curveVerifier },
    { contract: "QuoteActivator", getter: "REGISTRY", expected: registry },
    { contract: "QuoteActivator", getter: "VERIFIER", expected: resultVerifier },
    { contract: "QuoteActivator", getter: "RATIFIER", expected: ratifier },
    { contract: "KyrveSeriesFactory", getter: "REGISTRY", expected: registry },
    { contract: "SeriesAllocator", getter: "CUSTODY", expected: custody },
    { contract: "SeriesAllocator", getter: "TOKEN", expected: token },
    { contract: "SeriesAllocator", getter: "OWNERSHIP", expected: ownership },
    { contract: "SeriesAllocator", getter: "LEDGER", expected: ledger },
    { contract: "SeriesAllocator", getter: "QUOTES", expected: registry },
    { contract: "SeriesAllocator", getter: "VAULT", expected: seriesVault },
    { contract: "AggregateSolvencyVerifier", getter: "TOKEN", expected: token },
    { contract: "AggregateSolvencyVerifier", getter: "CUSTODY", expected: custody },
    { contract: "AggregateSolvencyVerifier", getter: "RESIDUE", expected: residue },
    { contract: "SeriesResidueAccount", getter: "RECORDER", expected: allocator },
    { contract: "SeriesResidueAccount", getter: "DECLARED_BENEFICIARY", expected: account.address },
  ];

  for (const rule of rules) {
    const artifact = isSettlement(rule.contract)
      ? settlementArtifact(rule.contract)
      : confidentialArtifact(rule.contract);
    const actual = (await publicClient.readContract({
      address: contracts[rule.contract].address,
      abi: artifact.abi as never,
      functionName: rule.getter as never,
    })) as Address;
    if (actual.toLowerCase() !== rule.expected.toLowerCase()) {
      throw new Error(`${rule.contract}.${rule.getter}() is ${actual}, expected ${rule.expected}`);
    }
    wiringVerified.push(`${rule.contract}.${rule.getter}() -> ${rule.expected}`);
  }
  console.log(`  ${wiringVerified.length}/${rules.length} wiring checks PASS`);

  const block = await publicClient.getBlockNumber();
  const timestamp = (await publicClient.getBlock({ blockNumber: block })).timestamp;
  const balanceAfter = await publicClient.getBalance({ address: account.address });

  const deployment: SeriesDeployment = {
    environment,
    chainId,
    deployer: account.address,
    keeper: account.address,
    operator: account.address,
    curator: account.address,
    residueBeneficiary: account.address,
    deployedAt: new Date(Number(timestamp) * 1000).toISOString(),
    deploymentBlock: block.toString(),
    noxCompute,
    midnight: settlementRecord.midnight,
    loanToken: settlementRecord.loanToken,
    universeId,
    marketId,
    seriesId,
    seriesVault,
    deploymentId,
    reused,
    superseded,
    contracts,
    bindings,
    wiringVerified,
    contractCreationGas: Object.values(contracts)
      .reduce((sum, entry) => sum + BigInt(entry.gasUsed), 0n)
      .toString(),
    gasUsedThisRun: gasUsed.toString(),
    ethSpentThisRun: formatEther(balanceBefore - balanceAfter),
  };

  const payload = `${stableStringify(deployment)}\n`;
  assertNoSecrets(payload, `deployments/${environment}/series.json`);
  mkdirSync(repoPath(`deployments/${environment}`), { recursive: true });
  writeFileSync(repoPath(`deployments/${environment}/series.json`), payload);

  console.log(`\n  ${deployment.contractCreationGas} gas of contract creations`);
  console.log(`  ${gasUsed} gas broadcast by this run, ${deployment.ethSpentThisRun} ETH`);
  console.log(`  balance   ${formatEther(balanceAfter)} ETH remaining`);
  console.log(`  recorded in deployments/${environment}/series.json\n`);
  return deployment;
}

/**
 * The market of the active universe this series will quote into.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE UNIVERSE ID COMES FROM RECORDED EVIDENCE AND THE MARKET DOES NOT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CurveUniverseRegistry` does not enumerate universes. It is keyed on `keccak256(label)` through
 * `universeIdFor`, deliberately — an enumerable registry invites "the last one wins", which is exactly
 * the kind of implicit default a deployment must not carry. So the universe id is read from the
 * recorded epoch that ran against it.
 *
 * The MARKET is then read from the registry rather than from the same record, and the universe is
 * asserted ACTIVE first. A record could name a universe the registry never activated, or a market it
 * does not carry — and either would produce a series vault for a market no quote can ever select, which
 * would only surface at activation as a vault mismatch.
 */
async function resolveMarketId(
  client: ReturnType<typeof createPublicClient>,
  universes: Address,
  environment: Environment,
): Promise<{ universeId: Hex; marketId: Hex }> {
  const evidencePath = repoPath(
    environment === "sepolia"
      ? "evidence/phase4/sepolia-epoch.json"
      : "deployments/local/markets.json",
  );
  if (!existsSync(evidencePath)) {
    throw new Error(
      `no record names the universe to quote into (looked in ${evidencePath}). Phase 5 creates a ` +
        "series vault for the market a quote will select, and the registry does not enumerate " +
        "universes — it is keyed on the label hash.",
    );
  }
  const record = readJson<{ universeId?: Hex }>(evidencePath);
  const universeId = record.universeId;
  if (universeId === undefined) {
    throw new Error(`${evidencePath} does not name a universeId`);
  }

  const abi = [
    {
      type: "function",
      name: "isActive",
      stateMutability: "view",
      inputs: [{ type: "bytes32" }],
      outputs: [{ type: "bool" }],
    },
    {
      type: "function",
      name: "leafCount",
      stateMutability: "view",
      inputs: [{ type: "bytes32" }],
      outputs: [{ type: "uint256" }],
    },
    {
      type: "function",
      name: "marketAt",
      stateMutability: "view",
      inputs: [{ type: "bytes32" }, { type: "uint256" }],
      outputs: [
        {
          type: "tuple",
          components: [
            { name: "marketId", type: "bytes32" },
            { name: "marketStructHash", type: "bytes32" },
            { name: "maturity", type: "uint64" },
            { name: "collateralFamily", type: "uint16" },
            { name: "maturityBucket", type: "uint16" },
            { name: "tickSpacing", type: "uint32" },
            { name: "settlementFeeFloorWad", type: "uint256" },
            { name: "publicPriority", type: "uint16" },
          ],
        },
      ],
    },
  ] as const;

  const active = (await client.readContract({
    address: universes,
    abi,
    functionName: "isActive",
    args: [universeId],
  })) as boolean;
  if (!active) {
    throw new Error(
      `universe ${universeId} is not active in the reused registry at ${universes}. A frozen universe ` +
        "is what every published rate grid, privacy floor and chunk width is committed to, so an " +
        "inactive one cannot be quoted into.",
    );
  }

  const leaves = (await client.readContract({
    address: universes,
    abi,
    functionName: "leafCount",
    args: [universeId],
  })) as bigint;
  if (leaves === 0n) throw new Error(`universe ${universeId} carries no leaves`);

  const market = (await client.readContract({
    address: universes,
    abi,
    functionName: "marketAt",
    args: [universeId, 0n],
  })) as { marketId: Hex };

  console.log(`  universe  ${universeId}  active, ${leaves} leaves`);
  return { universeId, marketId: market.marketId };
}

const environment: Environment = process.argv[2] === "sepolia" ? "sepolia" : "local";
deploySeries(environment).catch((error: unknown) => {
  console.error(
    `\ndeploy:series FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
