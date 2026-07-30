/**
 * Deploys the Phase 6 market-operations layer on top of one or two existing series deployments.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A SEPARATE SCRIPT AND NOT PART OF `deploy:series`
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Capsule and Cross operate WITHIN one series and could live in the series deployment. `KyrveRollBook`
 * cannot: it holds two `KyrveSeriesToken` addresses as immutables, and a Kyrve deployment serves
 * exactly one series (delta [U-1](../../docs/phase6/PRD-DELTA.md)). So the roll book can only be
 * deployed once BOTH layers exist, which is a different moment from either of them.
 *
 * Keeping it separate also keeps the failure modes separable. A layer that deployed and a market
 * layer that did not is a coherent state — every claim is still owned, redeemable and recoverable,
 * and nothing about Capsule, Cross or Roll is load-bearing for the series it sits on.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * IT RESUMES, LIKE EVERY OTHER BROADCAST IN THIS REPOSITORY
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Each address is written to `.raw-market.json` the moment it lands, and a contract whose recorded
 * address still holds code is reused rather than redeployed. Deltas T-13 and T-14: a public-network
 * run gets interrupted, and the answer is to record each step immediately and skip what has already
 * happened rather than retrying it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE DECLARED PRICE AND FEE ARE ARGUMENTS BECAUSE THEY ARE IMMUTABLES
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `PRICE_WAD`, `FEE_BPS` and `FEE_BENEFICIARY` are fixed at construction and can never be changed,
 * so they are chosen here, in the open, before any order exists — rather than set later by a key
 * that could reprice a book with orders already in it. The fee beneficiary is the RESIDUE
 * BENEFICIARY role, never an operational key.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { CONFIDENTIAL_COMPILER } from "@kyrve/config";
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

import { assertBroadcastArmed, assertNoSecrets, deployer, sepoliaRpc } from "../lib/env.js";
import { describeRoles, resolveRoles } from "../lib/roles.js";
import { readJson, repoPath, stableStringify } from "../lib/shell.js";

const LOCAL_RPC = "http://127.0.0.1:8545";
const LOCAL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const WAD = 10n ** 18n;

type Environment = "local" | "sepolia";

/**
 * The declared Cross price for this deployment: 0.97 loan units per claim unit.
 *
 * A discount rather than par, and deliberately not a round fraction, so `floor(matched * price /
 * WAD)` produces real sub-unit dust and the rounding policy is exercised by the public run rather
 * than only by the local fixture.
 */
const CROSS_PRICE_WAD = 970_000_000_000_000_000n;
/** 0.25%. Non-zero so the public conservation identity includes the fee term rather than dodging it. */
const CROSS_FEE_BPS = 25;
/** What one TARGET claim unit costs in loan units, for the roll. A later maturity, deeper discount. */
const ROLL_TARGET_PRICE_WAD = 940_000_000_000_000_000n;

interface SeriesRecord {
  readonly chainId: number;
  readonly deploymentId: Hex;
  readonly seriesId: Hex;
  readonly marketId: Hex;
  readonly seriesVault: Address;
  readonly loanToken: Address;
  readonly contracts: Record<string, { readonly address: Address }>;
  readonly reused: Record<string, Address>;
}

interface DeployedContract {
  readonly address: Address;
  readonly deploymentTx: Hex;
  readonly block: string;
  readonly gasUsed: string;
  readonly constructorArgs: readonly string[];
  readonly runtimeHash: Hex;
  readonly runtimeSize: number;
  /** Always the confidential layer. Recorded so the Etherscan verifier reads one shape. */
  readonly layer: "confidential";
  readonly compiler: typeof CONFIDENTIAL_COMPILER;
  readonly explorerUrl: string | null;
}

export interface MarketDeployment {
  readonly environment: Environment;
  readonly chainId: number;
  readonly deployer: Address;
  readonly deployedAt: string;
  readonly deploymentBlock: string;
  /** The layer Capsule and Cross serve. */
  readonly seriesId: Hex;
  readonly deploymentId: Hex;
  /** The second layer, when a roll book was deployed. Absent otherwise, and that is not a failure. */
  readonly targetSeriesId: Hex | null;
  readonly crossPriceWad: string;
  readonly crossFeeBps: number;
  readonly crossFeeBeneficiary: Address;
  readonly rollTargetPriceWad: string;
  readonly compiler: typeof CONFIDENTIAL_COMPILER;
  readonly contracts: Readonly<Record<string, DeployedContract>>;
  readonly wiringVerified: readonly string[];
  readonly gasUsed: string;
  readonly ethSpent: string;
  /** Stated rather than left to be inferred from the absence of a roll book. */
  readonly scopeNote: string;
}

