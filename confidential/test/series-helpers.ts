/**
 * The Phase 5 harness: confidential series ownership over a REAL settled Midnight position.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS ADDS TO THE PHASE 4 HARNESS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Phase 4 funded a quote by MINTING public USDC straight into the series vault — `activateQuote`'s
 * `fund` option — because Phase 4 deliberately had no confidential funding path (delta S-6). Phase 5
 * has one, so every helper here passes `fund: false` and the vault's balance arrives from
 * {fundQuoteFromCustody}: real locked confidential capital, unwrapped through the real wrapper, with
 * a real gateway proof finalising the ERC-20 transfer.
 *
 * That difference is the phase. A suite that kept the mint would prove the series token works and
 * would prove nothing about where the money came from.
 */

import assert from "node:assert/strict";

import type { Handle } from "@kyrve/nox";
import { getContract } from "viem";

import type { CurveHarness, PollOptions } from "./curve-helpers.js";
import { clientFor, mine, SUITE_POLL } from "./helpers.js";
import { foundryArtifactAbi, type SettlementHarness } from "./settlement-helpers.js";

export interface SeriesLayer {
  readonly token: any;
  readonly ownership: any;
  readonly allocator: any;
  readonly residue: any;
  readonly solvency: any;
  readonly seriesId: `0x${string}`;
  readonly marketId: `0x${string}`;
  readonly vault: any;
  /** Where the residue account is declared to send everything, fixed at deployment. */
  readonly beneficiary: `0x${string}`;
  readonly keeper: any;
  readonly curator: any;
  readonly deploymentGas: bigint;
}

/**
 * Deploys the Phase 5 series layer for ONE series and binds every one-shot reference.
 *
 * The order is forced by five bind-once cycles and is the same order `scripts/deploy/series.ts` uses.
 * Nothing here is re-bindable, nothing has an owner, and every binding reverts forever after:
 *
 *   token            -> needs nothing
 *   ownership        -> needs nothing
 *   allocator        -> needs token, ownership, custody, the curve layer and the quote registry
 *   residue account  -> needs the allocator, because the allocator is its only recorder
 *   solvency         -> needs the token, custody, the vault and the residue account
 *   then: token.bindAllocator, token.bindSolvencyVerifier, ownership.bindAllocator,
 *         allocator.bindResidueAccount, custody.bindSettler
 *
 * The residue account cannot be a constructor argument of the allocator and the allocator cannot be
 * one of the residue account's, so one of the two references is bound after the fact. The allocator's
 * is, because the residue account's `RECORDER` is the stronger authority and belongs in immutable
 * storage set at construction.
 */
export async function deploySeriesLayer(
  h: CurveHarness,
  s: SettlementHarness,
  args: {
    readonly seriesId: `0x${string}`;
    readonly marketId: `0x${string}`;
    readonly vaultAddress: `0x${string}`;
    readonly loanToken: `0x${string}`;
    /** Where the residue account is declared to send everything, fixed at deployment. */
    readonly beneficiaryIndex?: number;
    readonly keeperIndex?: number;
  },
): Promise<SeriesLayer> {
  let deploymentGas = 0n;
  const curator = h.wallets[0];
  const keeper = h.wallets[args.keeperIndex ?? 9];
  const beneficiary = h.wallets[args.beneficiaryIndex ?? 7].account.address as `0x${string}`;

  const record = async (hash: `0x${string}`): Promise<any> => {
    const receipt = await mine(h, hash);
    deploymentGas += receipt.gasUsed as bigint;
    return receipt;
  };

  const token = await h.connection.viem.deployContract("KyrveSeriesToken", [
    "Kyrve Series",
    "kSER",
    "",
    args.seriesId,
    args.loanToken,
    curator.account.address,
    h.controller.address,
  ]);
  const ownership = await h.connection.viem.deployContract("SeriesOwnershipRegistry", [
    args.seriesId,
    h.controller.address,
  ]);
  const allocator = await h.connection.viem.deployContract("SeriesAllocator", [
    args.seriesId,
    h.custody.address,
    token.address,
    ownership.address,
    h.epochs.address,
    h.graph.address,
    h.ledger.address,
    s.registry.address,
    args.vaultAddress,
    args.marketId,
    keeper.account.address,
    h.controller.address,
  ]);
  const residue = await h.connection.viem.deployContract("SeriesResidueAccount", [
    args.seriesId,
    args.loanToken,
    beneficiary,
    allocator.address,
  ]);
  const solvency = await h.connection.viem.deployContract("AggregateSolvencyVerifier", [
    args.seriesId,
    args.marketId,
    token.address,
    h.custody.address,
    args.vaultAddress,
    residue.address,
    h.controller.address,
  ]);

  await record(await token.write.bindAllocator([allocator.address], { account: curator.account }));
  await record(
    await token.write.bindSolvencyVerifier([solvency.address], { account: curator.account }),
  );
  await record(
    await ownership.write.bindAllocator([allocator.address], { account: curator.account }),
  );
  await record(
    await allocator.write.bindResidueAccount([residue.address], { account: curator.account }),
  );
  // The custody vault's settler. Bound once, to the allocator, and never again — the settler is the
  // only address that can consume a lock, so a mutable one would be an arbitrary-spend surface over
  // every locked balance (threat T-B).
  await record(
    await h.custody.write.bindSettler([allocator.address], { account: curator.account }),
  );

  const vault = getContract({
    address: args.vaultAddress,
    abi: foundryArtifactAbi("KyrveSeriesVault"),
    client: { public: h.publicClient, wallet: h.wallets[0] },
  });

  return {
    token,
    ownership,
    allocator,
    residue,
    solvency,
    seriesId: args.seriesId,
    marketId: args.marketId,
    vault,
    beneficiary,
    keeper,
    curator,
    deploymentGas,
  };
}

