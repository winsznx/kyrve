/**
 * One real confidential series allocation on Ethereum Sepolia, against a position real Midnight
 * settled.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS PROVES THAT THE LOCAL SUITE CANNOT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `confidential/test/100-series-ownership.ts` proves the whole lifecycle against the real Nox stack and
 * real unmodified Midnight, on one chain. What it cannot prove is that the same code path works against
 * the HOSTED gateway, at public-network latency, with a keeper that is a real signing key and a credit
 * position that a real borrower's `take` created minutes earlier.
 *
 * So this runs only the allocation half, and only against state that already exists:
 *
 *   1. the locks two providers' reservations opened, consumed and unwrapped by the settlement run
 *   2. the exact fill that settled through unmodified Midnight
 *   3. -> claims minted from the exact handles those locks became
 *   4. -> each provider decrypts their OWN balance, with their own wallet, through the real gateway
 *   5. -> another provider is refused
 *   6. -> total supply published and read back
 *   7. -> the vault's public Midnight credit
 *   8. -> the solvency verdict published and read back
 *   9. -> a duplicate allocation refused
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE THREE NUMBERS THAT MUST NOT COINCIDE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Measured on this deployment, and asserted rather than reported:
 *
 *   published aggregate  299,999,999   what providers reserved, and what supply MUST equal
 *   Midnight units       300,000,599   the credit the vault holds. Never a mint quantity
 *   buyer assets         299,999,998   what the borrower received. Never a mint quantity
 *
 * Delta T-1: PRD §19.3 reads "sum encrypted series allocations = exact Midnight units received", and
 * taken literally that over-issues by 600 on this exact fixture. Supply is the aggregate; the
 * unit-to-asset conversion is a PUBLIC redemption factor derived on chain from two public numbers.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * RESUMABLE, BECAUSE EVERY STEP IS A REAL BROADCAST
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Each step reads chain state first and skips what has already happened. `allocateChunk` is one-shot per
 * `(quote, provider)`, `closeQuote` one-shot per quote, `publishAggregateSupply` once per token forever —
 * so a re-run must adopt what exists rather than attempt a second call the contract would refuse. Delta
 * T-13 is the same lesson one layer down.
 *
 * No decrypted value reaches this script's output, its evidence file or any log. The per-provider
 * balances are compared against the plaintext reference model IN MEMORY and only the verdict is printed.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { NOX_COMPUTE_BY_CHAIN, NOX_GATEWAY_BY_CHAIN } from "@kyrve/config";
import { createHandleClient, type Handle } from "@kyrve/nox";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  type Hex,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import {
  assertBroadcastArmed,
  assertNoSecrets,
  deployer,
  safeErrorMessage,
  sepoliaRpc,
} from "../lib/env.js";
import { layerPaths, requireLayerFile } from "../lib/layer.js";
import { resolveRoles, signingKey } from "../lib/roles.js";
import { readJson, repoPath, stableStringify } from "../lib/shell.js";

const CHAIN_ID = 11_155_111;
const EXPLORER = "https://sepolia.etherscan.io";
const ZERO32 = `0x${"00".repeat(32)}` as Hex;
/** Ten minutes with backoff. Testnet Nox latency is UNVERIFIED (AS-1). */
const POLL = {
  policy: { initialDelayMs: 2_000, maxDelayMs: 20_000, multiplier: 2, timeoutMs: 600_000 },
} as const;

function abiOf(name: string): readonly unknown[] {
  const path = repoPath(`confidential/artifacts/contracts/${name}.sol/${name}.json`);
  if (!existsSync(path)) {
    throw new Error(`no artifact at ${path}; run \`pnpm --dir confidential exec hardhat compile\``);
  }
  return readJson<{ abi: readonly unknown[] }>(path).abi;
}

function foundryAbiOf(name: string): readonly unknown[] {
  const path = repoPath(`out/${name}.sol/${name}.json`);
  if (!existsSync(path)) throw new Error(`no artifact at ${path}; run \`forge build\``);
  return readJson<{ abi: readonly unknown[] }>(path).abi;
}

