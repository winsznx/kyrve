/**
 * The smallest real coherent Roll on Ethereum Sepolia: layer A -> layer B, across two series that
 * share no contract.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IS BEING CLAIMED, AND WHAT IS NOT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CLAIMED: the mechanism works on a public network, between two series each produced by its own
 * complete confidential issuance stack — its own custody vault, engine, epoch controller, graph
 * registry, ledger and settlement layer (delta U-1). Nothing here is simulated and neither series is
 * stood in for.
 *
 * NOT CLAIMED: production-scale throughput. This is one intent against one supply at the smallest
 * size that exercises every path, and the expensive part of a larger roll is repeating the whole
 * confidential issuance stack for each additional maturity — not an unimplemented feature.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE THREE PRECONDITIONS, ENFORCED RATHER THAN ASSUMED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   1. both allocations are complete — allocated AND closed
 *   2. both series are INDEPENDENTLY solvent, each verdict read from its own verifier
 *   3. the source series has opened redemption, because the conversion is derived from its factor
 *
 * A roll between insolvent series would move claims nobody can redeem, and `conversionWad` reverts
 * `SourceRedemptionNotOpen` rather than defaulting to par — a roll priced at par by accident moves
 * value between holder and supplier on every netting, silently and in one direction.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * NEITHER SUPPLY MOVES, AND THAT IS THE CLAIM A BURN-AND-MINT ROLL COULD NOT MAKE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Both legs are TRANSFERS out of escrow (delta U-2). `Nox.mint` and `Nox.burn` are the only
 * operations that touch `confidentialTotalSupply`, and both produce a new handle — so an unchanged
 * supply HANDLE says the operation never happened, which is stronger than an equal plaintext.
 *
 * No decrypted value reaches stdout or the evidence file.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { NOX_COMPUTE_BY_CHAIN, NOX_GATEWAY_BY_CHAIN } from "@kyrve/config";
import { createHandleClient, type Handle } from "@kyrve/nox";
import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import { assertBroadcastArmed, assertNoSecrets, safeErrorMessage, sepoliaRpc } from "../lib/env.js";
import { requireLayerFile } from "../lib/layer.js";
import { resolveRoles, signingKey } from "../lib/roles.js";
import { readJson, repoPath, stableStringify } from "../lib/shell.js";

const CHAIN_ID = 11_155_111;
const EXPLORER = "https://sepolia.etherscan.io";
const ZERO32 = `0x${"00".repeat(32)}` as Hex;
const WAD = 10n ** 18n;
const POLL = {
  policy: { initialDelayMs: 2_000, maxDelayMs: 20_000, multiplier: 2, timeoutMs: 600_000 },
} as const;
const ROLL_LIFETIME = 7n * 24n * 3600n;

function abiOf(name: string): readonly unknown[] {
  const path = repoPath(`confidential/artifacts/contracts/${name}.sol/${name}.json`);
  if (!existsSync(path)) throw new Error(`no artifact at ${path}; compile the confidential layer`);
  return readJson<{ abi: readonly unknown[] }>(path).abi;
}

interface LayerRecord {
  readonly seriesId: Hex;
  readonly contracts: Record<string, { address: Address }>;
}

async function main(): Promise<void> {
  assertBroadcastArmed();
  const rpc = sepoliaRpc();
  const client = createPublicClient({ chain: sepolia, transport: http(rpc.url) });
  if ((await client.getChainId()) !== CHAIN_ID) throw new Error("not Sepolia");

  const source = readJson<LayerRecord>(
    repoPath(
      requireLayerFile("deployments/sepolia/series.json", "layer A", "pnpm deploy:series sepolia"),
    ),
  );
  const target = readJson<LayerRecord>(
    repoPath(
      requireLayerFile(
        "deployments/sepolia/series-b.json",
        "layer B",
        "pnpm deploy:series sepolia --universe <id> --suffix b",
      ),
    ),
  );
  const market = readJson<{ contracts: Record<string, { address: Address }> }>(
    repoPath(
      requireLayerFile(
        "deployments/sepolia/market.json",
        "the market layer",
        "pnpm deploy:market sepolia",
      ),
    ),
  );

  if (source.seriesId.toLowerCase() === target.seriesId.toLowerCase()) {
    throw new Error("layer A and layer B name the SAME series — that is not a roll");
  }

  // ── PRECONDITION 1: both allocations complete ────────────────────────────────────────────
  for (const [label, path] of [
    ["layer A", "evidence/phase6/sepolia-allocation-a.json"],
    ["layer B", "evidence/phase6/sepolia-allocation-b.json"],
  ] as const) {
    const record = readJson<{ allocated: boolean; closed: boolean }>(
      repoPath(
        requireLayerFile(
          path,
          `${label}'s allocation`,
          `KYRVE_EVIDENCE_TAG=${label.slice(-1).toLowerCase()} pnpm test:sepolia-series-allocation`,
        ),
      ),
    );
    if (!record.allocated || !record.closed) throw new Error(`${label}'s allocation is incomplete`);
  }

  const rollBook = market.contracts["KyrveRollBook"]?.address;
  const sourceToken = source.contracts["KyrveSeriesToken"]?.address;
  const targetToken = target.contracts["KyrveSeriesToken"]?.address;
  if (rollBook === undefined || sourceToken === undefined || targetToken === undefined) {
    throw new Error("the records name no KyrveRollBook or series token");
  }

  const roles = resolveRoles("sepolia", { requireKeys: ["keeper", "curator"] });
  const keeper = privateKeyToAccount(signingKey(roles, "keeper"));
  const curator = privateKeyToAccount(signingKey(roles, "curator"));
  const holder = privateKeyToAccount((process.env["DUST_PRIVATE_KEY_1"] ?? "").trim() as Hex);
  const supplier = privateKeyToAccount((process.env["DUST_PRIVATE_KEY_2"] ?? "").trim() as Hex);

  const network = {
    chainId: CHAIN_ID,
    name: "ethereum-sepolia",
    noxCompute: NOX_COMPUTE_BY_CHAIN[CHAIN_ID] as Address,
    gatewayUrl: NOX_GATEWAY_BY_CHAIN[CHAIN_ID] as string,
  };
  const walletFor = (account: ReturnType<typeof privateKeyToAccount>) =>
    createWalletClient({ account, chain: sepolia, transport: http(rpc.url) });
  const holderWallet = walletFor(holder);
  const supplierWallet = walletFor(supplier);
  const keeperWallet = walletFor(keeper);
  const curatorWallet = walletFor(curator);
  const holderClient = await createHandleClient(holderWallet as never, network);
  const supplierClient = await createHandleClient(supplierWallet as never, network);
  const publicReader = await createHandleClient(keeperWallet as never, network);

  const tokenAbi = abiOf("KyrveSeriesToken");
  const rollAbi = abiOf("KyrveRollBook");
  const solvencyAbi = abiOf("AggregateSolvencyVerifier");

  console.log(`\nsepolia roll — layer A -> layer B — ${rpc.redacted}\n`);
  console.log(`  roll book   ${rollBook}`);
  console.log(`  source      ${sourceToken}  series ${source.seriesId.slice(0, 18)}…`);
  console.log(`  target      ${targetToken}  series ${target.seriesId.slice(0, 18)}…`);
  console.log(`  holder      ${holder.address}`);
  console.log(`  supplier    ${supplier.address}`);
  console.log(`  keeper      ${keeper.address}\n`);

  const steps: { name: string; tx?: Hex; gas?: string }[] = [];
  const send = async (
    account: ReturnType<typeof privateKeyToAccount>,
    w: ReturnType<typeof walletFor>,
    address: Address,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[],
  ): Promise<void> => {
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
    console.log(`     ${functionName.padEnd(22)} ${receipt.gasUsed} gas`);
  };

  /**
   * Simulates a call that MUST revert, and returns the custom error's name.
   *
   * A bare `try/catch` around a simulation proves only that something went wrong. The first run of
   * this driver "proved" that over-unwinding a residual is refused; the call had actually reverted
   * `IntentNotOpen` because the intent was already complete, so the ceiling was never tested at all.
   * Every refusal below therefore names the error it expects.
   */
  const expectRevert = async (
    address: Address,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[],
    account: ReturnType<typeof privateKeyToAccount>,
    expected: string,
  ): Promise<string> => {
    try {
      await client.simulateContract({
        address,
        abi: abi as never,
        functionName: functionName as never,
        args: args as never,
        account,
      });
    } catch (error: unknown) {
      const revert =
        error instanceof BaseError
          ? error.walk((e) => e instanceof ContractFunctionRevertedError)
          : undefined;
      const name =
        revert instanceof ContractFunctionRevertedError ? (revert.data?.errorName ?? "") : "";
      if (name !== expected) {
        throw new Error(
          `${functionName} was refused, but for the WRONG reason: expected ${expected}, got ` +
            `${name === "" ? safeErrorMessage(error) : name}. A refusal that fires for an unrelated ` +
            "reason proves nothing about the defence it is supposed to demonstrate.",
        );
      }
      return name;
    }
    throw new Error(`${functionName} was NOT refused; ${expected} never fired`);
  };

  // ── PRECONDITION 2: both series independently solvent ────────────────────────────────────
  const solvencyOf = async (record: LayerRecord, label: string): Promise<boolean> => {
    const verifier = record.contracts["AggregateSolvencyVerifier"]?.address;
    if (verifier === undefined) throw new Error(`${label} names no solvency verifier`);
    const count = (await client.readContract({
      address: verifier,
      abi: solvencyAbi as never,
      functionName: "snapshotCount",
    })) as number;
    if (Number(count) === 0) throw new Error(`${label} has never published a solvency verdict`);
    const snapshot = (await client.readContract({
      address: verifier,
      abi: solvencyAbi as never,
      functionName: "latestSnapshot",
    })) as Record<string, unknown>;
    const verdict = await publicReader.publicDecrypt(snapshot["verdictHandle"] as Handle, POLL);
    return verdict.value === 1n;
  };
  const sourceSolvent = await solvencyOf(source, "layer A");
  const targetSolvent = await solvencyOf(target, "layer B");
  if (!sourceSolvent || !targetSolvent) {
    throw new Error(
      `refusing to roll: layer A solvent=${sourceSolvent}, layer B solvent=${targetSolvent}. ` +
        "A roll between insolvent series moves claims nobody can redeem.",
    );
  }
  console.log("  1. both series are INDEPENDENTLY solvent, each verdict from its own verifier");

  // ── PRECONDITION 3: the source's redemption factor, from two LIVE public numbers ─────────
  //
  // WHAT THIS IS AND WHAT IT IS NOT. `setRedemptionFactor` documents `unitsWithdrawn` as the loan
  // assets the vault ACTUALLY received from Midnight. That withdrawal has not happened: the source
  // series has not reached maturity and `MaturityRedemptionQueue` is out of scope by owner decision
  // (Phase 5). So this opens redemption EARLY, against the credit Midnight has already recorded for
  // the series — not against a completed withdrawal, and the evidence file says exactly that.
  //
  // Both operands are read live from chain rather than copied out of an evidence file. `credit` is
  // `VAULT.positionOf(MARKET_ID)`, Midnight's own public ledger; the supply reference is the
  // published aggregate decrypted through the gateway. Reading them here rather than trusting a
  // recorded number is the whole point of Kyrve Verify, and this driver holds itself to it.
  const sourceVerifier = source.contracts["AggregateSolvencyVerifier"]?.address;
  if (sourceVerifier === undefined) throw new Error("layer A names no solvency verifier");
  let factor = (await client.readContract({
    address: sourceToken,
    abi: tokenAbi as never,
    functionName: "redemptionFactorWad",
  })) as bigint;
  const coverage = (await client.readContract({
    address: sourceVerifier,
    abi: solvencyAbi as never,
    functionName: "publicCoverage",
  })) as readonly bigint[];
  const recordedCredit = coverage[0] as bigint;
  // `publishedSupply()`, not `confidentialAggregateSupply()`. The live supply handle is admin-granted
  // to the token alone and is NOT publicly decryptable; publication isolates a separate snapshot
  // first, precisely so an irreversible `allowPublicDecryption` never lands on the live handle.
  const publishedSupply = (await client.readContract({
    address: sourceToken,
    abi: tokenAbi as never,
    functionName: "publishedSupply",
  })) as Handle;
  if (publishedSupply === ZERO32) {
    throw new Error("the source series has published no aggregate supply to derive a factor from");
  }
  const supplyReference = (await publicReader.publicDecrypt(publishedSupply, POLL)).value;
  if (recordedCredit === 0n || supplyReference === 0n) {
    throw new Error("the source series has no recorded credit or no published aggregate");
  }
  if (factor === 0n) {
    console.log(
      "  2. the curator opens the source series' redemption EARLY, against recorded credit",
    );
    await send(curator, curatorWallet, sourceToken, tokenAbi, "setRedemptionFactor", [
      recordedCredit,
      supplyReference,
    ]);
    factor = (await client.readContract({
      address: sourceToken,
      abi: tokenAbi as never,
      functionName: "redemptionFactorWad",
    })) as bigint;
  }
  if (factor === 0n) throw new Error("the source series still has no redemption factor");
  if (factor !== (recordedCredit * WAD) / supplyReference) {
    throw new Error("the factor on chain is not the two live public numbers this driver read");
  }

  const targetPrice = (await client.readContract({
    address: rollBook,
    abi: rollAbi as never,
    functionName: "TARGET_PRICE_WAD",
  })) as bigint;
  const conversion = (await client.readContract({
    address: rollBook,
    abi: rollAbi as never,
    functionName: "conversionWad",
  })) as bigint;
  if (conversion !== (factor * WAD) / targetPrice) {
    throw new Error("the book's conversion is not sourceFactor * WAD / targetPrice");
  }
  console.log("  2. the conversion is exactly the two public numbers, recomputed here");

  // ── Opening state ───────────────────────────────────────────────────────────────────────
  const readBalance = async (
    token: Address,
    who: Address,
    c: typeof holderClient,
  ): Promise<bigint> => {
    const h = (await client.readContract({
      address: token,
      abi: tokenAbi as never,
      functionName: "confidentialBalanceOf",
      args: [who] as never,
    })) as Handle;
    return h === ZERO32 ? 0n : c.decrypt(h, POLL);
  };
  const supplyHandle = async (token: Address): Promise<Handle> =>
    (await client.readContract({
      address: token,
      abi: tokenAbi as never,
      functionName: "confidentialAggregateSupply",
    })) as Handle;

  const sourceSupplyBefore = await supplyHandle(sourceToken);
  const targetSupplyBefore = await supplyHandle(targetToken);
  const holderSourceBefore = await readBalance(sourceToken, holder.address, holderClient);
  const holderTargetBefore = await readBalance(targetToken, holder.address, holderClient);
  const supplierSourceBefore = await readBalance(sourceToken, supplier.address, supplierClient);
  const supplierTargetBefore = await readBalance(targetToken, supplier.address, supplierClient);

  if (holderSourceBefore === 0n) throw new Error("the holder holds no source claim");
  if (supplierTargetBefore === 0n) throw new Error("the supplier holds no target inventory");
  console.log("  3. the holder holds a source claim and the supplier holds target inventory");

  // Sized so the intent EXCEEDS what the supply can absorb, leaving a residual for the public leg.
  const intentQty = holderSourceBefore / 2n;
  const supplyQty = supplierTargetBefore / 5n;
  const absorbable = (supplyQty * WAD) / conversion;
  const consumedSource = intentQty < absorbable ? intentQty : absorbable;
  const movedTarget = (consumedSource * conversion) / WAD;
  if (consumedSource === 0n) throw new Error("the fixture nets nothing");
  if (intentQty - consumedSource === 0n) throw new Error("the fixture leaves no residual");

  // ── 4. The intent ───────────────────────────────────────────────────────────────────────
  //
  // WHY THIS DRIVER ALWAYS OPENS A FRESH INTENT AND A FRESH SUPPLY, AND NEVER ADOPTS.
  //
  // Adopting looked right and was wrong twice. `SupplyState.Open` is public while the escrow is
  // encrypted, so a supply an earlier roll drained stays Open forever — the contract cannot say
  // otherwise without leaking a balance. Worse, netting leaves floor-division DUST behind, so even
  // "escrow decrypts above zero" does not mean the supply can still move anything meaningful: a
  // second netting against dust moves nothing and reports success.
  //
  // And conservation here is measured as a delta across THIS run. An adopted intent whose netting
  // already happened would have that delta be zero while every public state check still passed.
  // Resumability is proven where it can be measured honestly — the residual is unwound halfway,
  // stopped, and finished from chain state alone — not by carrying state between runs.
  const expiry = (await client.getBlock()).timestamp + ROLL_LIFETIME;
  const idAt = async (fn: string, who: Address, seq: bigint): Promise<Hex> =>
    (await client.readContract({
      address: rollBook,
      abi: rollAbi as never,
      functionName: fn as never,
      args: [who, seq] as never,
    })) as Hex;
  const nonceOf = async (who: Address): Promise<bigint> =>
    (await client.readContract({
      address: rollBook,
      abi: rollAbi as never,
      functionName: "nextNonce",
      args: [who] as never,
    })) as bigint;
  const sequenceOf = async (who: Address): Promise<bigint> =>
    (await client.readContract({
      address: rollBook,
      abi: rollAbi as never,
      functionName: "submittedBy",
      args: [who] as never,
    })) as bigint;

  const intentId = await idAt("intentIdFor", holder.address, await sequenceOf(holder.address));
  console.log("  4. the holder escrows their source claim");
  {
    const until = (await client.getBlock()).timestamp + 3600n;
    await send(holder, holderWallet, sourceToken, tokenAbi, "setOperator", [rollBook, until]);
    const encrypted = await holderClient.encrypt(intentQty, "euint256", rollBook);
    await send(holder, holderWallet, rollBook, rollAbi, "submitIntent", [
      encrypted.handle,
      encrypted.proof,
      expiry,
      await nonceOf(holder.address),
    ]);
    await send(holder, holderWallet, sourceToken, tokenAbi, "setOperator", [rollBook, 0n]);
  }

  // ── 5. The target inventory ─────────────────────────────────────────────────────────────
  const supplyId = await idAt("supplyIdFor", supplier.address, await sequenceOf(supplier.address));
  console.log("  5. the supplier escrows target inventory");
  {
    const until = (await client.getBlock()).timestamp + 3600n;
    await send(supplier, supplierWallet, targetToken, tokenAbi, "setOperator", [rollBook, until]);
    const encrypted = await supplierClient.encrypt(supplyQty, "euint256", rollBook);
    await send(supplier, supplierWallet, rollBook, rollAbi, "supplyTarget", [
      encrypted.handle,
      encrypted.proof,
      expiry,
      await nonceOf(supplier.address),
    ]);
    await send(supplier, supplierWallet, targetToken, tokenAbi, "setOperator", [rollBook, 0n]);
  }

  // ── 6. Netting, and the retry that must be refused ──────────────────────────────────────
  const opening = (await client.readContract({
    address: rollBook,
    abi: rollAbi as never,
    functionName: "statusOf",
    args: [intentId] as never,
  })) as unknown[];
  if (Number(opening[2]) !== 0) {
    throw new Error(
      "a freshly opened intent already reports a netting; the id derivation is wrong",
    );
  }
  console.log("  6. the keeper nets internal liquidity FIRST");
  await send(keeper, keeperWallet, rollBook, rollAbi, "netRoll", [intentId, supplyId, 0]);
  const netCount = 1;

  // Asserted here, while the intent is still Open. Once it completes this same call reverts
  // `IntentNotOpen` and would "pass" without ever reaching the index check.
  const staleError = await expectRevert(
    rollBook,
    rollAbi,
    "netRoll",
    [intentId, supplyId, 0],
    keeper,
    "StaleNetIndex",
  );
  console.log(`  7. a retried netting at a stale index is REFUSED (${staleError})`);

  // ── 8. Conservation, and the supplies that must not have moved ──────────────────────────
  const holderTargetAfter = await readBalance(targetToken, holder.address, holderClient);
  const supplierSourceAfter = await readBalance(sourceToken, supplier.address, supplierClient);
  const sourceSupplyAfter = await supplyHandle(sourceToken);
  const targetSupplyAfter = await supplyHandle(targetToken);

  const targetToHolder = holderTargetAfter - holderTargetBefore;
  const sourceToSupplier = supplierSourceAfter - supplierSourceBefore;
  const conservesUnderConversion = targetToHolder === (sourceToSupplier * conversion) / WAD;
  const sourceSupplyUnchanged = sourceSupplyAfter === sourceSupplyBefore;
  const targetSupplyUnchanged = targetSupplyAfter === targetSupplyBefore;

  for (const [what, ok] of [
    ["the supplier received the source claims the netting consumed", sourceToSupplier > 0n],
    ["the holder received the target claims the conversion bought", targetToHolder > 0n],
    ["value is conserved under the DECLARED conversion", conservesUnderConversion],
    [
      "the SOURCE series' live supply handle is UNCHANGED — nothing was burned",
      sourceSupplyUnchanged,
    ],
    [
      "the TARGET series' live supply handle is UNCHANGED — nothing was minted",
      targetSupplyUnchanged,
    ],
  ] as const) {
    if (!ok) throw new Error(`roll conservation FAILED: ${what} is false`);
    console.log(`  8. ${what}`);
  }

  // ── 9. The explicit public residual ─────────────────────────────────────────────────────
  const statusAfter = (await client.readContract({
    address: rollBook,
    abi: rollAbi as never,
    functionName: "statusOf",
    args: [intentId] as never,
  })) as unknown[];
  let residualHandle = statusAfter[3] as Handle;
  if (residualHandle === ZERO32) {
    console.log("  9. the holder declares the residual publicly (IRREVERSIBLE)");
    await send(holder, holderWallet, rollBook, rollAbi, "declareResidual", [intentId]);
    residualHandle = (
      (await client.readContract({
        address: rollBook,
        abi: rollAbi as never,
        functionName: "statusOf",
        args: [intentId] as never,
      })) as unknown[]
    )[3] as Handle;
  } else {
    console.log("  9. adopted the already-declared residual");
  }

  const decrypted = await publicReader.publicDecrypt(residualHandle, POLL);
  const alreadyUnwound = (
    (await client.readContract({
      address: rollBook,
      abi: rollAbi as never,
      functionName: "statusOf",
      args: [intentId] as never,
    })) as unknown[]
  )[4] as bigint;
  // Unwound in TWO calls, on purpose. No atomicity is claimed for a roll, so the interesting
  // property is not that the residual can be returned — it is that the return can stop halfway and
  // be finished later from chain state alone. The second call passes the SAME published amount and
  // the SAME replayable proof; the contract's own running total is what bounds it.
  const readStatus = async (): Promise<unknown[]> =>
    (await client.readContract({
      address: rollBook,
      abi: rollAbi as never,
      functionName: "statusOf",
      args: [intentId] as never,
    })) as unknown[];

  const half = decrypted.value / 2n;
  if (half === 0n) throw new Error("the residual is too small to settle in two parts");
  if (alreadyUnwound === 0n) {
    console.log("  10. the holder unwinds HALF the residual in the open, then stops");
    await send(holder, holderWallet, rollBook, rollAbi, "settleResidual", [
      intentId,
      half,
      decrypted.decryptionProof,
    ]);
  } else {
    console.log("  10. adopted a partly-unwound residual");
  }

  const midStatus = await readStatus();
  const interrupted = { unwound: String(midStatus[4]), next: Number(midStatus[5]) };

  // The ceiling, tested in the only window where it can bind: the intent is still ResidualDeclared,
  // so `settleResidual` reaches the published-total check instead of failing the state check first.
  // The proof passed here is the SAME one the gateway issued — it is replayable by anyone forever
  // (`.claude/rules/security.md`), and the contract's own running total is the only thing bounding it.
  const overUnwindError = await expectRevert(
    rollBook,
    rollAbi,
    "settleResidual",
    [intentId, decrypted.value + 1n, decrypted.decryptionProof],
    holder,
    "ResidualExceeded",
  );
  console.log(`  11. unwinding BEYOND the published residual is REFUSED (${overUnwindError})`);

  // The resumption. Nothing was carried over in memory — the remaining amount is the published
  // total minus what the contract says it already paid out.
  const remaining = decrypted.value - (midStatus[4] as bigint);
  if (remaining > 0n) {
    console.log("  12. the roll RESUMES from chain state and finishes the residual");
    await send(holder, holderWallet, rollBook, rollAbi, "settleResidual", [
      intentId,
      remaining,
      decrypted.decryptionProof,
    ]);
  } else {
    console.log("  12. the residual was already fully unwound");
  }

  const finalStatus = await readStatus();

  const evidence = {
    $comment:
      "The smallest real coherent Roll on Ethereum Sepolia, between two series that share NO " +
      "contract. NO PRIVATE QUANTITY APPEARS HERE. Conservation was evaluated in memory from " +
      "balances each party decrypted for themselves; only verdicts are recorded. The residual is " +
      "public by the holder's own irreversible choice and is the only amount here.",
    scope:
      "One intent against one supply, at the smallest size exercising every path. NO PRODUCTION-" +
      "SCALE THROUGHPUT IS CLAIMED. The expensive part of a larger roll is repeating the whole " +
      "confidential issuance stack per maturity (delta U-1), not an unimplemented feature.",
    chainId: CHAIN_ID,
    rollBook,
    sourceSeriesId: source.seriesId,
    targetSeriesId: target.seriesId,
    sourceToken,
    targetToken,
    seriesAreDistinct: source.seriesId !== target.seriesId,
    holder: holder.address,
    supplier: supplier.address,
    keeper: keeper.address,
    sourceRedemptionFactorWad: factor.toString(),
    sourceRedemptionOpenedEarly:
      "The source series has NOT matured and has NOT withdrawn from Midnight. " +
      "MaturityRedemptionQueue is out of scope by owner decision (Phase 5). The factor is derived " +
      "from the credit Midnight has ALREADY recorded for the series (VAULT.positionOf) over the " +
      "published aggregate — both read live from chain by this driver, not copied from a record.",
    sourceRecordedCredit: recordedCredit.toString(),
    sourceSupplyReference: supplyReference.toString(),
    factorReproducible: factor === (recordedCredit * WAD) / supplyReference,
    targetPriceWad: targetPrice.toString(),
    conversionWad: conversion.toString(),
    conversionReproducible: conversion === (factor * WAD) / targetPrice,
    sourceSolvent,
    targetSolvent,
    intentId,
    supplyId,
    netCount,
    staleNetIndexRefused: staleError === "StaleNetIndex",
    conservesUnderConversion,
    sourceSupplyUnchanged,
    targetSupplyUnchanged,
    residualHandle,
    residualPublished: decrypted.value.toString(),
    residualUnwound: String(finalStatus[4]),
    interruptedAt: interrupted,
    resumedFromChainState: interrupted.unwound !== String(finalStatus[4]),
    overUnwindRefused: overUnwindError === "ResidualExceeded",
    refusalsAssertedByName: { staleNetIndex: staleError, overUnwind: overUnwindError },
    intentState: Number(finalStatus[0]),
    atomicity:
      "NONE CLAIMED. A full roll is escrow, netting and a publicly declared unwind — separate " +
      "transactions. This run PROVES the consequence rather than asserting it: the residual was " +
      "unwound halfway, stopped, and finished from chain state alone with nothing carried over in " +
      "memory. netRoll refuses a stale index so a retry cannot net twice, and settleResidual " +
      "refuses to pay past the published total even though its proof is replayable forever.",
    steps,
    explorer: `${EXPLORER}/address/${rollBook}`,
    measuredAt: new Date().toISOString(),
  };
  const payload = `${stableStringify(evidence)}\n`;
  assertNoSecrets(payload, "evidence/phase6/sepolia-roll.json");
  mkdirSync(repoPath("evidence/phase6"), { recursive: true });
  writeFileSync(repoPath("evidence/phase6/sepolia-roll.json"), payload);

  console.log(`\n  recorded in evidence/phase6/sepolia-roll.json\n`);
}

main().catch((error: unknown) => {
  console.error(`\nsepolia roll FAILED — ${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
});