export interface CustodyFunding {
  /** The publicly-decryptable handle whose plaintext is the funding. Public FOREVER from here. */
  readonly unwrapRequest: Handle;
  /** That plaintext, read back through the real gateway. Must equal the published aggregate. */
  readonly unwrapped: bigint;
  /** The vault's loan-token balance after `finalizeUnwrap` landed. */
  readonly vaultBalance: bigint;
  readonly consumeGas: bigint;
  readonly unwrapGas: bigint;
  readonly finalizeGas: bigint;
}

/**
 * Funds one epoch's round entirely from locked confidential capital — the whole point of Phase 5.
 *
 * KEYED ON THE EPOCH, NOT THE QUOTE, and the ordering forces it: `QuoteActivator.activate` calls
 * `KyrveSeriesVault.prepareQuote`, which refuses a vault that cannot already pay, so the funding must
 * land before a quote id exists. Delta T-9.
 *
 * Four steps and none of them is optional:
 *
 *   1. `consumeChunk`         each provider's lock leaves `locked` and joins the round's total.
 *   2. `unwrapFunding`        the total burns from the wrapper and its handle is marked publicly
 *                             decryptable. IRREVERSIBLE — Nox has no un-publish.
 *   3. gateway `publicDecrypt` reads the plaintext, which is the proof of invariant 1: it must equal
 *                             the epoch's published aggregate, exactly.
 *   4. `finalizeUnwrap`       moves the real ERC-20 to the series vault. PERMISSIONLESS — the
 *                             recipient was fixed in step 2 and cannot be redirected, so a stalled
 *                             keeper cannot strand the funding.
 */
export async function fundQuoteFromCustody(
  h: CurveHarness,
  series: SeriesLayer,
  epochId: `0x${string}`,
  providerCount: number,
  poll: PollOptions = SUITE_POLL,
): Promise<CustodyFunding> {
  const consume = await mine(
    h,
    await series.allocator.write.consumeChunk([epochId, 0, providerCount], {
      account: series.keeper.account,
    }),
  );

  const unwrap = await mine(
    h,
    await series.allocator.write.unwrapFunding([epochId], { account: series.keeper.account }),
  );
  const unwrapRequest = (await h.custody.read.unwrapRequestOf([epochId])) as Handle;
  assert.notEqual(
    unwrapRequest,
    `0x${"00".repeat(32)}`,
    "the unwrap must record a burn-amount handle",
  );

  // The recipient is read from the wrapper rather than assumed: `_unwrap` stores it, and a helper
  // that assumed it would not notice a redirected transfer.
  assert.equal(
    ((await h.asset.read.unwrapRequester([unwrapRequest])) as string).toLowerCase(),
    (series.vault.address as string).toLowerCase(),
    "the unwrap recipient must be the series vault",
  );

  const client = await clientFor(h, 0);
  const decrypted = await client.publicDecrypt(unwrapRequest, poll);

  const finalize = await mine(
    h,
    await h.asset.write.finalizeUnwrap([unwrapRequest, decrypted.decryptionProof], {
      account: h.wallets[0].account,
    }),
  );

  // `availableFunding` nets off funding committed to live quotes. At this point no quote exists —
  // the whole reason funding is keyed on the epoch (delta T-9) — so it is the whole balance.
  const vaultBalance = (await series.vault.read.availableFunding()) as bigint;

  return {
    unwrapRequest,
    unwrapped: decrypted.value,
    vaultBalance,
    consumeGas: consume.gasUsed as bigint,
    unwrapGas: unwrap.gasUsed as bigint,
    finalizeGas: finalize.gasUsed as bigint,
  };
}

/** Mints the confidential claims for a settled quote and seals the allocation. */
export async function allocateSeries(
  h: CurveHarness,
  series: SeriesLayer,
  quoteId: `0x${string}`,
  providerCount: number,
): Promise<{ residue: bigint; allocateGas: bigint; closeGas: bigint }> {
  const allocate = await mine(
    h,
    await series.allocator.write.allocateChunk([quoteId, 0, providerCount], {
      account: series.keeper.account,
    }),
  );
  const close = await mine(
    h,
    await series.allocator.write.closeQuote([quoteId], { account: series.keeper.account }),
  );

  return {
    residue: (await series.residue.read.recordedResidue([quoteId])) as bigint,
    allocateGas: allocate.gasUsed as bigint,
    closeGas: close.gasUsed as bigint,
  };
}

/**
 * Decrypts one provider's confidential series balance, as that provider.
 *
 * The client is bound to the provider's own wallet, so a refusal here is the gateway refusing that
 * wallet rather than a test-harness artefact. Demonstration 9 uses the same function with a wallet
 * that holds no grant, and asserts it fails.
 */
export async function readSeriesBalance(
  h: CurveHarness,
  series: SeriesLayer,
  walletIndex: number,
  holder: `0x${string}`,
  poll: PollOptions = SUITE_POLL,
): Promise<bigint> {
  const handle = (await series.token.read.confidentialBalanceOf([holder])) as Handle;
  assert.notEqual(handle, `0x${"00".repeat(32)}`, `${holder} has no series balance handle`);
  const client = await clientFor(h, walletIndex);
  return client.decrypt(handle, poll);
}