interface SeriesDeployment {
  readonly chainId: number;
  readonly loanToken: Address;
  readonly marketId: Hex;
  readonly seriesId: Hex;
  readonly seriesVault: Address;
  readonly reused: Record<string, Address>;
  readonly contracts: Record<string, { address: Address }>;
}

async function main(): Promise<void> {
  /**
   * Layer-scoped, and it will NOT fall back. A layer B allocation that read layer A's settlement
   * record would mint against a position layer B never took, and every later check would pass on
   * evidence from the wrong stack.
   */
  const layer = layerPaths();
  const deploymentPath = repoPath(layer.deployment);
  const settlementPath = repoPath(layer.settlement);
  const epochPath = repoPath(layer.epoch);

  for (const [what, path] of [
    ["the Phase 5 deployment", deploymentPath],
    ["the settled Sepolia quote", settlementPath],
    ["the Sepolia epoch", epochPath],
  ] as const) {
    if (!existsSync(path)) {
      throw new Error(
        `no record of ${what} at ${path}. This script allocates against a position that already ` +
          "settled rather than paying for another epoch.",
      );
    }
  }

  const deployment = readJson<SeriesDeployment>(deploymentPath);
  const settled = readJson<{
    quoteId: Hex;
    epochId: Hex;
    settled: boolean;
    exactUnits: string;
    expectedBuyerAssets: string;
    aggregateFillAmount: string;
    creditCreatedByThisFill: string;
  }>(settlementPath);
  const epoch = readJson<{ epochId: Hex; universeId: Hex }>(epochPath);

  if (!settled.settled) {
    throw new Error("the recorded Sepolia quote did not settle, so there is no credit to own");
  }
  if (settled.epochId.toLowerCase() !== epoch.epochId.toLowerCase()) {
    throw new Error(
      `the settlement record names epoch ${settled.epochId} and the epoch record names ` +
        `${epoch.epochId}. One of them is from a different run.`,
    );
  }

  const rpc = sepoliaRpc();
  if (rpc.isPublicEndpoint) {
    throw new Error("refusing to allocate through a keyless public RPC");
  }
  assertBroadcastArmed();

  /**
   * THE KEEPER IS ITS OWN KEY FROM PHASE 6, AND THE CURATOR IS ANOTHER.
   *
   * This script called the deployer "keeper" because through Phase 5 they were the same address.
   * `allocateChunk`, `closeQuote` and `proveSolvency` belong to the keeper; `publishAggregateSupply`
   * is `onlyCurator` and IRREVERSIBLE. Sending either from the wrong key now reverts, which is the
   * separation working — but it reverts after the run has already paid for everything before it.
   */
  const phase6Roles = resolveRoles("sepolia", { requireKeys: ["keeper", "curator"] });
  const keeper = privateKeyToAccount(signingKey(phase6Roles, "keeper"));
  const curator = privateKeyToAccount(signingKey(phase6Roles, "curator"));
  const transport = http(rpc.url);
  const publicClient = createPublicClient({ chain: sepolia, transport, cacheTime: 0 });
  const wallet = createWalletClient({ account: keeper, chain: sepolia, transport });
  const curatorWallet = createWalletClient({ account: curator, chain: sepolia, transport });

  const observed = await publicClient.getChainId();
  if (observed !== CHAIN_ID)
    throw new Error(`connected chain is ${observed}, expected ${CHAIN_ID}`);

  const at = (name: string): Address => {
    const entry = deployment.contracts[name];
    if (entry === undefined) throw new Error(`the deployment record does not name ${name}`);
    return entry.address;
  };
  const allocator = at("SeriesAllocator");
  const token = at("KyrveSeriesToken");
  const ownership = at("SeriesOwnershipRegistry");
  const solvency = at("AggregateSolvencyVerifier");
  const residue = at("SeriesResidueAccount");
  const epochs = at("QuoteEpochController");

  const network = {
    chainId: CHAIN_ID,
    name: "ethereum-sepolia",
    noxCompute: NOX_COMPUTE_BY_CHAIN[CHAIN_ID] as Address,
    gatewayUrl: NOX_GATEWAY_BY_CHAIN[CHAIN_ID] as string,
  };

  const aggregate = BigInt(settled.aggregateFillAmount);
  const exactUnits = BigInt(settled.exactUnits);
  const buyerAssets = BigInt(settled.expectedBuyerAssets);

  console.log("Kyrve Phase 5 — one real confidential series allocation on Ethereum Sepolia\n");
  console.log(`  RPC        ${rpc.redacted}`);
  console.log(`  gateway    ${network.gatewayUrl}`);
  console.log(`  keeper     ${keeper.address}`);
  console.log(`  quote      ${settled.quoteId}`);
  console.log(`  epoch      ${epoch.epochId}`);
  console.log(`  series     ${deployment.seriesId}`);
  console.log(`  vault      ${deployment.seriesVault}`);
  console.log(
    `  balance    ${formatEther(await publicClient.getBalance({ address: keeper.address }))} ETH\n`,
  );

  const receipts: { step: string; hash: Hex; gasUsed: string }[] = [];
  async function send(step: string, hash: Hex): Promise<void> {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${step} reverted: ${EXPLORER}/tx/${hash}`);
    receipts.push({ step, hash, gasUsed: receipt.gasUsed.toString() });
    console.log(`    ${step.padEnd(24)} ${receipt.gasUsed} gas  ${EXPLORER}/tx/${hash}`);
  }

  // ── The providers, from the epoch the locks belong to ──────────────────────────────────────
  const providerCount = (
    (await publicClient.readContract({
      address: epochs,
      abi: abiOf("QuoteEpochController") as never,
      functionName: "epochOf",
      args: [epoch.epochId],
    })) as { providerCount: number }
  ).providerCount;

  const providers: Address[] = [];
  for (let slot = 0; slot < providerCount; slot += 1) {
    const sealed = (await publicClient.readContract({
      address: epochs,
      abi: abiOf("QuoteEpochController") as never,
      functionName: "providerAt",
      args: [epoch.epochId, BigInt(slot)],
    })) as { provider: Address };
    providers.push(sealed.provider);
  }
  console.log(`  ${providerCount} providers sealed into this epoch`);

  // ── 1. Mint the claims ────────────────────────────────────────────────────────────────────
  const bindingBefore = (await publicClient.readContract({
    address: ownership,
    abi: abiOf("SeriesOwnershipRegistry") as never,
    functionName: "bindingOf",
    args: [settled.quoteId],
  })) as { bound: boolean; closed: boolean; allocatedCount: number };

  console.log("\n  allocating:");
  if (Number(bindingBefore.allocatedCount) < providerCount) {
    await send(
      "allocateChunk",
      await wallet.writeContract({
        address: allocator,
        abi: abiOf("SeriesAllocator") as never,
        functionName: "allocateChunk",
        args: [settled.quoteId, 0, providerCount],
        account: keeper,
        chain: sepolia,
      }),
    );
  } else {
    console.log(
      `    allocateChunk            already minted ${bindingBefore.allocatedCount} claims`,
    );
  }

  // ── 2. Seal it, and account the residue ───────────────────────────────────────────────────
  if (!bindingBefore.closed) {
    await send(
      "closeQuote",
      await wallet.writeContract({
        address: allocator,
        abi: abiOf("SeriesAllocator") as never,
        functionName: "closeQuote",
        args: [settled.quoteId],
        account: keeper,
        chain: sepolia,
      }),
    );
  } else {
    console.log("    closeQuote               already closed");
  }

  const binding = (await publicClient.readContract({
    address: ownership,
    abi: abiOf("SeriesOwnershipRegistry") as never,
    functionName: "bindingOf",
    args: [settled.quoteId],
  })) as {
    bound: boolean;
    closed: boolean;
    epochId: Hex;
    graphRoot: Hex;
    aggregateFillAmount: bigint;
    allocatedCount: number;
  };

  if (!binding.bound || !binding.closed) throw new Error("the allocation did not bind and close");
  if (Number(binding.allocatedCount) !== providerCount) {
    throw new Error(`${binding.allocatedCount} claims recorded for ${providerCount} providers`);
  }
  if (binding.epochId.toLowerCase() !== epoch.epochId.toLowerCase()) {
    throw new Error(`the ownership row names epoch ${binding.epochId}`);
  }
  if (binding.aggregateFillAmount !== aggregate) {
    throw new Error(`the ownership row names aggregate ${binding.aggregateFillAmount}`);
  }

  const recordedResidue = (await publicClient.readContract({
    address: residue,
    abi: abiOf("SeriesResidueAccount") as never,
    functionName: "recordedResidue",
    args: [settled.quoteId],
  })) as bigint;
  if (recordedResidue !== aggregate - buyerAssets) {
    throw new Error(
      `the recorded funding residue is ${recordedResidue}, expected ${aggregate - buyerAssets}`,
    );
  }

  // ── 3. Each provider decrypts their OWN balance, with their own wallet ─────────────────────
  //
  // The plaintext never leaves memory. Each is compared against the ledger's reserved handle — the
  // capital that actually funded the claim — and only the verdict is printed. Two independent routes to
  // the same number: one through the series token, one through custody.
  console.log("\n  per-provider decryption (through the hosted gateway):");
  const ledger = at("ReservationLedger");
  const perProvider: { provider: Address; matchesReservation: boolean; refusedToPeer: boolean }[] =
    [];

  for (const [index, provider] of providers.entries()) {
    const raw = (process.env[`DUST_PRIVATE_KEY_${index + 1}`] ?? "").trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
      throw new Error(
        `DUST_PRIVATE_KEY_${index + 1} is missing or malformed, so provider ${provider} cannot ` +
          "decrypt their own balance. Only the owner can: the gateway checks authorisation on chain.",
      );
    }
    const account = privateKeyToAccount(raw as Hex);
    if (account.address.toLowerCase() !== provider.toLowerCase()) {
      throw new Error(
        `DUST_PRIVATE_KEY_${index + 1} is ${account.address} but epoch slot ${index} is ${provider}`,
      );
    }
    const providerWallet = createWalletClient({ account, chain: sepolia, transport });
    const client = await createHandleClient(providerWallet, network);

    const balanceHandle = (await publicClient.readContract({
      address: token,
      abi: abiOf("KyrveSeriesToken") as never,
      functionName: "confidentialBalanceOf",
      args: [provider],
    })) as Handle;
    if (balanceHandle === ZERO32) throw new Error(`${provider} holds no series balance handle`);

    const reservedHandle = (await publicClient.readContract({
      address: ledger,
      abi: abiOf("ReservationLedger") as never,
      functionName: "confidentialReservedOf",
      args: [epoch.epochId, provider],
    })) as Handle;

    const balance = await client.decrypt(balanceHandle, POLL);
    const reserved = await client.decrypt(reservedHandle, POLL);
    const matches = balance === reserved;
    if (!matches) {
      throw new Error(
        `provider ${provider}'s series balance does not equal the capital that funded it. The two ` +
          "figures are deliberately not printed.",
      );
    }

    // Another provider must be refused. Aimed at a PEER rather than a stranger: two providers'
    // balances are the equal-shaped quantities that would alias into one handle without isolation.
    const peer = providers[(index + 1) % providers.length];
    let refused = false;
    if (peer !== undefined && peer.toLowerCase() !== provider.toLowerCase()) {
      const peerHandle = (await publicClient.readContract({
        address: token,
        abi: abiOf("KyrveSeriesToken") as never,
        functionName: "confidentialBalanceOf",
        args: [peer],
      })) as Handle;
      try {
        await client.decrypt(peerHandle, {
          policy: { initialDelayMs: 1_000, maxDelayMs: 4_000, multiplier: 2, timeoutMs: 30_000 },
        });
      } catch (error) {
        const message = safeErrorMessage(error);
        refused = /holds no grant|not authoris|not authoriz|forbidden|unauthor/i.test(message);
        if (!refused) throw error;
      }
      if (!refused) {
        throw new Error(
          `${provider} decrypted ${peer}'s series balance. That is a confidentiality failure, not a ` +
            "test problem.",
        );
      }
    }

    perProvider.push({ provider, matchesReservation: matches, refusedToPeer: refused });
    console.log(
      `    ${provider}  own balance == its reservation, peer refused: ${refused ? "yes" : "n/a"}`,
    );
  }

  // ── 4. Total supply, published once and read back ──────────────────────────────────────────
  console.log("\n  aggregate supply:");
  let supplyHandle = (await publicClient.readContract({
    address: token,
    abi: abiOf("KyrveSeriesToken") as never,
    functionName: "publishedSupply",
  })) as Handle;

  if (supplyHandle === ZERO32) {
    // IRREVERSIBLE, and callable once per token forever. What becomes public is a number the curve
    // already published as this epoch's aggregate, so it discloses nothing new.
    await send(
      "publishAggregateSupply",
      await curatorWallet.writeContract({
        address: token,
        abi: abiOf("KyrveSeriesToken") as never,
        functionName: "publishAggregateSupply",
        account: curator,
        chain: sepolia,
      }),
    );
    supplyHandle = (await publicClient.readContract({
      address: token,
      abi: abiOf("KyrveSeriesToken") as never,
      functionName: "publishedSupply",
    })) as Handle;
  } else {
    console.log("    publishAggregateSupply   already published (irreversible, once per token)");
  }

  const keeperClient = await createHandleClient(wallet, network);
  const supply = await keeperClient.publicDecrypt(supplyHandle, POLL);

  // INVARIANT 1, and the negative half of invariants 2 and 3 on the same line.
  if (supply.value !== aggregate) {
    throw new Error(
      `total confidential supply is ${supply.value}, the published aggregate is ${aggregate}`,
    );
  }
  if (supply.value === exactUnits) throw new Error("supply must not equal the Midnight units");
  if (supply.value === buyerAssets) throw new Error("supply must not equal the borrower's assets");
  console.log(`    total supply             ${supply.value} == published aggregate`);
  console.log(`    Midnight units           ${exactUnits} (never a mint quantity)`);
  console.log(`    buyer assets             ${buyerAssets} (never a mint quantity)`);

  // ── 5. The public Midnight credit the claims are on ────────────────────────────────────────
  const position = (await publicClient.readContract({
    address: deployment.seriesVault,
    abi: foundryAbiOf("KyrveSeriesVault") as never,
    functionName: "positionOf",
    args: [deployment.marketId],
  })) as readonly [bigint, bigint, bigint];
  if (position[0] < exactUnits) {
    throw new Error(
      `the vault holds ${position[0]} units of credit, expected at least ${exactUnits}`,
    );
  }
  console.log(`\n  public Midnight credit     ${position[0]} units held by the vault`);

  // ── 6. Solvency, proven on chain and read back ────────────────────────────────────────────
  console.log("\n  solvency:");
  await send(
    "proveSolvency",
    await wallet.writeContract({
      address: solvency,
      abi: abiOf("AggregateSolvencyVerifier") as never,
      functionName: "proveSolvency",
      account: keeper,
      chain: sepolia,
    }),
  );

  const snapshot = (await publicClient.readContract({
    address: solvency,
    abi: abiOf("AggregateSolvencyVerifier") as never,
    functionName: "latestSnapshot",
  })) as {
    blockNumber: bigint;
    credit: bigint;
    pendingFee: bigint;
    publicCoverage: bigint;
    verdictHandle: Hex;
  };
  const verdict = await keeperClient.publicDecrypt(snapshot.verdictHandle as Handle, POLL);
  const solvent = verdict.value === 1n;
  if (!solvent) throw new Error("the published solvency verdict is FALSE");
  if (snapshot.publicCoverage < aggregate) {
    throw new Error(
      `public coverage is ${snapshot.publicCoverage} and confidential claims are ${aggregate}`,
    );
  }
  console.log(`    verdict                  solvent (published, one bit)`);
  console.log(`    public coverage          ${snapshot.publicCoverage} >= ${aggregate} claims`);
  console.log(`    snapshot block           ${snapshot.blockNumber}`);

  // ── 7. A duplicate allocation must be refused ─────────────────────────────────────────────
  //
  // Attacked against state that WOULD otherwise succeed: this is the quote that just allocated, in the
  // registry that just recorded it. Attacking a nonexistent quote would pass for the wrong reason.
  console.log("\n  duplicate allocation (must be refused):");
  let duplicateRefused = false;
  let duplicateDetail = "";
  try {
    await publicClient.simulateContract({
      address: allocator,
      abi: abiOf("SeriesAllocator") as never,
      functionName: "allocateChunk",
      args: [settled.quoteId, 0, providerCount],
      account: keeper,
    });
  } catch (error) {
    duplicateRefused = true;
    duplicateDetail = safeErrorMessage(error).split("\n").slice(0, 2).join(" ").trim();
  }
  if (!duplicateRefused) {
    throw new Error("a second allocation of the same quote was NOT refused");
  }
  console.log(`    refused: ${duplicateDetail.slice(0, 140)}`);

  // ── Record ────────────────────────────────────────────────────────────────────────────────
  const evidence = {
    $comment:
      "One real confidential series allocation on Ethereum Sepolia, against credit a real Midnight " +
      "`take` created. NO DECRYPTED VALUE APPEARS HERE. Each provider's balance was decrypted by " +
      "their own wallet through the hosted gateway, compared in memory against the capital that " +
      "funded it, and only the verdict is recorded. The supply below is public: the curve published " +
      "the same number as this epoch's aggregate before any claim existed.",
    chainId: CHAIN_ID,
    explorer: EXPLORER,
    quoteId: settled.quoteId,
    epochId: epoch.epochId,
    universeId: epoch.universeId,
    seriesId: deployment.seriesId,
    seriesVault: deployment.seriesVault,
    graphRoot: binding.graphRoot,
    allocated: true,
    providerCount,
    allocatedCount: Number(binding.allocatedCount),
    closed: binding.closed,
    aggregate: aggregate.toString(),
    supply: supply.value.toString(),
    exactUnits: exactUnits.toString(),
    buyerAssets: buyerAssets.toString(),
    creditUnits: position[0].toString(),
    residue: recordedResidue.toString(),
    supplyEqualsAggregate: supply.value === aggregate,
    supplyIsNotUnits: supply.value !== exactUnits,
    supplyIsNotBuyerAssets: supply.value !== buyerAssets,
    everyProviderMatchedTheirReservation: perProvider.every((entry) => entry.matchesReservation),
    everyPeerRefused: perProvider.every((entry) => entry.refusedToPeer),
    providers: perProvider.map((entry) => ({
      provider: entry.provider,
      ownBalanceMatchesReservation: entry.matchesReservation,
      peerDecryptionRefused: entry.refusedToPeer,
    })),
    solvent,
    publicCoverage: snapshot.publicCoverage.toString(),
    solvencySnapshotBlock: snapshot.blockNumber.toString(),
    duplicateAllocationRefused: duplicateRefused,
    duplicateAllocationRefusal: duplicateDetail.slice(0, 200),
    transactions: receipts,
    measuredAt: new Date().toISOString(),
  };

  const payload = `${stableStringify(evidence)}\n`;
  assertNoSecrets(payload, layer.allocation);
  mkdirSync(repoPath(layer.allocation.replace(/\/[^/]+$/, "")), { recursive: true });
  writeFileSync(repoPath(layer.allocation), payload);

  const spent = receipts.reduce((sum, entry) => sum + BigInt(entry.gasUsed), 0n);
  console.log(`\n  ${spent} gas across ${receipts.length} transaction(s)`);
  console.log(
    `  balance    ${formatEther(await publicClient.getBalance({ address: keeper.address }))} ETH`,
  );
  console.log(`  recorded in ${layer.allocation}\n`);
}

main().catch((error: unknown) => {
  console.error(`\nsepolia series allocation FAILED: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
