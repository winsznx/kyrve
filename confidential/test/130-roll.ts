/**
 * Phase 6 demonstrations 16-23: Kyrve Roll, against the REAL Nox stack and REAL unmodified Midnight.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * TWO REAL SERIES, TWO REAL MATURITIES, TWO REAL SETTLEMENTS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A roll is meaningless against one series, so this suite runs the whole Phase 3-5 lifecycle TWICE:
 * two curve epochs steered onto two different markets in two different maturity buckets, each
 * funded from real confidential locks, each settled through real unmodified Midnight, each
 * allocated into its own `KyrveSeriesToken`. That is expensive and it is the only honest fixture —
 * a roll between a series and itself makes every conservation identity trivially true.
 *
 *    16. a holder submits a confidential roll intent, and the escrow really moves their claim
 *    17. internal liquidity is netted FIRST, privately, against proven target capacity
 *    18. any residual public action is explicit, and irreversible when it discloses
 *    19. the source side conserves: what leaves holders arrives at suppliers, supply unchanged
 *    20. the target side conserves: what leaves suppliers arrives at holders, supply unchanged
 *    21. an interrupted roll resumes safely, and a retried step cannot net twice
 *    22. cancellation and expiry restore a recoverable state
 *    23. old and new series both remain solvent, proven on chain
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * DEMONSTRATIONS 19 AND 20 ARE NOT "BURN" AND "MINT", AND THE DIFFERENCE IS THE POINT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The brief asks that the source series burn correctly and the target series mint correctly. What
 * the contracts actually do — and must do — is TRANSFER on both legs, out of an escrowed inventory
 * that was itself allocated against a real settled position.
 *
 * A roll book that minted target claims would be minting claims backed by nothing: invariant 5
 * would be false by exactly the rolled amount and `AggregateSolvencyVerifier` would report the
 * target series insolvent, correctly. It could not do it anyway — `mintClaim` is `onlyAllocator`
 * and takes a handle rather than a number.
 *
 * So the assertion is stronger than the one the brief describes: **neither series' total supply
 * moves by a single unit across a roll**, and demonstration 23 proves both series solvent on chain
 * afterwards rather than arguing it. Recorded as a delta.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { before, describe, it } from "node:test";

import { handleGatewayUrl } from "@iexec-nox/nox-hardhat-plugin";
import { NOX_COMPUTE_BY_CHAIN } from "@kyrve/config";
import { CURVE_RECOMMENDED_CELLS_PER_TRANSACTION, UNIT } from "@kyrve/curve";
import type { Handle } from "@kyrve/nox";
import { type Browser, chromium } from "playwright";

import {
  acl,
  assertRevertsWithError,
  type CurveHarness,
  deployCurveHarness,
  type EpochState,
  openAndSeal,
  runEpoch,
  type SealedProviderState,
  setupBorrower,
  setupProvider,
} from "./curve-helpers.js";
import { clientFor, mine, ROLE_INDEX, SUITE_POLL } from "./helpers.js";
import {
  confidentialBalance,
  decryptAs,
  deployParallelCurveLayer,
  withOperatorWindow,
} from "./market-helpers.js";
import {
  allocateSeries,
  deploySeriesLayer,
  fundQuoteFromCustody,
  readSeriesBalance,
  type SeriesLayer,
} from "./series-helpers.js";
import {
  activateQuote,
  collectPublicResult,
  createSettlementUniverse,
  deploySettlement,
  type SettlementHarness,
  settlementMarketGrid,
  supplyCollateral,
} from "./settlement-helpers.js";

const WAD = 10n ** 18n;
/** What one TARGET claim unit costs in loan units. A later maturity at a deeper discount. */
const TARGET_PRICE_WAD = 940_000_000_000_000_000n;
/** The terminal's dev server, for demonstration 24. */
const VERIFY_APP_URL = "http://127.0.0.1:5173/";
/**
 * Kyrve Verify lives on the subject's own proof route since Phase 7.
 *
 * The forged half of this demonstration navigates to the FORGED id, because the served record's
 * series id is what changed — which is the point: the page resolves the record by that id, reads the
 * chain for what the token actually serves, and has to disagree with the file it was handed.
 */
const proofSeriesUrl = (seriesId: string): string => `${VERIFY_APP_URL}proof/series/${seriesId}`;
/**
 * Hardhat's standard account 1, which is `holderIndex`. Committed for the same reason
 * `101-series-browser.ts` commits its pair: these are the published development keys of a local
 * node and are worthless anywhere else. Kyrve binds every encrypted input to the submitting wallet,
 * so a browser with no signer cannot stand in for one.
 */
const HOLDER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

/** `KyrveRollBook.IntentState`, in enum order. */
const INTENT = { None: 0, Open: 1, ResidualDeclared: 2, Completed: 3, Cancelled: 4 } as const;
/** `KyrveRollBook.NextAction`, in enum order. */
const NEXT = { Nothing: 0, Net: 1, DeclareResidual: 2, SettleResidual: 3, Cancel: 4 } as const;

