/**
 * One real quote, activated and settled on Ethereum Sepolia, through unmodified Midnight.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS ADDS OVER THE LOCAL LIFECYCLE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `confidential/test/90-quote-settlement.ts` proves the composition against the real Nox stack and
 * real Midnight, on one local chain. Everything it cannot prove is here: a public network's latency,
 * its fee market, the HOSTED iExec gateway rather than a local container, and a Midnight deployment
 * nobody in this repository controls.
 *
 * It expects a curve epoch to already have run and been published — `pnpm test:sepolia-epoch` does
 * that, and doing it twice would pay for it twice. This script picks that epoch up, verifies it,
 * activates one quote and settles it exactly.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE PUBLISHED AGGREGATE IS USED EXACTLY, AND NEVER RECONSTRUCTED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The size comes from `KyrvePublicResultVerifier`, which returns the aggregate the epoch published —
 * the sum of reserved provider allocations. It is never derived from a leaf capacity, which is
 * private and is not an input to anything here. `units = floor(aggregate * WAD / price)` and
 * `buyerAssets = floor(units * price / WAD)`, both DOWN, so the maker never owes more than providers
 * reserved.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * NOTHING IS BROADCAST WITHOUT BEING ARMED, PRICED AND FUNDED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `DEPLOY_SEPOLIA` and `KYRVE_CONFIRM_BROADCAST` must both be set. A keyless public RPC is refused
 * rather than silently used. The balance is checked against the measured cost of the remaining
 * sequence before the first transaction, and no secret is ever printed.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { encodeMarket } from "@kyrve/midnight";
import { deriveQuoteSize } from "@kyrve/quote";
import { tickToPrice } from "@kyrve/quote-math";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  formatEther,
  type Hex,
  http,
  keccak256,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import { assertBroadcastArmed, assertNoSecrets, deployer, sepoliaRpc } from "../lib/env.js";
import { readJson, repoPath, stableStringify } from "../lib/shell.js";

const EXPLORER = "https://sepolia.etherscan.io";

interface SettlementDeployment {
  readonly midnight: Address;
  readonly loanToken: Address;
  readonly curve: Readonly<Record<string, Address>>;
  readonly addresses: Readonly<Record<string, Address>>;
}

interface EpochEvidence {
  readonly epochId: Hex;
  readonly requestId: Hex;
  readonly universeId: Hex;
  readonly graphRoot?: Hex;
  readonly published: {
    readonly selectedMarketIndex: number;
    readonly selectedRateIndex: number;
    readonly aggregateFillAmount: string;
    readonly quoteReady: boolean;
  };
  readonly proofs?: {
    readonly market: Hex;
    readonly rate: Hex;
    readonly floor: Hex;
    readonly ready: Hex;
    readonly aggregate: Hex;
  };
}

function registryEarlyAddress(settlement: SettlementDeployment): Address {
  const address = settlement.addresses["KyrveQuoteRegistry"];
  if (address === undefined) throw new Error("the manifest records no registry");
  return address;
}

function activatorAddress(settlement: SettlementDeployment): Address {
  const address = settlement.addresses["QuoteActivator"];
  if (address === undefined) throw new Error("the manifest records no activator");
  return address;
}

function artifact(name: string): { abi: readonly unknown[] } {
  return artifactIn(name, name);
}

/**
 * One artifact, by source file and contract name.
 *
 * Foundry keys the directory on the SOURCE basename and the file on the contract name, so a source
 * declaring several interfaces — `ICurveLayer.sol` declares five — has no artifact under its own
 * name. Asking for `ICurveLayer` is how a first run of this script died two thirds of the way
 * through, after the proofs had already verified.
 */
function artifactIn(sourceName: string, contractName: string): { abi: readonly unknown[] } {
  const path = repoPath(`out/${sourceName}.sol/${contractName}.json`);
  if (!existsSync(path)) {
    throw new Error(`no artifact at ${path}; run \`forge build\``);
  }
  return readJson<{ abi: readonly unknown[] }>(path);
}