function confidentialArtifact(name: string): { abi: readonly unknown[]; bytecode: Hex } {
  const path = repoPath(`confidential/artifacts/contracts/${name}.sol/${name}.json`);
  if (!existsSync(path)) {
    throw new Error(`${name} has no artifact. Run \`pnpm --filter @kyrve/confidential build\`.`);
  }
  const artifact = JSON.parse(readFileSync(path, "utf8")) as {
    abi: readonly unknown[];
    bytecode: Hex | { object: Hex };
  };
  return {
    abi: artifact.abi,
    bytecode: typeof artifact.bytecode === "string" ? artifact.bytecode : artifact.bytecode.object,
  };
}

export async function deployMarket(environment: Environment): Promise<MarketDeployment> {
  const isSepolia = environment === "sepolia";
  const chain = isSepolia ? sepolia : hardhat;
  const chainId = isSepolia ? 11_155_111 : 31_337;
  const explorer = isSepolia ? "https://sepolia.etherscan.io" : null;
  if (isSepolia) assertBroadcastArmed();

  const rpcUrl = isSepolia ? sepoliaRpc().url : LOCAL_RPC;
  const redacted = isSepolia ? sepoliaRpc().redacted : LOCAL_RPC;
  const account = privateKeyToAccount(isSepolia ? deployer().privateKey : LOCAL_KEY);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });

  const onChainId = await publicClient.getChainId();
  if (onChainId !== chainId) {
    throw new Error(`the RPC is on chain ${onChainId}, expected ${chainId}`);
  }

  const roles = resolveRoles(environment, { requireKeys: ["deployer"] });
  const primary = readJson<SeriesRecord>(repoPath(`deployments/${environment}/series.json`));
  const targetPath = repoPath(`deployments/${environment}/series-b.json`);
  const target = existsSync(targetPath) ? readJson<SeriesRecord>(targetPath) : null;

  console.log(`\ndeploy:market — ${environment} — ${redacted}\n`);
  for (const role of describeRoles(roles)) console.log(`  ${role.role.padEnd(20)} ${role.address}`);
  console.log(`\n  series    ${primary.seriesId}`);
  console.log(
    `  target    ${target === null ? "(none — no roll book will be deployed)" : target.seriesId}`,
  );
  console.log(`  price     ${Number(CROSS_PRICE_WAD) / Number(WAD)} loan units per claim unit`);
  console.log(`  fee       ${CROSS_FEE_BPS} bps to ${roles.accounts.residueBeneficiary.address}\n`);

  if (target !== null && target.seriesId.toLowerCase() === primary.seriesId.toLowerCase()) {
    throw new Error(
      "series-b.json describes the SAME series as series.json. A roll between a series and itself " +
        "is not a roll, and KyrveRollBook's constructor refuses it with SameSeries.",
    );
  }

  // ── Resume state, written the moment anything lands ────────────────────────────────────────
  const rawPath = repoPath(`deployments/${environment}/.raw-market.json`);
  const raw: Record<string, { address: Address; tx: Hex; block: string; gas: string }> = existsSync(
    rawPath,
  )
    ? JSON.parse(readFileSync(rawPath, "utf8"))
    : {};

  const contracts: Record<string, DeployedContract> = {};
  let gasUsed = 0n;
  const balanceBefore = await publicClient.getBalance({ address: account.address });

  async function deploy(name: string, args: readonly unknown[]): Promise<Address> {
    const recorded = raw[name];
    if (recorded !== undefined) {
      const code = await publicClient.getCode({ address: recorded.address });
      if (code !== undefined && code !== "0x") {
        contracts[name] = {
          address: recorded.address,
          deploymentTx: recorded.tx,
          block: recorded.block,
          gasUsed: recorded.gas,
          constructorArgs: args.map((a) => String(a)),
          runtimeHash: keccak256(code),
          runtimeSize: (code.length - 2) / 2,
          layer: "confidential",
          compiler: CONFIDENTIAL_COMPILER,
          explorerUrl: explorer === null ? null : `${explorer}/address/${recorded.address}#code`,
        };
        console.log(`  ${name.padEnd(20)} ${recorded.address}  resumed, already on chain`);
        return recorded.address;
      }
    }

    const artifact = confidentialArtifact(name);
    const hash = await wallet.deployContract({
      abi: artifact.abi as never,
      bytecode: artifact.bytecode,
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

    // Record BEFORE anything else can fail. Delta T-14.
    raw[name] = {
      address,
      tx: hash,
      block: receipt.blockNumber.toString(),
      gas: receipt.gasUsed.toString(),
    };
    mkdirSync(repoPath(`deployments/${environment}`), { recursive: true });
    writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`);

    const code = await publicClient.getCode({ address });
    if (code === undefined || code === "0x") throw new Error(`${name} at ${address} has no code`);
    contracts[name] = {
      address,
      deploymentTx: hash,
      block: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      constructorArgs: args.map((a) => String(a)),
      runtimeHash: keccak256(code),
      runtimeSize: (code.length - 2) / 2,
      layer: "confidential",
      compiler: CONFIDENTIAL_COMPILER,
      explorerUrl: explorer === null ? null : `${explorer}/address/${address}#code`,
    };
    console.log(`  ${name.padEnd(20)} ${address}  ${receipt.gasUsed} gas`);
    return address;
  }

  const at = (record: SeriesRecord, name: string): Address => {
    const entry = record.contracts[name];
    if (entry === undefined) throw new Error(`the series record names no ${name}`);
    return entry.address;
  };

  console.log("  deploying (solc 0.8.36)\n");

  const capsuleVault = await deploy("KyrveCapsuleVault", [
    primary.seriesId,
    primary.marketId,
    primary.deploymentId,
    at(primary, "KyrveSeriesToken"),
    at(primary, "SeriesOwnershipRegistry"),
    at(primary, "AggregateSolvencyVerifier"),
    at(primary, "SeriesResidueAccount"),
    primary.seriesVault,
    roles.accounts.curator.address,
  ]);

  const crossBook = await deploy("KyrveCrossBook", [
    primary.seriesId,
    primary.deploymentId,
    at(primary, "KyrveSeriesToken"),
    at(primary, "KyrveWrappedAsset"),
    CROSS_PRICE_WAD,
    CROSS_FEE_BPS,
    roles.accounts.residueBeneficiary.address,
    roles.accounts.keeper.address,
    primary.reused["KyrveEmergencyController"],
  ]);

  let rollBook: Address | null = null;
  if (target !== null) {
    rollBook = await deploy("KyrveRollBook", [
      at(primary, "KyrveSeriesToken"),
      at(target, "KyrveSeriesToken"),
      ROLL_TARGET_PRICE_WAD,
      primary.deploymentId,
      roles.accounts.keeper.address,
      primary.reused["KyrveEmergencyController"],
    ]);
  }

  // ── The one-shot binding ───────────────────────────────────────────────────────────────────
  //
  // The capsule vault is NOT a reviewed transient recipient and does not need to be: the only grant
  // a capsule makes is made by the token itself, on a handle the holder asked it to freeze. What
  // this binding does is tell the token which vault may record a capsule.
  console.log("\n  one-shot binding (irreversible)");
  const tokenAbi = confidentialArtifact("KyrveSeriesToken").abi;
  const boundVault = (await publicClient.readContract({
    address: at(primary, "KyrveSeriesToken"),
    abi: tokenAbi as never,
    functionName: "capsuleVault",
  })) as Address;

  if (boundVault.toLowerCase() === capsuleVault.toLowerCase()) {
    console.log(`  KyrveSeriesToken.bindCapsuleVault  already bound, skipped`);
  } else if (boundVault !== "0x0000000000000000000000000000000000000000") {
    throw new Error(
      `KyrveSeriesToken.capsuleVault is already ${boundVault}, not ${capsuleVault}. The binding is ` +
        "one-shot and cannot be moved; a new capsule vault needs a new series token.",
    );
  } else {
    const hash = await wallet.writeContract({
      address: at(primary, "KyrveSeriesToken"),
      abi: tokenAbi as never,
      functionName: "bindCapsuleVault" as never,
      args: [capsuleVault] as never,
      account,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("bindCapsuleVault reverted");
    gasUsed += receipt.gasUsed;
    console.log(`  KyrveSeriesToken.bindCapsuleVault  ${receipt.gasUsed} gas`);
  }

  // ── Read every wiring back from chain state, never from the arguments we sent ───────────────
  const wiringVerified: string[] = [];
  const readAddress = async (address: Address, abi: readonly unknown[], getter: string) =>
    (await publicClient.readContract({
      address,
      abi: abi as never,
      functionName: getter as never,
    })) as Address;
  const readBytes32 = async (address: Address, abi: readonly unknown[], getter: string) =>
    (await publicClient.readContract({
      address,
      abi: abi as never,
      functionName: getter as never,
    })) as Hex;

  const capsuleAbi = confidentialArtifact("KyrveCapsuleVault").abi;
  const crossAbi = confidentialArtifact("KyrveCrossBook").abi;

  const checks: { label: string; actual: string; expected: string }[] = [
    {
      label: "KyrveSeriesToken.capsuleVault",
      actual: await readAddress(at(primary, "KyrveSeriesToken"), tokenAbi, "capsuleVault"),
      expected: capsuleVault,
    },
    {
      label: "KyrveCapsuleVault.SERIES_ID",
      actual: await readBytes32(capsuleVault, capsuleAbi, "SERIES_ID"),
      expected: primary.seriesId,
    },
    {
      label: "KyrveCapsuleVault.DEPLOYMENT_ID",
      actual: await readBytes32(capsuleVault, capsuleAbi, "DEPLOYMENT_ID"),
      expected: primary.deploymentId,
    },
    {
      label: "KyrveCapsuleVault.CURATOR",
      actual: await readAddress(capsuleVault, capsuleAbi, "CURATOR"),
      expected: roles.accounts.curator.address,
    },
    {
      label: "KyrveCrossBook.SERIES_ID",
      actual: await readBytes32(crossBook, crossAbi, "SERIES_ID"),
      expected: primary.seriesId,
    },
    {
      label: "KyrveCrossBook.KEEPER",
      actual: await readAddress(crossBook, crossAbi, "KEEPER"),
      expected: roles.accounts.keeper.address,
    },
    {
      label: "KyrveCrossBook.FEE_BENEFICIARY",
      actual: await readAddress(crossBook, crossAbi, "FEE_BENEFICIARY"),
      expected: roles.accounts.residueBeneficiary.address,
    },
    {
      label: "KyrveCrossBook.LOAN_TOKEN",
      actual: await readAddress(crossBook, crossAbi, "LOAN_TOKEN"),
      expected: primary.loanToken,
    },
  ];

  if (rollBook !== null && target !== null) {
    const rollAbi = confidentialArtifact("KyrveRollBook").abi;
    checks.push(
      {
        label: "KyrveRollBook.SOURCE_TOKEN",
        actual: await readAddress(rollBook, rollAbi, "SOURCE_TOKEN"),
        expected: at(primary, "KyrveSeriesToken"),
      },
      {
        label: "KyrveRollBook.TARGET_TOKEN",
        actual: await readAddress(rollBook, rollAbi, "TARGET_TOKEN"),
        expected: at(target, "KyrveSeriesToken"),
      },
      {
        label: "KyrveRollBook.KEEPER",
        actual: await readAddress(rollBook, rollAbi, "KEEPER"),
        expected: roles.accounts.keeper.address,
      },
    );
  }

  for (const check of checks) {
    if (check.actual.toLowerCase() !== check.expected.toLowerCase()) {
      throw new Error(`${check.label} is ${check.actual}, expected ${check.expected}`);
    }
    wiringVerified.push(`${check.label} -> ${check.expected}`);
  }
  console.log(`\n  ${wiringVerified.length}/${checks.length} wiring checks PASS`);

  const block = await publicClient.getBlockNumber();
  const timestamp = (await publicClient.getBlock({ blockNumber: block })).timestamp;
  const balanceAfter = await publicClient.getBalance({ address: account.address });

  const deployment: MarketDeployment = {
    environment,
    chainId,
    deployer: account.address,
    deployedAt: new Date(Number(timestamp) * 1000).toISOString(),
    deploymentBlock: block.toString(),
    seriesId: primary.seriesId,
    deploymentId: primary.deploymentId,
    targetSeriesId: target === null ? null : target.seriesId,
    crossPriceWad: CROSS_PRICE_WAD.toString(),
    crossFeeBps: CROSS_FEE_BPS,
    crossFeeBeneficiary: roles.accounts.residueBeneficiary.address,
    rollTargetPriceWad: ROLL_TARGET_PRICE_WAD.toString(),
    compiler: CONFIDENTIAL_COMPILER,
    contracts,
    wiringVerified,
    gasUsed: gasUsed.toString(),
    ethSpent: formatEther(balanceBefore - balanceAfter),
    scopeNote:
      rollBook === null
        ? "No roll book. `series-b.json` does not exist, so no second series is deployed and no " +
          "roll is claimed. This is a complete Capsule and Cross deployment, not a partial Roll one."
        : "A roll book over TWO real series, each with its own custody vault, engine, epoch " +
          "controller, graph registry, ledger and settlement layer (delta U-1). This proves the " +
          "mechanism at the smallest coherent public scale and makes no throughput claim.",
  };

  const payload = `${stableStringify(deployment)}\n`;
  assertNoSecrets(payload, `deployments/${environment}/market.json`);
  mkdirSync(repoPath(`deployments/${environment}`), { recursive: true });
  writeFileSync(repoPath(`deployments/${environment}/market.json`), payload);

  console.log(`\n  gas this run ${gasUsed}`);
  console.log(`  eth spent    ${deployment.ethSpent}`);
  console.log(`  recorded in  deployments/${environment}/market.json\n`);
  return deployment;
}

const environment: Environment = process.argv[2] === "sepolia" ? "sepolia" : "local";
deployMarket(environment).catch((error: unknown) => {
  console.error(
    `\ndeploy:market FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
