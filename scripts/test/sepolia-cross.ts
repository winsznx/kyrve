/**
 * One real Kyrve Cross match on Ethereum Sepolia, between two claims a real allocation minted.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE TWO PRECONDITIONS ARE PROVEN, NOT ASSUMED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A match against an empty escrow is a match for nothing, and it would still emit the same event —
 * that is the point of the confidentiality model and it is also how a demonstration proves nothing
 * while appearing to pass. So before anything is submitted:
 *
 *   the SELLER's claim   is read from the series token and decrypted BY THE SELLER
 *   the BUYER's funding  is wrapped, read from the wrapper and decrypted BY THE BUYER
 *
 * Both must be strictly positive and both must cover what the order will offer. Neither magnitude is
 * printed.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE FIXTURE IS SIZED TO PRODUCE A PARTIAL FILL AND REAL DUST
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * At a round size every conservation identity holds trivially and the rounding policy is never
 * exercised. The buyer's escrow is deliberately not a multiple of the declared 0.97 price, so the
 * match is partial on the seller's side and `floor(matched * price / WAD)` leaves a sub-unit
 * remainder in the BUYER's escrow — which cancellation then returns.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * NO MATCHED QUANTITY REACHES STDOUT OR THE EVIDENCE FILE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every conservation identity is evaluated IN MEMORY from balances each party decrypted for
 * themselves, and only the verdicts are recorded. A script that printed the matched size would
 * publish exactly what Cross exists to keep private.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { NOX_COMPUTE_BY_CHAIN, NOX_GATEWAY_BY_CHAIN } from "@kyrve/config";
import { createHandleClient, type Handle } from "@kyrve/nox";
import { type Address, createPublicClient, createWalletClient, type Hex, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import { assertBroadcastArmed, assertNoSecrets, safeErrorMessage, sepoliaRpc } from "../lib/env.js";
import { layerPaths, requireLayerFile } from "../lib/layer.js";
import { resolveRoles, signingKey } from "../lib/roles.js";
import { readJson, repoPath, stableStringify } from "../lib/shell.js";

const CHAIN_ID = 11_155_111;
const EXPLORER = "https://sepolia.etherscan.io";
const ZERO32 = `0x${"00".repeat(32)}` as Hex;
const WAD = 10n ** 18n;
const BPS = 10_000n;
const POLL = {
  policy: { initialDelayMs: 2_000, maxDelayMs: 20_000, multiplier: 2, timeoutMs: 600_000 },
} as const;
const ORDER_LIFETIME = 7n * 24n * 3600n;
const SIDE_EXIT = 0;
const SIDE_ENTRY = 1;

function abiOf(name: string): readonly unknown[] {
  const path = repoPath(`confidential/artifacts/contracts/${name}.sol/${name}.json`);
  if (!existsSync(path)) throw new Error(`no artifact at ${path}; compile the confidential layer`);
  return readJson<{ abi: readonly unknown[] }>(path).abi;
}

/** The plaintext reference model. Both divisions round DOWN, leaving each remainder at home. */
function modelMatch(sellerQty: bigint, buyerAssets: bigint, priceWad: bigint, feeBps: bigint) {
  const capacity = (buyerAssets * WAD) / priceWad;
  const matched = sellerQty < capacity ? sellerQty : capacity;
  const cost = (matched * priceWad) / WAD;
  const fee = (cost * feeBps) / BPS;
  return {
    matched,
    cost,
    fee,
    net: cost - fee,
    sellerLeft: sellerQty - matched,
    buyerLeft: buyerAssets - cost,
  };
}

