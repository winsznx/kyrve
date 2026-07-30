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

import {
  type CurveHarness,
  type EpochState,
  openAndSeal,
  type PollOptions,
  runEpoch,
  type SealedProviderState,
  setupBorrower,
} from "./curve-helpers.js";
import { clientFor, mine, ROLE_INDEX, SUITE_POLL } from "./helpers.js";
import {
  activateQuote,
  collectPublicResult,
  type createSettlementUniverse,
  foundryArtifactAbi,
  type SettlementHarness,
  supplyCollateral,
} from "./settlement-helpers.js";

export interface SeriesLayer {
  readonly token: any;
  readonly ownership: any;
  readonly allocator: any;
  readonly residue: any;
  readonly solvency: any;
  /** Phase 6. Frozen selective disclosure over this series. */
  readonly capsules: any;
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
  /**
   * THE DEPLOYER AND THE CURATOR ARE DIFFERENT WALLETS FROM PHASE 6.
   *
   * Every `bind*` call below is `onlyDeployer`; `setRedemptionFactor` and `publishAggregateSupply`
   * are `onlyCurator`. Through Phase 5 both were wallet 0, so the suite could not have detected a
   * contract that gated the wrong one — and it would have passed either way. It cannot now.
   */
  const deployerWallet = h.wallets[ROLE_INDEX.deployer];
  const curator = h.wallets[ROLE_INDEX.curator];
  const keeper = h.wallets[args.keeperIndex ?? ROLE_INDEX.keeper];
  const beneficiary = h.wallets[args.beneficiaryIndex ?? ROLE_INDEX.residueBeneficiary].account
    .address as `0x${string}`;

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

  const asDeployer = { account: deployerWallet.account };
  await record(await token.write.bindAllocator([allocator.address], asDeployer));
  await record(await token.write.bindSolvencyVerifier([solvency.address], asDeployer));
  await record(await ownership.write.bindAllocator([allocator.address], asDeployer));
  await record(await allocator.write.bindResidueAccount([residue.address], asDeployer));
  // The custody vault's settler. Bound once, to the allocator, and never again — the settler is the
  // only address that can consume a lock, so a mutable one would be an arbitrary-spend surface over
  // every locked balance (threat T-B).
  await record(await h.custody.write.bindSettler([allocator.address], asDeployer));

  /**
   * PHASE 6. The capsule vault comes last because it reads five of the contracts above in its
   * constructor and checks every one against this series id — a vault wired to another series'
   * token would freeze the wrong position under the right name.
   *
   * `bindCapsuleVault` is the token's fourth one-shot binding. The vault is deliberately NOT added
   * to `isReviewedTransientRecipient`: it never receives a handle it could publish, because the
   * only grant a capsule makes is made by the token itself, on a handle the holder asked it to
   * freeze for them. Finding F-1's shape, avoided rather than mitigated.
   */
  const deploymentId = (await s.registry.read.DEPLOYMENT_ID()) as `0x${string}`;
  const capsules = await h.connection.viem.deployContract("KyrveCapsuleVault", [
    args.seriesId,
    args.marketId,
    deploymentId,
    token.address,
    ownership.address,
    solvency.address,
    residue.address,
    args.vaultAddress,
    curator.account.address,
  ]);
  await record(await token.write.bindCapsuleVault([capsules.address], asDeployer));

  const vault = getContract({
    address: args.vaultAddress,
    abi: foundryArtifactAbi("KyrveSeriesVault"),
    client: { public: h.publicClient, wallet: h.wallets[ROLE_INDEX.deployer] },
  });

  return {
    token,
    ownership,
    allocator,
    residue,
    solvency,
    capsules,
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

/**
 * One complete issuance lifecycle: request, epoch, series, funding, activation, settlement, allocation.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * EXTRACTED, NOT WRITTEN
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * This is the closure `130-roll.ts` used to carry inline, moved here verbatim so the Roll suite and
 * the local stack host share ONE implementation. The extraction is checked by the Roll suite still
 * passing: two copies of a fixture this expensive drift, and the drift shows up as a stack whose
 * series was built differently from the series every assertion was written against.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE ORDER IS NOT ARBITRARY
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The series is created and funded BEFORE activation, because `QuoteActivator.activate` calls
 * `prepareQuote`, which refuses a vault that cannot already pay. Funding keyed on the quote would
 * deadlock: the money has to land before a quote id exists (delta T-9).
 *
 * `fund: false` throughout. The vault's balance arrives from `fundQuoteFromCustody` — real locked
 * confidential capital, unwrapped through the real wrapper — rather than from a mint.
 */
export async function runIssuanceLifecycle(
  layer: CurveHarness,
  settlement: SettlementHarness,
  providers: readonly SealedProviderState[],
  borrowerIndex: number,
  preferredMaturityIndex: number,
  markets: { market: any; marketId: `0x${string}` }[],
  created: Awaited<ReturnType<typeof createSettlementUniverse>>,
  request: { desiredAssets: bigint; minimumAssets: bigint; maxRateIndexes: number[] },
): Promise<SeriesLayer & { quoteId: `0x${string}`; epoch: EpochState; exactUnits: bigint }> {
  const borrower = await setupBorrower(layer, created.universeId, borrowerIndex, {
    ...request,
    preferredMaturityIndex,
  });

  const epoch = await openAndSeal(layer, created.universeId, created.universe, providers, borrower);
  await runEpoch(layer, epoch);
  const result = await collectPublicResult(layer, epoch.epochId);

  const winning = markets[result.marketIndex];
  assert.ok(winning !== undefined, "the published market index must name a deployed market");
  const seriesId = (await settlement.factory.read.seriesIdFor([winning.marketId])) as `0x${string}`;
  await mine(
    layer,
    await settlement.factory.write.createSeries(
      [winning.marketId, settlement.usdc.address, settlement.operator],
      { account: settlement.curator.account },
    ),
  );
  const vaultAddress = (await settlement.factory.read.vaultOf([seriesId])) as `0x${string}`;

  const series = await deploySeriesLayer(layer, settlement, {
    seriesId,
    marketId: winning.marketId,
    vaultAddress,
    loanToken: settlement.usdc.address as `0x${string}`,
  });

  await fundQuoteFromCustody(layer, series, epoch.epochId, providers.length);
  const quote = await activateQuote(layer, settlement, epoch, created.universe, result, markets, {
    fund: false,
  });

  const borrowerWallet = layer.wallets[borrowerIndex];
  await supplyCollateral(layer, settlement, quote.market, borrowerWallet, quote.exactUnits);
  await mine(
    layer,
    await settlement.midnight.write.take(
      [
        quote.offer,
        "0x",
        quote.exactUnits,
        borrowerWallet.account.address,
        borrowerWallet.account.address,
        "0x0000000000000000000000000000000000000000",
        "0x",
      ],
      { account: borrowerWallet.account, gas: 15_000_000n },
    ),
  );
  await allocateSeries(layer, series, quote.quoteId, providers.length);

  return { ...series, quoteId: quote.quoteId, epoch, exactUnits: quote.exactUnits };
}