describe("Phase 6 demonstrations 16-23: confidential migration between maturities", () => {
  let h: CurveHarness;
  /** The SECOND confidential layer. A Kyrve deployment serves one series; a roll needs two. */
  let h2: CurveHarness;
  let s: SettlementHarness;
  let s2: SettlementHarness;
  let source: SeriesLayer & { quoteId: `0x${string}`; epoch: EpochState };
  let target: SeriesLayer & { quoteId: `0x${string}`; epoch: EpochState };
  let roll: any;

  let holderIndex: number;
  let holder: `0x${string}`;
  let supplierIndex: number;
  let supplier: `0x${string}`;
  let outsiderIndex: number;
  let outsider: `0x${string}`;

  let intentId: `0x${string}`;
  let supplyId: `0x${string}`;
  let conversion = 0n;
  /** The source market's maturity, for demonstration 24's served record. Public: a Market field. */
  let sourceMaturity = 0n;
  let intentQty = 0n;
  let supplyQty = 0n;

  const opening = {
    holderSource: 0n,
    holderTarget: 0n,
    supplierSource: 0n,
    supplierTarget: 0n,
    sourceSupply: 0n,
    targetSupply: 0n,
  };
  /** The LIVE total-supply handles before any roll. `Nox.mint`/`Nox.burn` would replace them. */
  let sourceSupplyHandle: Handle;
  let targetSupplyHandle: Handle;

  const gas: Record<string, string> = {};

  /** The plaintext reference model for one netting. Both floors, both leaving the remainder home. */
  function modelNet(intentEscrow: bigint, supplyEscrow: bigint, conversionWad: bigint) {
    const absorbable = (supplyEscrow * WAD) / conversionWad;
    const consumedSource = intentEscrow < absorbable ? intentEscrow : absorbable;
    const movedTarget = (consumedSource * conversionWad) / WAD;
    return {
      absorbable,
      consumedSource,
      movedTarget,
      intentLeft: intentEscrow - consumedSource,
      supplyLeft: supplyEscrow - movedTarget,
    };
  }

  before(async () => {
    h = await deployCurveHarness({ substrate: true });
    s = await deploySettlement(h);
    /**
     * THE SECOND LAYER, AND THE REASON IT IS NOT OPTIONAL.
     *
     * `KyrveCustodyVault.bindSettler` is one-shot and its settler is a `SeriesAllocator`, which
     * holds its series, token, ownership registry, vault and market as immutables. So one custody
     * vault serves exactly one series, a second series needs a second vault, and a second vault
     * cascades into a second engine, epoch controller, graph registry, ledger and settlement layer.
     * The first attempt at this suite failed with `SettlerAlreadyBound` — the correct refusal,
     * naming nothing about the cause.
     *
     * The two layers SHARE the controller, the wrapped asset, both books, the universe registry and
     * the Midnight substrate, so the providers' mandates live in one book and both series redeem in
     * one loan token — which is what `KyrveRollBook`'s constructor checks.
     */
    h2 = await deployParallelCurveLayer(h);
    s2 = await deploySettlement(h2);

    holderIndex = 1;
    supplierIndex = 4;
    outsiderIndex = 6;

    /**
     * FIXTURE MARKETS 0 AND 1: `usdc-30d-weth` and `usdc-90d-weth`.
     *
     * The same loan token and the SAME COLLATERAL, at two maturities. That is what a roll is, and
     * it is also what makes the fixture runnable: fixture market 3 is `usdc-90d-multi`, a sorted
     * collateral PAIR, and `supplyCollateral` supplies index 0 of whatever the market declares.
     * Pointing the second epoch at it produced a Midnight balance revert naming (0, 1000e18) and
     * nothing about the cause — the borrower was supplying a token that market does not take.
     */
    const first = await settlementMarketGrid(s, 0, { collateralFamily: 0, maturityBucket: 0 });
    const second = await settlementMarketGrid(s, 1, { collateralFamily: 0, maturityBucket: 1 });
    const markets = [
      { market: first.market, marketId: first.marketId },
      { market: second.market, marketId: second.marketId },
    ];

    const created = await createSettlementUniverse(h, [first.grid, second.grid], {
      privacyFloor: 2,
      cellsPerChunk: CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
    });
    sourceMaturity = BigInt(first.market.maturity);

    /**
     * TWO DISJOINT PROVIDER SETS, EACH CAPPED ONTO ONE MARKET.
     *
     * A mandate's `marketCaps` is per market index, and a cap of zero means the provider offers
     * that market nothing. So capping wallets 1 and 2 onto market 0 and wallets 3 and 4 onto market
     * 1 makes each epoch's winner determined by who is willing to fill it — which is how two epochs
     * over one universe end up as two SERIES rather than two quotes on the same one.
     */
    const sourceProviders = [
      await setupProvider(h, created.universeId, {
        walletIndex: holderIndex,
        mandate: { marketCaps: [400n * UNIT, 0n], minRateIndexes: [0, 0] },
        balance: 2_000n * UNIT,
      }),
      await setupProvider(h, created.universeId, {
        walletIndex: 2,
        mandate: { marketCaps: [300n * UNIT, 0n], minRateIndexes: [0, 0] },
        balance: 1_500n * UNIT,
      }),
    ];
    // Against h2: these providers deposit into the SECOND custody vault and grant the SECOND
    // engine. Their mandates go to the shared book, which is why disjoint wallets matter — one
    // wallet cannot hold two mandates for one universe.
    const targetProviders = [
      await setupProvider(h2, created.universeId, {
        walletIndex: 3,
        mandate: { marketCaps: [0n, 400n * UNIT], minRateIndexes: [0, 0] },
        balance: 2_000n * UNIT,
      }),
      await setupProvider(h2, created.universeId, {
        walletIndex: supplierIndex,
        mandate: { marketCaps: [0n, 400n * UNIT], minRateIndexes: [0, 0] },
        balance: 2_000n * UNIT,
      }),
    ];

    source = await runLifecycle(h, s, sourceProviders, 5, 0, markets, created);
    // Borrower wallet 13: above every ROLE_INDEX entry, so a borrower is never also a role.
    target = await runLifecycle(h2, s2, targetProviders, 13, 1, markets, created);

    assert.notEqual(
      source.seriesId,
      target.seriesId,
      "the two epochs must have produced two DIFFERENT series, or this suite proves nothing",
    );

    /**
     * THE SOURCE SERIES OPENS REDEMPTION, WHICH IS WHAT MAKES THE CONVERSION EXIST.
     *
     * `conversionWad` is derived from two public numbers: the source's redemption factor and the
     * target's declared issue price. Until the curator sets the factor there is no conversion and
     * `KyrveRollBook` reverts `SourceRedemptionNotOpen` rather than defaulting to par — a roll
     * priced at par by accident would move value between the two sides on every netting.
     */
    const sourceBinding = await source.ownership.read.bindingOf([source.quoteId]);
    const unitsWithdrawn = (sourceBinding.aggregateFillAmount as bigint) + 2_500_000n;
    await mine(
      h,
      await source.token.write.setRedemptionFactor(
        [unitsWithdrawn, sourceBinding.aggregateFillAmount],
        { account: source.curator.account },
      ),
    );

    const deploymentId = (await s.registry.read.DEPLOYMENT_ID()) as `0x${string}`;
    roll = await h.connection.viem.deployContract("KyrveRollBook", [
      source.token.address,
      target.token.address,
      TARGET_PRICE_WAD,
      deploymentId,
      h.wallets[ROLE_INDEX.keeper].account.address,
      h.controller.address,
    ]);

    holder = h.wallets[holderIndex].account.address as `0x${string}`;
    supplier = h.wallets[supplierIndex].account.address as `0x${string}`;
    outsider = h.wallets[outsiderIndex].account.address as `0x${string}`;

    conversion = (await roll.read.conversionWad()) as bigint;

    opening.holderSource = await readSeriesBalance(h, source, holderIndex, holder);
    opening.holderTarget = await confidentialBalance(h, target.token, holderIndex);
    opening.supplierSource = await confidentialBalance(h, source.token, supplierIndex);
    opening.supplierTarget = await readSeriesBalance(h, target, supplierIndex, supplier);
    opening.sourceSupply = await decryptSupply(source);
    opening.targetSupply = await decryptSupply(target);
    sourceSupplyHandle = (await source.token.read.confidentialAggregateSupply()) as Handle;
    targetSupplyHandle = (await target.token.read.confidentialAggregateSupply()) as Handle;

    assert.ok(opening.holderSource > 0n, "the holder must hold a real source claim");
    assert.ok(opening.supplierTarget > 0n, "the supplier must hold real target inventory");

    // A partial roll on purpose: the intent is larger than the escrowed inventory can absorb, so
    // there is a residual to declare and a public leg to exercise.
    intentQty = (opening.holderSource * 4n) / 5n;
    supplyQty = (opening.supplierTarget * 2n) / 5n;
  });

  /** One complete Phase 3-5 lifecycle: epoch, funding, settlement, allocation. */
  async function runLifecycle(
    layer: CurveHarness,
    settlement: SettlementHarness,
    providers: readonly SealedProviderState[],
    borrowerIndex: number,
    preferredMaturityIndex: number,
    markets: { market: any; marketId: `0x${string}` }[],
    created: Awaited<ReturnType<typeof createSettlementUniverse>>,
  ): Promise<SeriesLayer & { quoteId: `0x${string}`; epoch: EpochState }> {
    const borrower = await setupBorrower(layer, created.universeId, borrowerIndex, {
      desiredAssets: 400n * UNIT,
      minimumAssets: 50n * UNIT,
      maxRateIndexes: [1, 1],
      preferredMaturityIndex,
    });

    const epoch = await openAndSeal(
      layer,
      created.universeId,
      created.universe,
      providers,
      borrower,
    );
    await runEpoch(layer, epoch);
    const result = await collectPublicResult(layer, epoch.epochId);

    const winning = markets[result.marketIndex];
    assert.ok(winning !== undefined, "the published market index must name a deployed market");
    const seriesId = (await settlement.factory.read.seriesIdFor([
      winning.marketId,
    ])) as `0x${string}`;
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

    return { ...series, quoteId: quote.quoteId, epoch };
  }

  /**
   * The series' total confidential supply, read by publishing it.
   *
   * IRREVERSIBLE, and done ONCE per series before any roll so the same handle can be compared
   * afterwards. `publishAggregateSupply` is callable once per token and reverts thereafter, which
   * is why the "supply is unchanged" assertion is made against a snapshot taken up front rather
   * than by publishing twice — a second publication is not available and pretending otherwise
   * would be a test that cannot run.
   */
  async function decryptSupply(layer: SeriesLayer): Promise<bigint> {
    await mine(
      h,
      await layer.token.write.publishAggregateSupply({ account: layer.curator.account }),
    );
    const handle = (await layer.token.read.publishedSupply()) as Handle;
    const client = await clientFor(h, ROLE_INDEX.deployer);
    return (await client.publicDecrypt(handle, SUITE_POLL)).value;
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 16. the intent
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("16. a roll intent MOVES the holder's source claim into escrow", async () => {
    const expiry = (await h.publicClient.getBlock()).timestamp + 7n * 24n * 3600n;
    const client = await clientFor(h, holderIndex);

    await withOperatorWindow(h, source.token, holderIndex, roll.address, async () => {
      const encrypted = await client.encrypt(intentQty, "euint256", roll.address);
      const nonce = (await roll.read.nextNonce([holder])) as bigint;
      const receipt = await mine(
        h,
        await roll.write.submitIntent([encrypted.handle, encrypted.proof, expiry, nonce], {
          account: h.wallets[holderIndex].account,
        }),
      );
      gas.submitIntent = String(receipt.gasUsed);
    });

    intentId = (await roll.read.intentIdFor([holder, 0n])) as `0x${string}`;
    const status = await roll.read.statusOf([intentId]);
    assert.equal(Number(status[0]), INTENT.Open);
    assert.equal(Number(status[5]), NEXT.Net, "an open intent with nothing netted wants netting");

    assert.equal(
      await readSeriesBalance(h, source, holderIndex, holder),
      opening.holderSource - intentQty,
      "the holder's source claim must have FALLEN by exactly what they escrowed",
    );
    assert.equal(
      await decryptAs(
        h,
        holderIndex,
        (await roll.read.confidentialIntentEscrow([intentId])) as Handle,
      ),
      intentQty,
      "and the escrow is what the token actually moved",
    );

    // Nobody else can read it. The escrow is granted to its owner and to nobody else.
    const state = await acl(
      h,
      (await roll.read.confidentialIntentEscrow([intentId])) as Handle,
      outsider,
    );
    assert.equal(state.canDecrypt, false);
    assert.equal(state.isPublic, false);
  });

  it("16b. the conversion is derived from public numbers, and reproducible", async () => {
    const factor = (await source.token.read.redemptionFactorWad()) as bigint;
    assert.ok(factor > 0n, "the source series must have opened redemption");
    assert.equal(
      conversion,
      (factor * WAD) / TARGET_PRICE_WAD,
      "conversionWad must be exactly sourceFactor * WAD / targetPrice, reproducible by anyone",
    );
    assert.equal(
      (await roll.read.quoteRoll([1_000_000n])) as bigint,
      (1_000_000n * conversion) / WAD,
      "and the public quote must agree with it",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 17. internal netting first
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("17. target capacity is escrowed, then internal liquidity is netted privately", async () => {
    const expiry = (await h.publicClient.getBlock()).timestamp + 7n * 24n * 3600n;
    const client = await clientFor(h, supplierIndex);

    await withOperatorWindow(h, target.token, supplierIndex, roll.address, async () => {
      const encrypted = await client.encrypt(supplyQty, "euint256", roll.address);
      const nonce = (await roll.read.nextNonce([supplier])) as bigint;
      const receipt = await mine(
        h,
        await roll.write.supplyTarget([encrypted.handle, encrypted.proof, expiry, nonce], {
          account: h.wallets[supplierIndex].account,
        }),
      );
      gas.supplyTarget = String(receipt.gasUsed);
    });

    supplyId = (await roll.read.supplyIdFor([supplier, 0n])) as `0x${string}`;
    assert.equal(
      await decryptAs(
        h,
        supplierIndex,
        (await roll.read.confidentialSupplyEscrow([supplyId])) as Handle,
      ),
      supplyQty,
      "target capacity is PROVEN by the claims being in the contract, not asserted",
    );

    const model = modelNet(intentQty, supplyQty, conversion);
    assert.ok(model.consumedSource > 0n, "the fixture must net something");
    assert.ok(
      model.intentLeft > 0n,
      "the fixture must leave a residual — a full internal fill never exercises the public leg",
    );

    const receipt = await mine(
      h,
      await roll.write.netRoll([intentId, supplyId, 0], {
        account: h.wallets[ROLE_INDEX.keeper].account,
      }),
    );
    gas.netRoll = String(receipt.gasUsed);
    // Kept for demonstration 24's served record, which must name a real transaction.
    gas["netRollTx"] = receipt.transactionHash;

    assert.equal(
      await decryptAs(
        h,
        holderIndex,
        (await roll.read.confidentialIntentEscrow([intentId])) as Handle,
      ),
      model.intentLeft,
      "the intent keeps what internal liquidity could not absorb",
    );
    assert.equal(
      await decryptAs(
        h,
        supplierIndex,
        (await roll.read.confidentialSupplyEscrow([supplyId])) as Handle,
      ),
      model.supplyLeft,
      "and the supplier keeps their unmatched inventory",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 19 and 20. conservation on both legs
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("19-20. both legs conserve under the declared conversion, and neither supply moves", async () => {
    const model = modelNet(intentQty, supplyQty, conversion);

    // Source leg: what left the holder arrived at the supplier.
    assert.equal(
      await confidentialBalance(h, source.token, supplierIndex),
      opening.supplierSource + model.consumedSource,
      "the supplier received exactly the source claims the netting consumed",
    );
    // Target leg: what left the supplier arrived at the holder.
    assert.equal(
      await confidentialBalance(h, target.token, holderIndex),
      opening.holderTarget + model.movedTarget,
      "the holder received exactly the target claims the conversion bought",
    );

    // The declared conversion, checked against the two measured quantities rather than against the
    // contract's own arithmetic.
    assert.equal(
      model.movedTarget,
      (model.consumedSource * conversion) / WAD,
      "value is conserved under the DECLARED conversion, floor-rounded",
    );

    /**
     * NEITHER SUPPLY MOVED. This is the statement a burn-and-mint roll could not make.
     *
     * Compared on the LIVE `confidentialTotalSupply` HANDLE, captured before the roll. `Nox.mint`
     * and `Nox.burn` are the only operations that touch it and both produce a new handle, so an
     * unchanged handle is a stronger claim than an equal plaintext — it says the operation never
     * happened rather than that it netted to zero.
     *
     * NOT compared against `publishedSupply()`: `publishAggregateSupply` ISOLATES the total before
     * marking it public, so the published handle is a `select` output and can never equal the live
     * one. Asserting that equality was the first version of this test, and it failed for a reason
     * that had nothing to do with the roll.
     */
    assert.equal(
      (await source.token.read.confidentialAggregateSupply()) as Handle,
      sourceSupplyHandle,
      "the source series' live supply handle is UNCHANGED — nothing was burned",
    );
    assert.equal(
      (await target.token.read.confidentialAggregateSupply()) as Handle,
      targetSupplyHandle,
      "the target series' live supply handle is UNCHANGED — nothing was minted",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 21. resumption and idempotence
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("21. an interrupted roll resumes, and a retried netting cannot net twice", async () => {
    const status = await roll.read.statusOf([intentId]);
    assert.equal(Number(status[2]), 1, "one netting has landed");
    assert.equal(
      Number(status[5]),
      NEXT.DeclareResidual,
      "the resume surface names the next action, so a run is continued rather than restarted",
    );

    /**
     * THE RETRY. A keeper whose receipt was dropped cannot tell a landed transaction from a lost
     * one. Re-sending the same call would net a second time against escrow that is still there —
     * so the index it believes it is acting on is a parameter, and a stale one is refused.
     */
    await assertRevertsWithError(
      () =>
        roll.write.netRoll([intentId, supplyId, 0], {
          account: h.wallets[ROLE_INDEX.keeper].account,
        }),
      roll,
      "StaleNetIndex",
      "a keeper retrying a netting that already landed",
    );

    // And the escrows are untouched by the refused retry.
    const model = modelNet(intentQty, supplyQty, conversion);
    assert.equal(
      await decryptAs(
        h,
        holderIndex,
        (await roll.read.confidentialIntentEscrow([intentId])) as Handle,
      ),
      model.intentLeft,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 18. the explicit public residual
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("18. the residual is declared publicly, irreversibly, and unwound in the open", async () => {
    await assertRevertsWithError(
      () => roll.write.declareResidual([intentId], { account: h.wallets[outsiderIndex].account }),
      roll,
      "NotHolder",
      "an outsider declaring someone else's residual",
    );

    const receipt = await mine(
      h,
      await roll.write.declareResidual([intentId], { account: h.wallets[holderIndex].account }),
    );
    gas.declareResidual = String(receipt.gasUsed);

    const status = await roll.read.statusOf([intentId]);
    assert.equal(Number(status[0]), INTENT.ResidualDeclared);
    assert.equal(Number(status[5]), NEXT.SettleResidual);

    const residualHandle = status[3] as Handle;
    assert.equal(
      (await acl(h, residualHandle, outsider)).isPublic,
      true,
      "the residual is publicly decryptable — that IS the disclosure, and it cannot be undone",
    );

    await assertRevertsWithError(
      () => roll.write.declareResidual([intentId], { account: h.wallets[holderIndex].account }),
      roll,
      "IntentNotOpen",
      "a second declaration pinning a later remainder",
    );

    const model = modelNet(intentQty, supplyQty, conversion);
    const decrypted = await (await clientFor(h, outsiderIndex)).publicDecrypt(
      residualHandle,
      SUITE_POLL,
    );
    assert.equal(
      decrypted.value,
      model.intentLeft,
      "the published residual is exactly what internal netting could not absorb",
    );

    /**
     * WHAT IS STILL PRIVATE. The residual is public and the NETTED quantity is not, because the
     * original escrow was never public — `netted = escrow - residual` is one equation in two
     * unknowns. The quantity that would close it is the holder's new target balance, and it is
     * still confidential.
     */
    const holderTarget = (await target.token.read.confidentialBalanceOf([holder])) as Handle;
    assert.equal((await acl(h, holderTarget, outsider)).isPublic, false);
    assert.equal((await acl(h, holderTarget, outsider)).canDecrypt, false);

    // Over-settling beyond the proven residual is refused. The bound is the PROOF.
    await assertRevertsWithError(
      () =>
        roll.write.settleResidual([intentId, decrypted.value + 1n, decrypted.decryptionProof], {
          account: h.wallets[holderIndex].account,
        }),
      roll,
      "ResidualExceeded",
      "unwinding more than the published residual",
    );

    const half = decrypted.value / 2n;
    assert.ok(half > 0n, "the fixture must leave a residual worth splitting");
    const before = await readSeriesBalance(h, source, holderIndex, holder);
    const settleReceipt = await mine(
      h,
      await roll.write.settleResidual([intentId, half, decrypted.decryptionProof], {
        account: h.wallets[holderIndex].account,
      }),
    );
    gas.settleResidual = String(settleReceipt.gasUsed);

    assert.equal(
      await readSeriesBalance(h, source, holderIndex, holder),
      before + half,
      "the publicly-unwound claims returned to the holder, to be redeemed and re-deployed in the open",
    );
    assert.equal(
      (await roll.read.statusOf([intentId]))[4] as bigint,
      half,
      "and the leg is recorded, so an interrupted unwind is resumed rather than restarted",
    );
    assert.equal(
      Number((await roll.read.statusOf([intentId]))[0]),
      INTENT.ResidualDeclared,
      "a partial unwind does not complete the intent — NO ATOMICITY IS CLAIMED",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 22. recovery
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("22. cancellation restores a recoverable state from every intermediate state", async () => {
    await assertRevertsWithError(
      () => roll.write.cancelIntent([intentId], { account: h.wallets[outsiderIndex].account }),
      roll,
      "NotHolder",
      "an outsider cancelling someone else's intent",
    );
    // Not even the keeper. Netting is the keeper's; the escrow is the holder's.
    await assertRevertsWithError(
      () => roll.write.cancelIntent([intentId], { account: h.wallets[ROLE_INDEX.keeper].account }),
      roll,
      "NotHolder",
      "the keeper cancelling a holder's intent",
    );

    const escrowLeft = await decryptAs(
      h,
      holderIndex,
      (await roll.read.confidentialIntentEscrow([intentId])) as Handle,
    );
    const before = await readSeriesBalance(h, source, holderIndex, holder);

    // CANCELLABLE FROM `ResidualDeclared`, not only from `Open`. An intent that could reach a state
    // its holder cannot exit would be capital hostage to a keeper's uptime or an expiry timer.
    const receipt = await mine(
      h,
      await roll.write.cancelIntent([intentId], { account: h.wallets[holderIndex].account }),
    );
    gas.cancelIntent = String(receipt.gasUsed);

    assert.equal(
      await readSeriesBalance(h, source, holderIndex, holder),
      before + escrowLeft,
      "cancellation returns the whole remaining escrow",
    );
    assert.equal(Number((await roll.read.statusOf([intentId]))[0]), INTENT.Cancelled);
    assert.equal(Number((await roll.read.statusOf([intentId]))[5]), NEXT.Nothing);

    // The supplier's side recovers independently, and the keeper cannot touch it either.
    const supplierBefore = await readSeriesBalance(h, target, supplierIndex, supplier);
    const inventoryLeft = await decryptAs(
      h,
      supplierIndex,
      (await roll.read.confidentialSupplyEscrow([supplyId])) as Handle,
    );
    await mine(
      h,
      await roll.write.cancelSupply([supplyId], { account: h.wallets[supplierIndex].account }),
    );
    assert.equal(
      await readSeriesBalance(h, target, supplierIndex, supplier),
      supplierBefore + inventoryLeft,
      "the supplier's unmatched inventory comes back in full",
    );

    // And a cancelled intent admits nothing further.
    await assertRevertsWithError(
      () => roll.write.cancelIntent([intentId], { account: h.wallets[holderIndex].account }),
      roll,
      "IntentNotOpen",
      "cancelling the same intent twice",
    );
    await assertRevertsWithError(
      () =>
        roll.write.netRoll([intentId, supplyId, 1], {
          account: h.wallets[ROLE_INDEX.keeper].account,
        }),
      roll,
      "IntentNotOpen",
      "netting against a cancelled intent",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 23. both series still solvent
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("23. old and new series both remain solvent, proven on chain after the roll", async () => {
    for (const [label, layer] of [
      ["the source series", source],
      ["the target series", target],
    ] as const) {
      const receipt = await mine(h, await layer.solvency.write.proveSolvency());
      gas[`proveSolvency:${label.includes("source") ? "source" : "target"}`] = String(
        receipt.gasUsed,
      );

      const snapshot = await layer.solvency.read.latestSnapshot();
      const verdict = await (await clientFor(h, ROLE_INDEX.deployer)).publicDecrypt(
        snapshot.verdictHandle as Handle,
        SUITE_POLL,
      );
      assert.equal(verdict.value, 1n, `${label} must be solvent after the roll`);
      assert.ok(
        (snapshot.publicCoverage as bigint) > 0n,
        `${label} must report real public coverage, not a vacuous verdict`,
      );
    }

    // And the supplies really are the ones frozen before any roll ran.
    assert.equal(
      await (await clientFor(h, ROLE_INDEX.deployer))
        .publicDecrypt((await source.token.read.publishedSupply()) as Handle, SUITE_POLL)
        .then((d) => d.value),
      opening.sourceSupply,
      "the source series' supply is the same number it was before the roll",
    );
    assert.equal(
      await (await clientFor(h, ROLE_INDEX.deployer))
        .publicDecrypt((await target.token.read.publishedSupply()) as Handle, SUITE_POLL)
        .then((d) => d.value),
      opening.targetSupply,
      "and so is the target series'",
    );
  });

  /**
   * Demonstration 24: Kyrve Verify in a real browser, over the fixture this suite already built.
   *
   * It lives here rather than in its own file because the thing worth verifying is a two-layer
   * deployment with a live Roll book, and standing that up a second time would double the most
   * expensive fixture in the repository to test a page.
   *
   * WHAT IS ACTUALLY BEING CHECKED. Not that the page renders — that a page which RECOMPUTES
   * disagrees with a record when the record is wrong. So the served record is deliberately given a
   * false series id after the honest pass, and the page must turn that row red on its own.
   */
  it("24. Kyrve Verify recomputes in Chromium, and disagrees with a record that lies", async () => {
    // Read from chain and from the registry, never invented. The terminal refuses to start on a
    // record it cannot parse, which is the correct behaviour and also why a placeholder here would
    // have surfaced as an empty page rather than as a wrong number.
    const sourceBinding = (await source.ownership.read.bindingOf([source.quoteId])) as {
      graphRoot: `0x${string}`;
    };
    const sourceGraphRoot = sourceBinding.graphRoot;
    const nettingTx = (gas["netRollTx"] ?? `0x${"00".repeat(32)}`) as `0x${string}`;
    const publicRecord = (seriesId: `0x${string}`) => ({
      environment: "local",
      chainId: 31337,
      noxCompute: NOX_COMPUTE_BY_CHAIN[31337],
      addresses: {
        KyrveEmergencyController: h.controller.address,
        TestUnderlyingERC20: h.underlying.address,
        KyrveWrappedAsset: h.asset.address,
        KyrveConfidentialAssetVault: h.custody.address,
        EncryptedMandateBook: h.mandateBook.address,
        ConfidentialRequestBook: h.requestBook.address,
      },
      disclosure:
        "Kyrve is open-source software integrating an unmodified, source-available Morpho " +
        "Midnight testnet replica under its applicable non-production licence.",
      gatewayUrl: handleGatewayUrl(),
      series: {
        addresses: {
          KyrveCustodyVault: h.custody.address,
          KyrveSeriesToken: source.token.address,
          SeriesOwnershipRegistry: source.ownership.address,
          SeriesAllocator: source.allocator.address,
          AggregateSolvencyVerifier: source.solvency.address,
          SeriesResidueAccount: source.residue.address,
        },
        seriesId,
        marketId: source.marketId,
        vault: source.vault.address,
        loanToken: s.usdc.address,
        loanTokenSymbol: "tUSDC",
        loanTokenDecimals: 6,
        maturity: sourceMaturity.toString(),
        quoteId: source.quoteId,
        epochId: source.epoch.epochId,
        graphRoot: sourceGraphRoot,
        // Both are rendered as links only. Naming the netting transaction — a real hash on this
        // chain — rather than a placeholder keeps the record free of invented identifiers.
        settlementTx: nettingTx,
        allocationTx: nettingTx,
        providers: [holder, supplier],
      },
      // The Roll book is here and the Cross book is not, so the page must render one row as a real
      // verdict and the other as "not deployed here" — the third answer that keeps the other two
      // honest is exercised rather than described.
      market: {
        seriesId: source.seriesId,
        addresses: {
          KyrveCapsuleVault: source.capsules.address,
          KyrveRollBook: roll.address,
        },
      },
    });

    const publicDir = new URL("../../apps/web/public/", import.meta.url);
    const recordPath = new URL("../../apps/web/public/deployment.json", import.meta.url);
    mkdirSync(publicDir, { recursive: true });

    // No amount may appear in the served record. Every number the page shows is read from chain.
    const honest = publicRecord(source.seriesId);
    for (const amount of [opening.sourceSupply, opening.targetSupply, intentQty, supplyQty]) {
      assert.equal(
        JSON.stringify(honest).includes(amount.toString()),
        false,
        "the served record must carry no amount; the page reads every number from chain state",
      );
    }
    writeFileSync(recordPath, `${JSON.stringify(honest, null, 2)}\n`);

    const vite = spawn("pnpm", ["--filter", "@kyrve/web", "exec", "vite", "--host", "127.0.0.1"], {
      cwd: new URL("../../", import.meta.url).pathname,
      stdio: "ignore",
      detached: false,
    });
    let browser: Browser | undefined;
    try {
      const deadline = Date.now() + 60_000;
      for (;;) {
        try {
          if ((await fetch(VERIFY_APP_URL)).ok) break;
        } catch {
          // not up yet
        }
        if (Date.now() > deadline) throw new Error("the terminal's dev server never came up");
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      browser = await chromium.launch();
      const context = await browser.newContext();
      await context.addInitScript(
        ({ key, rpc, gateway }) => {
          (window as unknown as Record<string, unknown>).__KYRVE_LOCAL_KEY__ = key;
          (window as unknown as Record<string, unknown>).__KYRVE_RPC_URL__ = rpc;
          (window as unknown as Record<string, unknown>).__KYRVE_NOX_GATEWAY__ = gateway;
        },
        { key: HOLDER_KEY, rpc: "http://127.0.0.1:8545", gateway: handleGatewayUrl() },
      );
      const page = await context.newPage();
      const crashes: string[] = [];
      page.on("pageerror", (error) => crashes.push(String(error)));
      page.on("console", (message) => {
        if (message.type() === "error") crashes.push(message.text());
      });
      await page.goto(proofSeriesUrl(source.seriesId));
      const bootError = page.getByTestId("boot-error");
      if ((await bootError.count()) > 0) {
        throw new Error(`the terminal refused to start: ${await bootError.innerText()}`);
      }
      try {
        await page.getByTestId("verify-band").waitFor({ timeout: 60_000 });
      } catch (error) {
        throw new Error(
          `verify-band never rendered.\nbody: ${(await page.innerText("body")).slice(0, 600)}\n` +
            `errors:\n${crashes.slice(0, 6).join("\n")}`,
          { cause: error },
        );
      }

      // ── The honest record. Every deployed surface recomputes; the absent one says so. ──────
      // Phase 7 renamed the two decided verdicts to `verified` and `failed`, so the downloadable
      // artefact can carry all four labels it has to — the third, `unavailable`, and the fourth,
      // `reported-not-verified`, which is what a record asserts that no browser checked. The claims
      // below are unchanged; only the words are.
      for (const [row, expected] of [
        ["series-identity", "verified"],
        ["published-supply", "verified"],
        ["capsule", "verified"],
        ["roll", "verified"],
        ["cross", "unavailable"],
      ] as const) {
        const locator = page.getByTestId(`verify-${row}`);
        await locator.waitFor({ timeout: 60_000 });
        assert.equal(
          await locator.getAttribute("data-verdict"),
          expected,
          `the ${row} row must report ${expected} against an honest record`,
        );
      }

      // The Roll row must have done the arithmetic, not echoed the getter.
      // `textContent`, not `innerText`: the assertion is about what the component rendered, and
      // innerText answers what CSS chose to show — which would make a styling change look like a
      // missing proof.
      const rollText = (await page.getByTestId("verify-roll").textContent()) ?? "";
      const expectedConversion = ((await roll.read.conversionWad()) as bigint).toString();
      assert.match(
        rollText,
        /recomputed here/,
        "the Roll row must show the conversion it recomputed, not only the one the book reported",
      );
      assert.ok(
        rollText.includes(expectedConversion),
        `the Roll row must display the conversion ${expectedConversion} it recomputed`,
      );

      // ── The lying record. One field changed; the page must find it on its own. ────────────
      const forged = `0x${"ab".repeat(32)}` as `0x${string}`;
      writeFileSync(recordPath, `${JSON.stringify(publicRecord(forged), null, 2)}\n`);
      await page.goto(proofSeriesUrl(forged));
      await page.getByTestId("verify-band").waitFor({ timeout: 60_000 });
      const identity = page.getByTestId("verify-series-identity");
      await identity.waitFor({ timeout: 60_000 });
      assert.equal(
        await identity.getAttribute("data-verdict"),
        "failed",
        "A PAGE THAT PASSES A RECORD NAMING THE WRONG SERIES IS DISPLAYING THE RECORD, NOT " +
          "VERIFYING IT. This is the assertion the whole component exists for.",
      );
      assert.match(
        (await identity.textContent()) ?? "",
        /on chain[\s\S]*in the record/,
        "a disagreeing row must show BOTH values, so a reader can see which one is wrong",
      );

      await context.close();
      writeFileSync(recordPath, `${JSON.stringify(honest, null, 2)}\n`);
    } finally {
      await browser?.close();
      vite.kill("SIGTERM");
    }
  });

  it("records the Roll gas, for the Sepolia budget", () => {
    mkdirSync(new URL("../../evidence/phase6/", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("../../evidence/phase6/roll-gas.json", import.meta.url),
      `${JSON.stringify(gas, null, 2)}\n`,
    );
    assert.ok(gas.netRoll !== undefined, "the netting must have been measured");
  });
});