async function main(): Promise<void> {
  assertBroadcastArmed();
  const layer = layerPaths();
  if (layer.tag === "") throw new Error("set KYRVE_EVIDENCE_TAG=a — Cross runs against ONE layer");

  const rpc = sepoliaRpc();
  const client = createPublicClient({ chain: sepolia, transport: http(rpc.url) });
  if ((await client.getChainId()) !== CHAIN_ID) throw new Error("not Sepolia");

  const deployment = readJson<{
    seriesId: Hex;
    loanToken: Address;
    contracts: Record<string, { address: Address }>;
  }>(repoPath(requireLayerFile(layer.deployment, "the layer", "pnpm deploy:series sepolia")));
  const market = readJson<{ contracts: Record<string, { address: Address }> }>(
    repoPath(
      requireLayerFile(
        "deployments/sepolia/market.json",
        "the market layer",
        "pnpm deploy:market sepolia",
      ),
    ),
  );
  const allocation = readJson<{ allocated: boolean; closed: boolean; quoteId: Hex }>(
    repoPath(
      requireLayerFile(
        layer.allocation,
        "the allocation",
        `KYRVE_EVIDENCE_TAG=${layer.tag} pnpm test:sepolia-series-allocation`,
      ),
    ),
  );
  if (!allocation.allocated || !allocation.closed) {
    throw new Error("the allocation is not complete — there is no claim to sell");
  }

  const book = market.contracts["KyrveCrossBook"]?.address;
  const token = deployment.contracts["KyrveSeriesToken"]?.address;
  const asset = deployment.contracts["KyrveWrappedAsset"]?.address;
  if (book === undefined || token === undefined || asset === undefined) {
    throw new Error("the records name no KyrveCrossBook, KyrveSeriesToken or KyrveWrappedAsset");
  }

  const roles = resolveRoles("sepolia", { requireKeys: ["keeper"] });
  const keeper = privateKeyToAccount(signingKey(roles, "keeper"));
  const sellerKey = (process.env["DUST_PRIVATE_KEY_1"] ?? "").trim() as Hex;
  const buyerKey = (process.env["DUST_PRIVATE_KEY_2"] ?? "").trim() as Hex;
  for (const [name, key] of [
    ["DUST_PRIVATE_KEY_1", sellerKey],
    ["DUST_PRIVATE_KEY_2", buyerKey],
  ] as const) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${name} is not set`);
  }
  const seller = privateKeyToAccount(sellerKey);
  const buyer = privateKeyToAccount(buyerKey);

  const network = {
    chainId: CHAIN_ID,
    name: "ethereum-sepolia",
    noxCompute: NOX_COMPUTE_BY_CHAIN[CHAIN_ID] as Address,
    gatewayUrl: NOX_GATEWAY_BY_CHAIN[CHAIN_ID] as string,
  };
  const wallet = (account: ReturnType<typeof privateKeyToAccount>) =>
    createWalletClient({ account, chain: sepolia, transport: http(rpc.url) });
  const sellerWallet = wallet(seller);
  const buyerWallet = wallet(buyer);
  const keeperWallet = wallet(keeper);
  const sellerClient = await createHandleClient(sellerWallet as never, network);
  const buyerClient = await createHandleClient(buyerWallet as never, network);

  const tokenAbi = abiOf("KyrveSeriesToken");
  const assetAbi = abiOf("KyrveWrappedAsset");
  const bookAbi = abiOf("KyrveCrossBook");
  const erc20Abi = [
    {
      type: "function",
      name: "mint",
      stateMutability: "nonpayable",
      inputs: [{ type: "address" }, { type: "uint256" }],
      outputs: [],
    },
    {
      type: "function",
      name: "approve",
      stateMutability: "nonpayable",
      inputs: [{ type: "address" }, { type: "uint256" }],
      outputs: [{ type: "bool" }],
    },
  ] as const;

  const priceWad = (await client.readContract({
    address: book,
    abi: bookAbi as never,
    functionName: "PRICE_WAD",
  })) as bigint;
  const feeBps = BigInt(
    (await client.readContract({
      address: book,
      abi: bookAbi as never,
      functionName: "FEE_BPS",
    })) as number,
  );
  const feeBeneficiary = (await client.readContract({
    address: book,
    abi: bookAbi as never,
    functionName: "FEE_BENEFICIARY",
  })) as Address;

  console.log(`\nsepolia cross — ${layer.label} — ${rpc.redacted}\n`);
  console.log(`  book      ${book}`);
  console.log(`  price     ${Number(priceWad) / Number(WAD)} loan units per claim unit`);
  console.log(`  fee       ${feeBps} bps to ${feeBeneficiary}`);
  console.log(`  seller    ${seller.address}`);
  console.log(`  buyer     ${buyer.address}`);
  console.log(`  keeper    ${keeper.address}\n`);

  const steps: { name: string; tx?: Hex; gas?: string }[] = [];
  const send = async (
    account: ReturnType<typeof privateKeyToAccount>,
    w: ReturnType<typeof wallet>,
    address: Address,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[],
  ): Promise<bigint> => {
    const hash = await w.writeContract({
      address,
      abi: abi as never,
      functionName: functionName as never,
      args: args as never,
      account,
      chain: sepolia,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
    steps.push({ name: functionName, tx: hash, gas: receipt.gasUsed.toString() });
    console.log(`     ${functionName.padEnd(24)} ${receipt.gasUsed} gas`);
    return receipt.gasUsed;
  };

  // ── PRECONDITION 1: the seller holds a claim ─────────────────────────────────────────────
  const sellerClaimHandle = (await client.readContract({
    address: token,
    abi: tokenAbi as never,
    functionName: "confidentialBalanceOf",
    args: [seller.address] as never,
  })) as Handle;
  if (sellerClaimHandle === ZERO32) throw new Error("the seller holds no series claim");
  const sellerClaim = await sellerClient.decrypt(sellerClaimHandle, POLL);
  if (sellerClaim === 0n) throw new Error("the seller's claim is zero — nothing to sell");
  console.log("  1. the seller's claim is proven, and positive");

  // ── PRECONDITION 2: the buyer's funding, wrapped and proven ──────────────────────────────
  const offeredQty = sellerClaim / 4n;
  if (offeredQty === 0n) throw new Error("the seller's claim is too small to split");
  // Not a multiple of the price, so the match leaves real dust in the buyer's escrow.
  const escrowedAssets = (offeredQty * priceWad) / WAD / 2n + 7n;

  const buyerAssetHandle0 = (await client.readContract({
    address: asset,
    abi: assetAbi as never,
    functionName: "confidentialBalanceOf",
    args: [buyer.address] as never,
  })) as Handle;
  const buyerAssetsBefore =
    buyerAssetHandle0 === ZERO32 ? 0n : await buyerClient.decrypt(buyerAssetHandle0, POLL);

  if (buyerAssetsBefore < escrowedAssets) {
    const shortfall = escrowedAssets - buyerAssetsBefore;
    console.log("  2. wrapping the buyer's funding");
    await send(buyer, buyerWallet, deployment.loanToken, erc20Abi, "mint", [
      buyer.address,
      shortfall,
    ]);
    await send(buyer, buyerWallet, deployment.loanToken, erc20Abi, "approve", [asset, shortfall]);
    await send(buyer, buyerWallet, asset, assetAbi, "wrap", [buyer.address, shortfall]);
  }
  const buyerAssetHandle = (await client.readContract({
    address: asset,
    abi: assetAbi as never,
    functionName: "confidentialBalanceOf",
    args: [buyer.address] as never,
  })) as Handle;
  const buyerFunding = await buyerClient.decrypt(buyerAssetHandle, POLL);
  if (buyerFunding < escrowedAssets) throw new Error("the buyer's funding is short of the order");
  console.log("  2. the buyer's funding is proven, and covers the order");

  const model = modelMatch(offeredQty, escrowedAssets, priceWad, feeBps);
  if (model.matched === 0n) throw new Error("the fixture matches nothing");
  if (model.sellerLeft === 0n) throw new Error("the fixture is not a PARTIAL fill");
  if (model.buyerLeft === 0n)
    throw new Error("the fixture leaves no dust — the rounding is untested");

  // ── Opening balances, each decrypted by its owner ────────────────────────────────────────
  const openingSellerAssets = await (async () => {
    const h = (await client.readContract({
      address: asset,
      abi: assetAbi as never,
      functionName: "confidentialBalanceOf",
      args: [seller.address] as never,
    })) as Handle;
    return h === ZERO32 ? 0n : sellerClient.decrypt(h, POLL);
  })();
  const openingBuyerClaim = await (async () => {
    const h = (await client.readContract({
      address: token,
      abi: tokenAbi as never,
      functionName: "confidentialBalanceOf",
      args: [buyer.address] as never,
    })) as Handle;
    return h === ZERO32 ? 0n : buyerClient.decrypt(h, POLL);
  })();

  // ── 3. The exit order ───────────────────────────────────────────────────────────────────
  const expiry = (await client.getBlock()).timestamp + ORDER_LIFETIME;
  const exitId = (await client.readContract({
    address: book,
    abi: bookAbi as never,
    functionName: "orderIdFor",
    args: [seller.address, SIDE_EXIT, 0n] as never,
  })) as Hex;
  const exitState = (await client.readContract({
    address: book,
    abi: bookAbi as never,
    functionName: "submittedBy",
    args: [seller.address] as never,
  })) as bigint;
  if (exitState === 0n) {
    console.log("  3. the seller escrows their claim");
    const until = (await client.getBlock()).timestamp + 3600n;
    await send(seller, sellerWallet, token, tokenAbi, "setOperator", [book, until]);
    const encrypted = await sellerClient.encrypt(offeredQty, "euint256", book);
    const nonce = (await client.readContract({
      address: book,
      abi: bookAbi as never,
      functionName: "nextNonce",
      args: [seller.address] as never,
    })) as bigint;
    await send(seller, sellerWallet, book, bookAbi, "submitExit", [
      encrypted.handle,
      encrypted.proof,
      expiry,
      nonce,
    ]);
    await send(seller, sellerWallet, token, tokenAbi, "setOperator", [book, 0n]);
  } else {
    console.log("  3. adopted the seller's existing exit order");
  }

  // ── 4. The entry order ──────────────────────────────────────────────────────────────────
  const entryId = (await client.readContract({
    address: book,
    abi: bookAbi as never,
    functionName: "orderIdFor",
    args: [buyer.address, SIDE_ENTRY, 0n] as never,
  })) as Hex;
  const entryState = (await client.readContract({
    address: book,
    abi: bookAbi as never,
    functionName: "submittedBy",
    args: [buyer.address] as never,
  })) as bigint;
  if (entryState === 0n) {
    console.log("  4. the buyer escrows their funding");
    const until = (await client.getBlock()).timestamp + 3600n;
    await send(buyer, buyerWallet, asset, assetAbi, "setOperator", [book, until]);
    const encrypted = await buyerClient.encrypt(escrowedAssets, "euint256", book);
    const nonce = (await client.readContract({
      address: book,
      abi: bookAbi as never,
      functionName: "nextNonce",
      args: [buyer.address] as never,
    })) as bigint;
    await send(buyer, buyerWallet, book, bookAbi, "submitEntry", [
      encrypted.handle,
      encrypted.proof,
      expiry,
      nonce,
    ]);
    await send(buyer, buyerWallet, asset, assetAbi, "setOperator", [book, 0n]);
  } else {
    console.log("  4. adopted the buyer's existing entry order");
  }

  // ── 5. The match ────────────────────────────────────────────────────────────────────────
  const matchCount = Number(
    (
      (await client.readContract({
        address: book,
        abi: bookAbi as never,
        functionName: "orderOf",
        args: [exitId] as never,
      })) as unknown[]
    )[5],
  );
  if (matchCount === 0) {
    console.log("  5. the keeper nets the two orders");
    await send(keeper, keeperWallet, book, bookAbi, "matchOrders", [exitId, entryId]);
  } else {
    console.log("  5. adopted the existing match");
  }

  // ── 6. Conservation, from balances each party decrypted for themselves ──────────────────
  const closingSellerClaim = await sellerClient.decrypt(
    (await client.readContract({
      address: token,
      abi: tokenAbi as never,
      functionName: "confidentialBalanceOf",
      args: [seller.address] as never,
    })) as Handle,
    POLL,
  );
  const closingSellerAssets = await sellerClient.decrypt(
    (await client.readContract({
      address: asset,
      abi: assetAbi as never,
      functionName: "confidentialBalanceOf",
      args: [seller.address] as never,
    })) as Handle,
    POLL,
  );
  const closingBuyerClaim = await buyerClient.decrypt(
    (await client.readContract({
      address: token,
      abi: tokenAbi as never,
      functionName: "confidentialBalanceOf",
      args: [buyer.address] as never,
    })) as Handle,
    POLL,
  );
  const closingBuyerAssets = await buyerClient.decrypt(
    (await client.readContract({
      address: asset,
      abi: assetAbi as never,
      functionName: "confidentialBalanceOf",
      args: [buyer.address] as never,
    })) as Handle,
    POLL,
  );

  const claimToBuyer = closingBuyerClaim - openingBuyerClaim;
  const assetsToSeller = closingSellerAssets - openingSellerAssets;
  const sellerClaimFell = sellerClaim - closingSellerClaim;
  const buyerAssetsFell = buyerFunding - closingBuyerAssets;

  const matchedAsModelled = claimToBuyer === model.matched;
  const proceedsAsModelled = assetsToSeller === model.net;
  const sellerEscrowConserved = sellerClaimFell === offeredQty;
  const buyerEscrowConserved = buyerAssetsFell === escrowedAssets;

  for (const [what, ok] of [
    ["the buyer received exactly the modelled match", matchedAsModelled],
    ["the seller received exactly the modelled proceeds, net of fee", proceedsAsModelled],
    ["the seller's claim fell by exactly what they escrowed", sellerEscrowConserved],
    ["the buyer's funding fell by exactly what they escrowed", buyerEscrowConserved],
  ] as const) {
    if (!ok) {
      throw new Error(
        `conservation FAILED: ${what} is false. The magnitudes are deliberately not printed; ` +
          "reproduce against the local suite to diagnose.",
      );
    }
    console.log(`  6. ${what}`);
  }

  const evidence = {
    $comment:
      "One real Kyrve Cross match on Ethereum Sepolia. NO MATCHED QUANTITY, ESCROW SIZE OR PRIVATE " +
      "BALANCE APPEARS HERE. Every identity was evaluated IN MEMORY from balances each party " +
      "decrypted for themselves, and only the verdicts are recorded.",
    chainId: CHAIN_ID,
    layer: layer.tag,
    crossBook: book,
    seriesToken: token,
    wrappedAsset: asset,
    seriesId: deployment.seriesId,
    quoteId: allocation.quoteId,
    seller: seller.address,
    buyer: buyer.address,
    keeper: keeper.address,
    feeBeneficiary,
    declaredPriceWad: priceWad.toString(),
    declaredFeeBps: Number(feeBps),
    exitId,
    entryId,
    partialFill: true,
    dustRemainedWithTheBuyer: true,
    matchedAsModelled,
    proceedsAsModelled,
    sellerEscrowConserved,
    buyerEscrowConserved,
    steps,
    explorer: `${EXPLORER}/address/${book}`,
    measuredAt: new Date().toISOString(),
  };
  const payload = `${stableStringify(evidence)}\n`;
  assertNoSecrets(payload, layer.cross);
  mkdirSync(repoPath("evidence/phase6"), { recursive: true });
  writeFileSync(repoPath(layer.cross), payload);

  console.log(`\n  recorded in ${layer.cross}\n`);
}

main().catch((error: unknown) => {
  console.error(`\nsepolia cross FAILED — ${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
});