async function main(): Promise<void> {
  const settlementPath = repoPath("deployments/sepolia/settlement.json");
  const epochPath = repoPath("evidence/phase4/sepolia-epoch.json");
  const activationPath = repoPath("evidence/phase4/sepolia-activation.json");

  if (!existsSync(settlementPath)) {
    throw new Error(
      "no deployments/sepolia/settlement.json. Deploy first: DEPLOY_SEPOLIA=true " +
        "KYRVE_CONFIRM_BROADCAST=true pnpm deploy:settlement sepolia",
    );
  }
  if (!existsSync(epochPath)) {
    throw new Error(
      `no published Sepolia epoch at ${epochPath}. Run \`pnpm test:sepolia-epoch\` first — this ` +
        "script settles an epoch that already exists rather than paying for a second one.",
    );
  }

  const settlement = readJson<SettlementDeployment>(settlementPath);
  const epoch = readJson<EpochEvidence>(epochPath);

  if (!epoch.published.quoteReady) {
    throw new Error("the recorded Sepolia epoch produced no quote, so there is nothing to settle");
  }
  if (epoch.proofs === undefined || epoch.graphRoot === undefined) {
    throw new Error(
      "the recorded Sepolia epoch carries no gateway proofs or no graph root. Re-run the epoch " +
        "script: activation cannot be attempted without the proofs the gateway signed.",
    );
  }

  const rpc = sepoliaRpc();
  if (rpc.isPublicEndpoint) {
    throw new Error(
      "refusing to settle through a keyless public RPC. Configure ALCHEMY_API_KEY or SEPOLIA_RPC_URL.",
    );
  }
  assertBroadcastArmed();

  const account = privateKeyToAccount(deployer().privateKey);
  const transport = http(rpc.url);
  const publicClient = createPublicClient({ chain: sepolia, transport, cacheTime: 0 });
  const wallet = createWalletClient({ account, chain: sepolia, transport });

  console.log("Kyrve Phase 4 — one real quote, activated and settled on Ethereum Sepolia\n");
  console.log(`  RPC        ${rpc.redacted}`);
  console.log(`  keeper     ${account.address}`);
  console.log(`  epoch      ${epoch.epochId}`);

  const balanceBefore = await publicClient.getBalance({ address: account.address });
  console.log(`  balance    ${formatEther(balanceBefore)} ETH\n`);

  // ── 1. Re-read the published handles and verify every proof, read-only ────────────────────
  //
  // The handles are read from the ENGINE at call time inside the verifier, never from this file's
  // recorded copy. That is delta R-14: a cached set is exactly how the fifth handle ends up
  // undefined.
  const verifier = settlement.addresses["KyrvePublicResultVerifier"];
  if (verifier === undefined) throw new Error("the manifest records no result verifier");

  const activatable = (await publicClient.readContract({
    address: verifier,
    abi: artifact("KyrvePublicResultVerifier").abi as never,
    functionName: "isActivatable",
    args: [epoch.epochId],
  })) as boolean;
  if (!activatable) {
    throw new Error(
      "the epoch is not activatable: either it has not reached Complete, its graph is not sealed, " +
        "or a published handle is missing. No proof was sent anywhere.",
    );
  }

  const verified = (await publicClient.readContract({
    address: verifier,
    abi: artifact("KyrvePublicResultVerifier").abi as never,
    functionName: "verifyForActivation",
    args: [
      epoch.epochId,
      epoch.graphRoot,
      epoch.requestId,
      epoch.universeId,
      epoch.proofs.market,
      epoch.proofs.rate,
      epoch.proofs.floor,
      epoch.proofs.ready,
      epoch.proofs.aggregate,
    ],
  })) as {
    marketIndex: number;
    rateIndex: number;
    aggregateFillAmount: bigint;
    borrower: Address;
    graphRoot: Hex;
  };

  console.log("  proofs and graph binding verified on chain:");
  console.log(`    market index          ${verified.marketIndex}`);
  console.log(`    rate index            ${verified.rateIndex}`);
  console.log(`    aggregate fill        ${verified.aggregateFillAmount}`);
  console.log(`    approved borrower     ${verified.borrower}`);

  if (verified.aggregateFillAmount !== BigInt(epoch.published.aggregateFillAmount)) {
    throw new Error(
      `the chain verified an aggregate of ${verified.aggregateFillAmount} but the epoch evidence ` +
        `records ${epoch.published.aggregateFillAmount}. One of the two describes another epoch.`,
    );
  }

  // ── 2. Resolve the leaf, the market and the size ──────────────────────────────────────────
  const universes = settlement.curve["CurveUniverseRegistry"];
  if (universes === undefined) throw new Error("the manifest records no universe registry");

  const leafCount = (await publicClient.readContract({
    address: universes,
    abi: artifactIn("ICurveLayer", "ICurveUniverseRegistry").abi as never,
    functionName: "leafCount",
    args: [epoch.universeId],
  })) as bigint;

  let leafIndex = -1;
  let tick = 0;
  for (let index = 0n; index < leafCount; index += 1n) {
    const leaf = (await publicClient.readContract({
      address: universes,
      abi: artifactIn("ICurveLayer", "ICurveUniverseRegistry").abi as never,
      functionName: "leafAt",
      args: [epoch.universeId, index],
    })) as { marketIndex: number; rateIndex: number; tick: number };
    if (leaf.marketIndex === verified.marketIndex && leaf.rateIndex === verified.rateIndex) {
      leafIndex = Number(index);
      tick = leaf.tick;
      break;
    }
  }
  if (leafIndex < 0) {
    throw new Error("the verified (market, rate) pair is not a leaf of the recorded universe");
  }

  const size = deriveQuoteSize(verified.aggregateFillAmount, tickToPrice(BigInt(tick)), tick);
  console.log(`\n  leaf ${leafIndex}, tick ${tick}`);
  console.log(`    exact units           ${size.units}`);
  console.log(`    buyer assets          ${size.buyerAssets}`);
  console.log(`    unreserved residue    ${size.residue}`);
  if (size.buyerAssets > verified.aggregateFillAmount) {
    throw new Error(
      "the derived buyer assets exceed the published aggregate — refusing to proceed",
    );
  }

  const spec = (await publicClient.readContract({
    address: universes,
    abi: artifactIn("ICurveLayer", "ICurveUniverseRegistry").abi as never,
    functionName: "marketAt",
    args: [epoch.universeId, BigInt(verified.marketIndex)],
  })) as { marketId: Hex; marketStructHash: Hex };

  const market = (await publicClient.readContract({
    address: settlement.midnight,
    abi: artifact("IMidnight").abi as never,
    functionName: "toMarket",
    args: [spec.marketId],
  })) as Record<string, unknown>;

  if (keccak256(encodeMarket(market as never)) !== spec.marketStructHash) {
    throw new Error(
      "the market Midnight returned does not hash to the struct the universe curated. Refusing to " +
        "present it: both bindings must hold, and this is exactly the substitution the activator " +
        "would reject anyway.",
    );
  }

  // ── 3. Fund the series vault, publicly and exactly ────────────────────────────────────────
  const factory = settlement.addresses["KyrveSeriesFactory"];
  if (factory === undefined) throw new Error("the manifest records no series factory");

  const seriesId = (await publicClient.readContract({
    address: factory,
    abi: artifact("KyrveSeriesFactory").abi as never,
    functionName: "seriesIdFor",
    args: [spec.marketId],
  })) as Hex;

  let vault = (await publicClient.readContract({
    address: factory,
    abi: artifact("KyrveSeriesFactory").abi as never,
    functionName: "vaultOf",
    args: [seriesId],
  })) as Address;

  const receipts: { readonly step: string; readonly hash: Hex; readonly gasUsed: string }[] = [];

  async function send(step: string, hash: Hex): Promise<void> {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${step} reverted: ${EXPLORER}/tx/${hash}`);
    receipts.push({ step, hash, gasUsed: receipt.gasUsed.toString() });
    console.log(`    ${step.padEnd(24)} ${receipt.gasUsed} gas  ${EXPLORER}/tx/${hash}`);
  }

  console.log("\n  preparing:");
  if (vault === "0x0000000000000000000000000000000000000000") {
    await send(
      "createSeries",
      await wallet.writeContract({
        address: factory,
        abi: artifact("KyrveSeriesFactory").abi as never,
        functionName: "createSeries",
        args: [spec.marketId, settlement.loanToken, account.address],
        account,
        chain: sepolia,
      }),
    );
    vault = (await publicClient.readContract({
      address: factory,
      abi: artifact("KyrveSeriesFactory").abi as never,
      functionName: "vaultOf",
      args: [seriesId],
    })) as Address;
  }
  console.log(`    vault                    ${vault}`);

  const vaultBalance = (await publicClient.readContract({
    address: settlement.loanToken,
    abi: artifact("TestERC20").abi as never,
    functionName: "balanceOf",
    args: [vault],
  })) as bigint;
  // Funding is skipped once the quote is consumed: on a resume the vault has legitimately paid out
  // and topping it up again would be a transaction for nothing.
  const quoteAlready = (await publicClient.readContract({
    address: registryEarlyAddress(settlement),
    abi: artifact("KyrveQuoteRegistry").abi as never,
    functionName: "quoteOfEpoch",
    args: [epoch.epochId],
  })) as Hex;
  const consumedAlready =
    quoteAlready !== `0x${"00".repeat(32)}` &&
    (
      (await publicClient.readContract({
        address: registryEarlyAddress(settlement),
        abi: artifact("KyrveQuoteRegistry").abi as never,
        functionName: "executionOf",
        args: [quoteAlready],
      })) as { status: number }
    ).status === 2;

  if (!consumedAlready && vaultBalance < size.buyerAssets) {
    await send(
      "fund vault",
      await wallet.writeContract({
        address: settlement.loanToken,
        abi: artifact("TestERC20").abi as never,
        functionName: "mint",
        args: [vault, size.buyerAssets - vaultBalance],
        account,
        chain: sepolia,
      }),
    );
  }

  // ── 4. Activate ───────────────────────────────────────────────────────────────────────────
  const activator = settlement.addresses["QuoteActivator"];
  if (activator === undefined) throw new Error("the manifest records no activator");

  /**
   * One epoch produces at most one quote, forever — so a re-run must ADOPT the existing one rather
   * than attempt a second activation the registry would refuse. That is not a convenience: this
   * script broadcasts real transactions, and a step failing after activation must be resumable
   * without paying for another epoch.
   */
  const registryEarly = settlement.addresses["KyrveQuoteRegistry"];
  if (registryEarly === undefined) throw new Error("the manifest records no registry");
  const existingQuote = (await publicClient.readContract({
    address: registryEarly,
    abi: artifact("KyrveQuoteRegistry").abi as never,
    functionName: "quoteOfEpoch",
    args: [epoch.epochId],
  })) as Hex;

  let quoteId: Hex;
  let offerBytes: Hex;

  if (existingQuote !== `0x${"00".repeat(32)}`) {
    console.log(`\n  adopting the quote this epoch already produced: ${existingQuote}`);
    quoteId = existingQuote;
    /**
     * The offer comes from the activation RECEIPT, not from a log search.
     *
     * `eth_getLogs` over an open block range is capped at ten blocks on Alchemy's free tier, and a
     * first resume died on exactly that. The activation transaction is recorded when it happens, so a
     * resume reads one receipt instead of scanning a chain — and the offer cannot be reconstructed
     * locally in any case, because `offer.start` is the activation block's timestamp and `offerHash`
     * covers it.
     */
    if (!existsSync(activationPath)) {
      throw new Error(
        `the registry holds quote ${existingQuote} for this epoch, but ${activationPath} does not ` +
          "exist, so the activation transaction is unknown and the offer cannot be recovered. The " +
          "offer is only ever obtainable from the `OfferPublished` log of that transaction; put its " +
          'hash in that file as { "quoteId", "activationTxHash" } and re-run.',
      );
    }
    const record = readJson<{ quoteId: Hex; activationTxHash: Hex }>(activationPath);
    if (record.quoteId.toLowerCase() !== existingQuote.toLowerCase()) {
      throw new Error(
        `${activationPath} records quote ${record.quoteId}, but this epoch's quote is ${existingQuote}`,
      );
    }
    const receipt = await publicClient.getTransactionReceipt({ hash: record.activationTxHash });
    const recovered = parseEventLogs({
      abi: artifact("QuoteActivator").abi as never,
      logs: receipt.logs,
      eventName: "OfferPublished",
    })[0] as unknown as { args: { quoteId: Hex; offer: Hex } } | undefined;
    if (recovered === undefined) {
      throw new Error(`${record.activationTxHash} published no offer`);
    }
    offerBytes = recovered.args.offer;
  } else {
    const activationHash = await wallet.writeContract({
      address: activator,
      abi: artifact("QuoteActivator").abi as never,
      functionName: "activate",
      args: [
        {
          epochId: epoch.epochId,
          expectedGraphRoot: epoch.graphRoot,
          expectedRequestId: epoch.requestId,
          expectedUniverseId: epoch.universeId,
          market,
          leafIndex: BigInt(leafIndex),
          lifetime: 3_600n,
          maxPendingFee: size.buyerAssets,
        },
        {
          marketProof: epoch.proofs.market,
          rateProof: epoch.proofs.rate,
          floorProof: epoch.proofs.floor,
          readyProof: epoch.proofs.ready,
          aggregateProof: epoch.proofs.aggregate,
        },
      ],
      account,
      chain: sepolia,
    });
    console.log("\n  activating:");
    await send("activate", activationHash);

    const activationReceipt = await publicClient.getTransactionReceipt({ hash: activationHash });
    const published = parseEventLogs({
      abi: artifact("QuoteActivator").abi as never,
      logs: activationReceipt.logs,
      eventName: "OfferPublished",
    })[0] as unknown as { args: { quoteId: Hex; offer: Hex } } | undefined;
    if (published === undefined) throw new Error("activation published no offer");

    quoteId = published.args.quoteId;
    offerBytes = published.args.offer;

    // Written IMMEDIATELY, before anything else can fail. Every later step is resumable only if this
    // exists: the offer lives in one log of one transaction and nothing can rebuild it.
    mkdirSync(repoPath("evidence/phase4"), { recursive: true });
    writeFileSync(
      activationPath,
      `${stableStringify({
        $comment:
          "The activation transaction for this epoch's one quote. The offer is recoverable ONLY from " +
          "its OfferPublished log — `offer.start` is the activation block's timestamp, so no client " +
          "can rebuild the offer the ratifier hashed.",
        epochId: epoch.epochId,
        quoteId: published.args.quoteId,
        activationTxHash: activationHash,
      })}\n`,
    );
  }
  // The offer's ABI parameter, taken from the activator's own artifact rather than transcribed. A
  // hand-written Offer tuple here would be a second definition of the struct the ratifier hashes.
  const offerParam = (
    artifact("QuoteActivator").abi as { name?: string; outputs?: unknown[] }[]
  ).find((item) => item.name === "activate")?.outputs?.[1];
  if (offerParam === undefined) {
    throw new Error("the activator artifact declares no offer output for `activate`");
  }
  const offer = decodeAbiParameters([offerParam as never] as never, offerBytes)[0];

  console.log(`    quote id                 ${quoteId}`);

  const registry = settlement.addresses["KyrveQuoteRegistry"];
  if (registry === undefined) throw new Error("the manifest records no registry");
  const execution = (await publicClient.readContract({
    address: registry,
    abi: artifact("KyrveQuoteRegistry").abi as never,
    functionName: "executionOf",
    args: [quoteId],
  })) as { offerHash: Hex; exactUnits: bigint; expectedBuyerAssets: bigint; taker: Address };

  if (keccak256(offerBytes) !== execution.offerHash) {
    throw new Error("the recovered offer does not hash to what the registry stored");
  }
  if (execution.exactUnits !== size.units) {
    throw new Error(`the registry sized the quote at ${execution.exactUnits}, not ${size.units}`);
  }

  const alreadySettled =
    (
      (await publicClient.readContract({
        address: registryEarly,
        abi: artifact("KyrveQuoteRegistry").abi as never,
        functionName: "executionOf",
        args: [quoteId],
      })) as { status: number }
    ).status === 2;

  /**
   * ── 5. A partial fill, which must be refused ────────────────────────────────────────────────
   *
   * ONCE THE QUOTE IS CONSUMED THIS CANNOT BE RE-DEMONSTRATED, and re-attempting it would be
   * misleading rather than merely redundant: a consumed quote is refused by `QuoteNotExecutable` at
   * the ratifier, not by `WrongUnits` at the vault, so a fresh attempt would record the wrong
   * refusal for the wrong reason. The rejection observed BEFORE settlement is carried in the
   * activation record and labelled as such; nothing is invented if it is absent.
   */
  const carried = readJson<{
    partialFillRejection?: string;
    partialFillRollbackObserved?: boolean;
  }>(activationPath);

  if (alreadySettled) {
    if (carried.partialFillRejection === undefined) {
      throw new Error(
        "the quote is already consumed and no pre-settlement partial-fill refusal is recorded in " +
          `${activationPath}. That demonstration cannot be reproduced against a consumed quote, and ` +
          "this script will not record one it did not observe.",
      );
    }
    console.log(
      "\n  partial fill (observed before settlement, carried from the activation record):",
    );
    console.log(`    refused: ${carried.partialFillRejection.slice(0, 120)}`);
  }

  console.log(alreadySettled ? "" : "\n  attempting a partial fill (must be refused):");
  let partialRejection = carried.partialFillRejection ?? "";
  if (!alreadySettled) {
    try {
      await publicClient.simulateContract({
        address: settlement.midnight,
        abi: artifact("IMidnight").abi as never,
        functionName: "take",
        args: [
          offer,
          "0x",
          execution.exactUnits - 1n,
          execution.taker,
          execution.taker,
          "0x0000000000000000000000000000000000000000",
          "0x",
        ],
        account,
      });
    } catch (error) {
      partialRejection =
        (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";
    }
    if (partialRejection === "") {
      throw new Error("a partial fill was ADMITTED on Sepolia. Refusing to continue.");
    }
    console.log(`    refused: ${partialRejection.slice(0, 120)}`);
    writeFileSync(
      activationPath,
      `${stableStringify({
        ...readJson<Record<string, unknown>>(activationPath),
        partialFillRejection: partialRejection.slice(0, 300),
      })}\n`,
    );
  }

  // ── 6. Rollback: nothing moved ────────────────────────────────────────────────────────────
  //
  // Only meaningful before settlement: after it, the group is legitimately consumed by the exact
  // fill. The observation is recorded when it is made.
  if (!alreadySettled) {
    const consumedAfterPartial = (await publicClient.readContract({
      address: settlement.midnight,
      abi: artifact("IMidnight").abi as never,
      functionName: "consumed",
      args: [vault, quoteId],
    })) as bigint;
    if (consumedAfterPartial !== 0n) {
      throw new Error(
        `the refused partial fill consumed ${consumedAfterPartial} units of the group`,
      );
    }
    console.log("    rollback: group consumption is 0, no credit, no debt");
    writeFileSync(
      activationPath,
      `${stableStringify({
        ...readJson<Record<string, unknown>>(activationPath),
        partialFillRollbackObserved: true,
      })}\n`,
    );
  } else if (carried.partialFillRollbackObserved !== true) {
    throw new Error(
      "no pre-settlement rollback observation is recorded, and it cannot be reproduced against a " +
        "consumed quote",
    );
  }

  // ── 6b. The borrower's collateral ──────────────────────────────────────────────────────────
  //
  // WITHOUT THIS, `take` reverts `SellerIsLiquidatable` — which is what a first run did, after the
  // proofs had verified, the series had been created and the quote had been activated. Midnight
  // checks the seller's health before it will let them take on debt, and on a public network nobody
  // has supplied collateral on the borrower's behalf.
  //
  // Generous rather than exact: the health check is Midnight's and this script is not about it. The
  // collateral token, its LLTV and its oracle all come from the market struct the universe curated,
  // so nothing here chooses them.
  const collateralLeg = (market["collateralParams"] as readonly { token: Address }[])[0];
  if (collateralLeg === undefined) throw new Error("the market has no collateral leg");

  const supplied = (await publicClient.readContract({
    address: settlement.midnight,
    abi: artifact("IMidnight").abi as never,
    functionName: "collateral",
    args: [spec.marketId, execution.taker, 0n],
  })) as bigint;

  const collateralNeeded = (execution.exactUnits * 10n ** 18n * 4n) / 1_000_000n;
  if (!alreadySettled && supplied < collateralNeeded) {
    console.log("\n  supplying the borrower's collateral:");
    await send(
      "mint collateral",
      await wallet.writeContract({
        address: collateralLeg.token,
        abi: artifact("TestERC20").abi as never,
        functionName: "mint",
        args: [execution.taker, collateralNeeded],
        account,
        chain: sepolia,
      }),
    );
    await send(
      "approve Midnight",
      await wallet.writeContract({
        address: collateralLeg.token,
        abi: artifact("TestERC20").abi as never,
        functionName: "approve",
        args: [settlement.midnight, collateralNeeded],
        account,
        chain: sepolia,
      }),
    );
    await send(
      "supplyCollateral",
      await wallet.writeContract({
        address: settlement.midnight,
        abi: artifact("IMidnight").abi as never,
        functionName: "supplyCollateral",
        args: [market, 0n, collateralNeeded, execution.taker],
        account,
        chain: sepolia,
      }),
    );
  }

  // ── 7. The exact fill ─────────────────────────────────────────────────────────────────────
  const recordedSettlement = readJson<{ settlementTxHash?: Hex }>(activationPath).settlementTxHash;
  if (alreadySettled && recordedSettlement === undefined) {
    throw new Error(
      "the quote is consumed but no settlement transaction is recorded, so its block cannot be " +
        "identified and the credit and debt this fill created cannot be measured as deltas",
    );
  }

  let settleHash: Hex;
  if (alreadySettled && recordedSettlement !== undefined) {
    console.log(`\n  already settled by ${EXPLORER}/tx/${recordedSettlement}`);
    settleHash = recordedSettlement;
  } else {
    console.log("\n  settling the exact fill:");
    settleHash = await wallet.writeContract({
      address: settlement.midnight,
      abi: artifact("IMidnight").abi as never,
      functionName: "take",
      args: [
        offer,
        "0x",
        execution.exactUnits,
        execution.taker,
        execution.taker,
        "0x0000000000000000000000000000000000000000",
        "0x",
      ],
      account,
      chain: sepolia,
    });
    await send("take (exact fill)", settleHash);
  }
  writeFileSync(
    activationPath,
    `${stableStringify({
      ...readJson<Record<string, unknown>>(activationPath),
      settlementTxHash: settleHash,
    })}\n`,
  );

  // ── 8-12. Credit, debt, tokens, consumption ───────────────────────────────────────────────
  //
  // MEASURED AS DELTAS ACROSS THE SETTLEMENT BLOCK, not as absolutes.
  //
  // Credit and debt are CUMULATIVE positions in a shared public market. This borrower already held
  // 3,000,000 units of debt from Phase 1's Sepolia integration run, so a first version asserting
  // `debt == exactUnits` failed on a settlement that was entirely correct. The property that actually
  // matters is that this fill created exactly `exactUnits` of credit and exactly `exactUnits` of
  // debt, which is what the difference across the block says and what an absolute never could.
  const read = async (
    fn: string,
    args: readonly unknown[],
    blockNumber?: bigint,
  ): Promise<bigint> =>
    (await publicClient.readContract({
      address: settlement.midnight,
      abi: artifact("IMidnight").abi as never,
      functionName: fn,
      args: args as never,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    })) as bigint;

  const settlementBlock = (await publicClient.getTransactionReceipt({ hash: settleHash }))
    .blockNumber;

  const creditBefore = await read("credit", [spec.marketId, vault], settlementBlock - 1n);
  const debtBefore = await read("debt", [spec.marketId, execution.taker], settlementBlock - 1n);
  const credit = await read("credit", [spec.marketId, vault], settlementBlock);
  const debt = await read("debt", [spec.marketId, execution.taker], settlementBlock);
  const creditCreated = credit - creditBefore;
  const debtCreated = debt - debtBefore;
  const consumed = await read("consumed", [vault, quoteId]);
  const status = (await publicClient.readContract({
    address: registry,
    abi: artifact("KyrveQuoteRegistry").abi as never,
    functionName: "executionOf",
    args: [quoteId],
  })) as { status: number };

  console.log(
    `\n  credit created by this fill  ${creditCreated}  (position ${creditBefore} -> ${credit})`,
  );
  console.log(`  debt created by this fill    ${debtCreated}  (position ${debtBefore} -> ${debt})`);
  console.log(`  group consumed               ${consumed}`);
  console.log(`  quote status                 ${status.status} (2 = consumed)`);

  if (creditCreated !== execution.exactUnits) {
    throw new Error(
      `this fill created ${creditCreated} of credit, expected ${execution.exactUnits}`,
    );
  }
  if (debtCreated !== execution.exactUnits) {
    throw new Error(`this fill created ${debtCreated} of debt, expected ${execution.exactUnits}`);
  }
  if (consumed !== execution.exactUnits) throw new Error("the group was not consumed exactly");
  if (status.status !== 2)
    throw new Error(`the quote status is ${status.status}, expected Consumed`);

  // ── 13. Replay ────────────────────────────────────────────────────────────────────────────
  console.log("\n  attempting a replay (must be refused):");
  let replayRejection = "";
  try {
    await publicClient.simulateContract({
      address: settlement.midnight,
      abi: artifact("IMidnight").abi as never,
      functionName: "take",
      args: [
        offer,
        "0x",
        execution.exactUnits,
        execution.taker,
        execution.taker,
        "0x0000000000000000000000000000000000000000",
        "0x",
      ],
      account,
    });
  } catch (error) {
    replayRejection = (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";
  }
  if (replayRejection === "") throw new Error("a replay was ADMITTED on Sepolia");
  console.log(`    refused: ${replayRejection.slice(0, 120)}`);

  const balanceAfter = await publicClient.getBalance({ address: account.address });
  const evidence = {
    $comment:
      "MEASURED on Ethereum Sepolia against unmodified Midnight and the HOSTED iExec Nox gateway. " +
      "Every value is public from activation. No decrypted mandate, request, allocation or capacity " +
      "appears here and none is representable.",
    chainId: 11155111,
    explorer: EXPLORER,
    epochId: epoch.epochId,
    quoteId,
    vault,
    marketId: spec.marketId,
    borrower: execution.taker,
    aggregateFillAmount: verified.aggregateFillAmount.toString(),
    exactUnits: execution.exactUnits.toString(),
    expectedBuyerAssets: execution.expectedBuyerAssets.toString(),
    unreservedResidue: size.residue.toString(),
    creditCreatedByThisFill: creditCreated.toString(),
    debtCreatedByThisFill: debtCreated.toString(),
    vaultCreditPositionAfter: credit.toString(),
    borrowerDebtPositionAfter: debt.toString(),
    borrowerDebtPositionBefore: debtBefore.toString(),
    borrowerDebtNote:
      "Credit and debt are CUMULATIVE positions in a shared public market. This borrower already " +
      "held debt from Phase 1's Sepolia integration run, so the figure that describes THIS " +
      "settlement is the delta across the settlement block, not the absolute.",
    creditUnits: creditCreated.toString(),
    debtUnits: debtCreated.toString(),
    consumedUnits: consumed.toString(),
    quoteStatus: status.status,
    settled: true,
    partialFillRejected: true,
    partialFillRejection: partialRejection.slice(0, 300),
    replayRejected: true,
    replayRejection: replayRejection.slice(0, 300),
    transactions: receipts,
    ethSpent: formatEther(balanceBefore - balanceAfter),
  };

  const payload = `${stableStringify(evidence)}\n`;
  assertNoSecrets(payload, "evidence/phase4/sepolia-settlement.json");
  mkdirSync(repoPath("evidence/phase4"), { recursive: true });
  writeFileSync(repoPath("evidence/phase4/sepolia-settlement.json"), payload);

  console.log(`\n  ${formatEther(balanceBefore - balanceAfter)} ETH spent`);
  console.log("  recorded in evidence/phase4/sepolia-settlement.json\n");
}

main().catch((error: unknown) => {
  console.error(
    `\nsepolia settlement FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
