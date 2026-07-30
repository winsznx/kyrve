/**
 * Phase 6 demonstrations 8-15: Kyrve Cross, against the REAL Nox stack and REAL unmodified Midnight.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ONE CONNECTED SEQUENCE OVER CLAIMS THAT WERE REALLY EARNED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The inventory traded here is not minted for the test. It is the confidential series ownership a
 * real curve epoch produced, funded by real confidential locks, settled through real unmodified
 * Midnight. `KyrveSeriesToken.mintClaim` is `onlyAllocator` and takes a handle rather than a number,
 * so there is no shortcut available even if one were wanted.
 *
 *    8.  a seller submits a confidential exit order, and the escrow really moves their claim
 *    9.  a buyer submits a confidential entry order, and their funding is locked before matching
 *    10. the two net privately
 *    11. series and wrapped assets transfer confidentially, to the right parties
 *    12. a third wallet cannot infer the matched quantity, from the chain or from the logs
 *    13. cancellation releases the unmatched remainder
 *    14. duplicate execution fails
 *    15. supply and asset conservation hold EXACTLY, including the public residual leg
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE FIXTURE IS CHOSEN TO PRODUCE A PARTIAL FILL AND REAL DUST
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * At a par price with round sizes every conservation identity holds trivially and the rounding
 * policy is never exercised. So the price is 0.97 and the buyer's escrow is deliberately not a
 * multiple of it: the match is partial on the seller's side, and `floor(matched * price / WAD)`
 * leaves a sub-unit remainder in the BUYER's escrow. Demonstration 15 asserts where that dust ends
 * up, because "dust is never swept anywhere" is a claim about a destination.
 *
 * Every expectation is computed by a plaintext reference model in `market-helpers.ts` using the same
 * integer arithmetic the contract uses. A test that asserted the chain agrees with itself would
 * prove nothing.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { before, describe, it } from "node:test";

import { CURVE_RECOMMENDED_CELLS_PER_TRANSACTION, UNIT } from "@kyrve/curve";
import type { Handle } from "@kyrve/nox";

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
import { clientFor, flattenError, mine, ROLE_INDEX, SUITE_POLL } from "./helpers.js";
import {
  assertEventCarriesNoAmount,
  type CrossBook,
  confidentialBalance,
  decryptAs,
  deployCrossBook,
  fundWrapped,
  modelMatch,
  ORDER_STATE,
  SIDE,
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
  type ActivatedQuote,
  activateQuote,
  collectPublicResult,
  createSettlementUniverse,
  deploySettlement,
  type PublicResult,
  type SettlementHarness,
  settlementMarketGrid,
  supplyCollateral,
} from "./settlement-helpers.js";

const WAD = 10n ** 18n;
/** A discount price, deliberately not a round fraction, so the rounding policy is exercised. */
const PRICE_WAD = 970_000_000_000_000_000n;
/** 0.25%. Non-zero on purpose: a conservation test at zero fee proves nothing about the fee term. */
const FEE_BPS = 25;

describe("Phase 6 demonstrations 8-15: confidential secondary transfer", () => {
  let h: CurveHarness;
  let s: SettlementHarness;
  let series: SeriesLayer;
  let cross: CrossBook;
  let providers: SealedProviderState[];
  let epoch: EpochState;
  let result: PublicResult;
  let quote: ActivatedQuote;

  let sellerIndex: number;
  let seller: `0x${string}`;
  let buyerIndex: number;
  let buyer: `0x${string}`;
  let outsiderIndex: number;
  let outsider: `0x${string}`;
  let feeBeneficiary: `0x${string}`;

  let exitId: `0x${string}`;
  let entryId: `0x${string}`;
  /** What the seller actually offered, and what the buyer actually escrowed. */
  let offeredQty = 0n;
  let escrowedAssets = 0n;
  let sellerClaimBefore = 0n;

  /** Balances captured across the whole sequence, so conservation is checked end to end. */
  const opening = { sellerSeries: 0n, buyerSeries: 0n, sellerAssets: 0n, buyerAssets: 0n, fee: 0n };

  const gas: Record<string, string> = {};

  before(async () => {
    h = await deployCurveHarness({ substrate: true });
    s = await deploySettlement(h);

    sellerIndex = 1;
    buyerIndex = 4;
    outsiderIndex = 6;

    const first = await settlementMarketGrid(s, 1, { collateralFamily: 0, maturityBucket: 0 });
    const second = await settlementMarketGrid(s, 3, { collateralFamily: 1, maturityBucket: 0 });
    const markets = [
      { market: first.market, marketId: first.marketId },
      { market: second.market, marketId: second.marketId },
    ];

    const created = await createSettlementUniverse(h, [first.grid, second.grid], {
      privacyFloor: 2,
      cellsPerChunk: CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
    });

    providers = [
      await setupProvider(h, created.universeId, {
        walletIndex: sellerIndex,
        mandate: { marketCaps: [400n * UNIT, 400n * UNIT], minRateIndexes: [0, 0] },
        balance: 2_000n * UNIT,
      }),
      await setupProvider(h, created.universeId, {
        walletIndex: 2,
        mandate: { marketCaps: [300n * UNIT, 300n * UNIT], minRateIndexes: [0, 0] },
        balance: 1_500n * UNIT,
      }),
    ];

    const borrower = await setupBorrower(h, created.universeId, 5, {
      desiredAssets: 500n * UNIT,
      minimumAssets: 50n * UNIT,
      maxRateIndexes: [1, 1],
      preferredMaturityIndex: 0,
    });

    epoch = await openAndSeal(h, created.universeId, created.universe, providers, borrower);
    await runEpoch(h, epoch);
    result = await collectPublicResult(h, epoch.epochId);

    const winning = markets[result.marketIndex];
    assert.ok(winning !== undefined, "the published market index must name a deployed market");
    const seriesId = (await s.factory.read.seriesIdFor([winning.marketId])) as `0x${string}`;
    await mine(
      h,
      await s.factory.write.createSeries([winning.marketId, s.usdc.address, s.operator], {
        account: s.curator.account,
      }),
    );
    const vaultAddress = (await s.factory.read.vaultOf([seriesId])) as `0x${string}`;

    series = await deploySeriesLayer(h, s, {
      seriesId,
      marketId: winning.marketId,
      vaultAddress,
      loanToken: s.usdc.address as `0x${string}`,
    });

    await fundQuoteFromCustody(h, series, epoch.epochId, providers.length);
    quote = await activateQuote(h, s, epoch, created.universe, result, markets, { fund: false });

    const borrowerWallet = h.wallets[5];
    await supplyCollateral(h, s, quote.market, borrowerWallet, quote.exactUnits);
    await mine(
      h,
      await s.midnight.write.take(
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
    await allocateSeries(h, series, quote.quoteId, providers.length);

    cross = await deployCrossBook(h, s, series, { priceWad: PRICE_WAD, feeBps: FEE_BPS });

    seller = h.wallets[sellerIndex].account.address as `0x${string}`;
    buyer = h.wallets[buyerIndex].account.address as `0x${string}`;
    outsider = h.wallets[outsiderIndex].account.address as `0x${string}`;
    feeBeneficiary = cross.feeBeneficiary;

    sellerClaimBefore = await readSeriesBalance(h, series, sellerIndex, seller);
    assert.ok(sellerClaimBefore > 0n, "the seller must hold a real claim to trade");

    // The seller offers a bit over half of what they hold, so the order can be partially filled and
    // still leave a remainder to cancel and a residual to publish.
    offeredQty = (sellerClaimBefore * 3n) / 5n;
    // Deliberately not a multiple of the price: `floor(matched * price / WAD)` must leave dust.
    escrowedAssets = (offeredQty * PRICE_WAD) / WAD / 2n + 7n;

    // The buyer is not a provider and holds no claim. Their funding is wrapped loan token, minted
    // and wrapped here — the only public amounts in this whole sequence.
    await fundWrapped(h, buyerIndex, escrowedAssets * 2n);

    opening.sellerSeries = sellerClaimBefore;
    opening.buyerSeries = await confidentialBalance(h, series.token, buyerIndex);
    opening.sellerAssets = await confidentialBalance(h, h.asset, sellerIndex);
    opening.buyerAssets = await confidentialBalance(h, h.asset, buyerIndex);
    opening.fee = await confidentialBalance(h, h.asset, ROLE_INDEX.residueBeneficiary);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 8. the exit order
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("8. a seller's exit order MOVES their claim into escrow, rather than recording an intention", async () => {
    const expiry = (await h.publicClient.getBlock()).timestamp + 7n * 24n * 3600n;
    const client = await clientFor(h, sellerIndex);

    await withOperatorWindow(h, series.token, sellerIndex, cross.book.address, async () => {
      const encrypted = await client.encrypt(offeredQty, "euint256", cross.book.address);
      const nonce = (await cross.book.read.nextNonce([seller])) as bigint;
      const receipt = await mine(
        h,
        await cross.book.write.submitExit([encrypted.handle, encrypted.proof, expiry, nonce], {
          account: h.wallets[sellerIndex].account,
        }),
      );
      gas.submitExit = String(receipt.gasUsed);
    });

    exitId = (await cross.book.read.orderIdFor([seller, SIDE.Exit, 0n])) as `0x${string}`;
    const order = await cross.book.read.orderOf([exitId]);
    assert.equal(Number(order[0]), ORDER_STATE.Open);
    assert.equal(Number(order[1]), SIDE.Exit);
    assert.equal((order[2] as string).toLowerCase(), seller.toLowerCase());

    // The claim really left the seller and really arrived at the book. A book that recorded an
    // intention would leave the first number unchanged.
    const sellerAfter = await readSeriesBalance(h, series, sellerIndex, seller);
    assert.equal(
      sellerAfter,
      sellerClaimBefore - offeredQty,
      "the seller's claim must have FALLEN by exactly what they offered",
    );

    const escrow = (await cross.book.read.confidentialEscrowOf([exitId])) as Handle;
    assert.equal(
      await decryptAs(h, sellerIndex, escrow),
      offeredQty,
      "the escrow is what the token actually moved",
    );
  });

  it("8b. a seller cannot offer more than they hold, and the refusal is not public", async () => {
    const expiry = (await h.publicClient.getBlock()).timestamp + 7n * 24n * 3600n;
    const over = sellerClaimBefore * 10n;
    const client = await clientFor(h, sellerIndex);

    await withOperatorWindow(h, series.token, sellerIndex, cross.book.address, async () => {
      const encrypted = await client.encrypt(over, "euint256", cross.book.address);
      const nonce = (await cross.book.read.nextNonce([seller])) as bigint;
      // IT SUCCEEDS. A public revert here would make this book a balance oracle for every holder:
      // an attacker could binary-search anyone's claim by submitting orders. The official ERC-7984
      // `transfer` primitive credits encrypted zero instead, and the order is an order for nothing.
      await mine(
        h,
        await cross.book.write.submitExit([encrypted.handle, encrypted.proof, expiry, nonce], {
          account: h.wallets[sellerIndex].account,
        }),
      );
    });

    const overId = (await cross.book.read.orderIdFor([seller, SIDE.Exit, 1n])) as `0x${string}`;
    assert.equal(
      await decryptAs(
        h,
        sellerIndex,
        (await cross.book.read.confidentialEscrowOf([overId])) as Handle,
      ),
      0n,
      "an over-offer escrows encrypted zero — the order exists and is backed by nothing",
    );
    // And it took nothing from the seller.
    assert.equal(
      await readSeriesBalance(h, series, sellerIndex, seller),
      sellerClaimBefore - offeredQty,
      "an over-offer must not move a single unit",
    );

    // Clean it up, so the conservation arithmetic later has one exit order to account for.
    await mine(
      h,
      await cross.book.write.cancel([overId], { account: h.wallets[sellerIndex].account }),
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 9. the entry order
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("9. a buyer's funding is locked BEFORE any matching can happen", async () => {
    const expiry = (await h.publicClient.getBlock()).timestamp + 7n * 24n * 3600n;
    const client = await clientFor(h, buyerIndex);
    const before = await confidentialBalance(h, h.asset, buyerIndex);

    await withOperatorWindow(h, h.asset, buyerIndex, cross.book.address, async () => {
      const encrypted = await client.encrypt(escrowedAssets, "euint256", cross.book.address);
      const nonce = (await cross.book.read.nextNonce([buyer])) as bigint;
      const receipt = await mine(
        h,
        await cross.book.write.submitEntry([encrypted.handle, encrypted.proof, expiry, nonce], {
          account: h.wallets[buyerIndex].account,
        }),
      );
      gas.submitEntry = String(receipt.gasUsed);
    });

    entryId = (await cross.book.read.orderIdFor([buyer, SIDE.Entry, 0n])) as `0x${string}`;
    assert.equal(Number((await cross.book.read.orderOf([entryId]))[0]), ORDER_STATE.Open);

    assert.equal(
      await confidentialBalance(h, h.asset, buyerIndex),
      before - escrowedAssets,
      "the buyer's funding must have LEFT their wallet before a match is possible",
    );
    assert.equal(
      await decryptAs(
        h,
        buyerIndex,
        (await cross.book.read.confidentialEscrowOf([entryId])) as Handle,
      ),
      escrowedAssets,
      "and arrived in the order's escrow",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 10 and 11. the match
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("10-11. the orders net privately, and both legs transfer confidentially", async () => {
    const model = modelMatch(offeredQty, escrowedAssets, PRICE_WAD, cross.feeBps);
    assert.ok(model.matched > 0n, "the fixture must actually match something");
    assert.ok(
      model.matched < offeredQty,
      "the fixture must be a PARTIAL fill — a full fill never exercises the remainder path",
    );
    assert.ok(
      model.buyerLeft > 0n,
      "the fixture must leave dust in the buyer's escrow — otherwise the rounding is untested",
    );
    assert.ok(model.fee > 0n, "the fee term must be non-zero, or conservation is untested at it");

    const receipt = await mine(
      h,
      await cross.book.write.matchOrders([exitId, entryId], { account: cross.keeper.account }),
    );
    gas.matchOrders = String(receipt.gasUsed);

    // Both escrows fell by exactly what the model says, and both are still private.
    assert.equal(
      await decryptAs(
        h,
        sellerIndex,
        (await cross.book.read.confidentialEscrowOf([exitId])) as Handle,
      ),
      model.sellerLeft,
      "the seller's escrow keeps the unmatched remainder",
    );
    assert.equal(
      await decryptAs(
        h,
        buyerIndex,
        (await cross.book.read.confidentialEscrowOf([entryId])) as Handle,
      ),
      model.buyerLeft,
      "the buyer's escrow keeps the dust — it is never swept anywhere",
    );

    // Both legs arrived, at the right parties, in the right tokens.
    assert.equal(
      await confidentialBalance(h, series.token, buyerIndex),
      opening.buyerSeries + model.matched,
      "the buyer received the matched claim",
    );
    assert.equal(
      await confidentialBalance(h, h.asset, sellerIndex),
      opening.sellerAssets + model.net,
      "the seller received the proceeds, net of the declared fee",
    );
    assert.equal(
      await confidentialBalance(h, h.asset, ROLE_INDEX.residueBeneficiary),
      opening.fee + model.fee,
      "the declared fee went to the immutable beneficiary, and nowhere else",
    );

    // Both orders stay Open. A partial fill does not close an order, and `matchCount` says so.
    assert.equal(Number((await cross.book.read.orderOf([exitId]))[0]), ORDER_STATE.Open);
    assert.equal(Number((await cross.book.read.orderOf([exitId]))[5]), 1);
    assert.equal(Number((await cross.book.read.orderOf([entryId]))[5]), 1);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 12. nothing leaks
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("12. a third wallet cannot infer the matched quantity, from the chain or from the logs", async () => {
    const model = modelMatch(offeredQty, escrowedAssets, PRICE_WAD, cross.feeBps);

    for (const [label, handle] of [
      ["the seller's escrow", (await cross.book.read.confidentialEscrowOf([exitId])) as Handle],
      ["the buyer's escrow", (await cross.book.read.confidentialEscrowOf([entryId])) as Handle],
      ["the buyer's new claim", (await series.token.read.confidentialBalanceOf([buyer])) as Handle],
      ["the seller's proceeds", (await h.asset.read.confidentialBalanceOf([seller])) as Handle],
    ] as const) {
      const state = await acl(h, handle, outsider);
      assert.equal(state.canDecrypt, false, `${label} must not be readable by an outsider`);
      assert.equal(state.isPublic, false, `${label} must not be public`);

      const client = await clientFor(h, outsiderIndex);
      await assert.rejects(
        () => client.decrypt(handle, { ...SUITE_POLL, timeoutMs: 8_000 }),
        (error: unknown) => {
          const text = flattenError(error);
          assert.ok(
            /holds no grant|not\s*authoris|not\s*authoriz|forbidden|unauthor/i.test(text),
            `${label} must be refused for the right reason, got: ${text}`,
          );
          assert.ok(
            !text.includes(String(model.matched)),
            "a refusal must never carry the magnitude it refused",
          );
          return true;
        },
        `${label} must not decrypt for an outsider`,
      );
    }

    // The declaration, not just this path: an event with a numeric amount field would leak on
    // EVERY match, and a test that only inspected one emitted log would miss it.
    assertEventCarriesNoAmount(cross.book.abi, "OrdersMatched");
    assertEventCarriesNoAmount(cross.book.abi, "OrderOpened");
    assertEventCarriesNoAmount(cross.book.abi, "OrderCancelled");
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 13. cancellation
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("13. cancellation releases the unmatched remainder, and only the owner may do it", async () => {
    await assertRevertsWithError(
      () => cross.book.write.cancel([entryId], { account: h.wallets[outsiderIndex].account }),
      cross.book,
      "NotOrderOwner",
      "an outsider cancelling someone else's order",
    );
    // Not even the keeper. Matching is the keeper's; the escrow is the owner's.
    await assertRevertsWithError(
      () => cross.book.write.cancel([entryId], { account: cross.keeper.account }),
      cross.book,
      "NotOrderOwner",
      "the keeper cancelling a user's order",
    );

    const model = modelMatch(offeredQty, escrowedAssets, PRICE_WAD, cross.feeBps);
    const before = await confidentialBalance(h, h.asset, buyerIndex);

    const receipt = await mine(
      h,
      await cross.book.write.cancel([entryId], { account: h.wallets[buyerIndex].account }),
    );
    gas.cancel = String(receipt.gasUsed);

    assert.equal(
      await confidentialBalance(h, h.asset, buyerIndex),
      before + model.buyerLeft,
      "cancellation returns the whole remaining escrow, dust included",
    );
    assert.equal(Number((await cross.book.read.orderOf([entryId]))[0]), ORDER_STATE.Cancelled);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 14. duplicate execution
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("14. duplicate execution fails — a cancelled order, a replayed proof, a stale nonce", async () => {
    await assertRevertsWithError(
      () => cross.book.write.matchOrders([exitId, entryId], { account: cross.keeper.account }),
      cross.book,
      "OrderNotOpen",
      "matching against an order that was already cancelled",
    );
    await assertRevertsWithError(
      () => cross.book.write.cancel([entryId], { account: h.wallets[buyerIndex].account }),
      cross.book,
      "OrderNotOpen",
      "cancelling the same order twice",
    );

    // A replayed input proof. Nox has no consumption marker of its own — `validateInputProof` has
    // no nonce and no spent flag (delta Q-2) — so this is Kyrve's guard, not the protocol's.
    const expiry = (await h.publicClient.getBlock()).timestamp + 7n * 24n * 3600n;
    const client = await clientFor(h, buyerIndex);
    await withOperatorWindow(h, h.asset, buyerIndex, cross.book.address, async () => {
      const encrypted = await client.encrypt(1_000n, "euint256", cross.book.address);
      const nonce = (await cross.book.read.nextNonce([buyer])) as bigint;
      await mine(
        h,
        await cross.book.write.submitEntry([encrypted.handle, encrypted.proof, expiry, nonce], {
          account: h.wallets[buyerIndex].account,
        }),
      );

      const staleNonce = ((await cross.book.read.nextNonce([buyer])) as bigint) - 1n;
      await assertRevertsWithError(
        () =>
          cross.book.write.submitEntry([encrypted.handle, encrypted.proof, expiry, staleNonce], {
            account: h.wallets[buyerIndex].account,
          }),
        cross.book,
        "WrongNonce",
        "a replayed submission at a stale nonce",
      );

      const freshNonce = (await cross.book.read.nextNonce([buyer])) as bigint;
      await assertRevertsWithError(
        () =>
          cross.book.write.submitEntry([encrypted.handle, encrypted.proof, expiry, freshNonce], {
            account: h.wallets[buyerIndex].account,
          }),
        cross.book,
        "HandleAlreadyConsumed",
        "the same input handle spent twice at this contract",
      );
    });

    // Clean up the small order so it does not distort the conservation arithmetic.
    const strayId = (await cross.book.read.orderIdFor([buyer, SIDE.Entry, 1n])) as `0x${string}`;
    await mine(
      h,
      await cross.book.write.cancel([strayId], { account: h.wallets[buyerIndex].account }),
    );
  });

  it("14b. only the keeper may match, and a side cannot be presented as the other", async () => {
    await assertRevertsWithError(
      () => cross.book.write.matchOrders([exitId, exitId], { account: cross.keeper.account }),
      cross.book,
      "WrongSideForMatch",
      "two exits presented as a match",
    );
    await assertRevertsWithError(
      () =>
        cross.book.write.matchOrders([exitId, entryId], {
          account: h.wallets[outsiderIndex].account,
        }),
      cross.book,
      "NotKeeper",
      "an outsider matching two orders",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 15. conservation, including the public residual
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("15a. the public residual is published by its owner, once, and irreversibly", async () => {
    await assertRevertsWithError(
      () =>
        cross.book.write.publishResidual([exitId], { account: h.wallets[outsiderIndex].account }),
      cross.book,
      "NotOrderOwner",
      "an outsider publishing someone else's residual",
    );

    const receipt = await mine(
      h,
      await cross.book.write.publishResidual([exitId], { account: h.wallets[sellerIndex].account }),
    );
    gas.publishResidual = String(receipt.gasUsed);

    const order = await cross.book.read.orderOf([exitId]);
    const residualHandle = order[6] as Handle;
    assert.notEqual(residualHandle, `0x${"00".repeat(32)}`);
    assert.equal(
      (await acl(h, residualHandle, outsider)).isPublic,
      true,
      "the residual is publicly decryptable — that IS the disclosure, and it cannot be undone",
    );

    await assertRevertsWithError(
      () => cross.book.write.publishResidual([exitId], { account: h.wallets[sellerIndex].account }),
      cross.book,
      "ResidualAlreadyPublished",
      "a second publication pinning a later remainder",
    );

    /**
     * WHAT IS STILL PRIVATE AFTER THE PUBLICATION.
     *
     * The residual is public and the matched quantity is not, because the original escrow was never
     * public — `matched = escrow - residual` is one equation in two unknowns. The quantity that
     * WOULD close it is the buyer's claim balance, which is exactly `matched` on this fixture
     * because the buyer held nothing before. It is still confidential and still refused.
     *
     * The buyer's ESCROW is deliberately not the handle checked here: it was cancelled in
     * demonstration 13, and a cancelled order's slot holds `toEuint256(0)` — a public handle whose
     * plaintext is zero. That is correct and discloses nothing, but asserting privacy against it
     * would be asserting privacy against a number the protocol never hid.
     */
    const buyerClaim = (await series.token.read.confidentialBalanceOf([buyer])) as Handle;
    const state = await acl(h, buyerClaim, outsider);
    assert.equal(state.isPublic, false, "the matched quantity must not become public");
    assert.equal(state.canDecrypt, false, "and an outsider must hold no grant on it");
  });

  it("15b. the residual settles in the open, and both conservation identities hold exactly", async () => {
    const model = modelMatch(offeredQty, escrowedAssets, PRICE_WAD, cross.feeBps);
    const residualHandle = (await cross.book.read.orderOf([exitId]))[6] as Handle;

    const publicClient = await clientFor(h, outsiderIndex);
    const decrypted = await publicClient.publicDecrypt(residualHandle, SUITE_POLL);
    assert.equal(
      decrypted.value,
      model.sellerLeft,
      "the published residual is exactly what private netting could not absorb",
    );

    // A public counterparty with public loan tokens. The whole leg is plaintext on both sides.
    const counterparty = h.wallets[3].account.address as `0x${string}`;
    const settleQty = model.sellerLeft / 2n;
    assert.ok(settleQty > 0n, "the fixture must leave a residual worth settling");
    const quoted = await cross.book.read.quoteAssets([settleQty]);
    const proceeds = quoted[0] as bigint;
    const fee = quoted[1] as bigint;
    const net = quoted[2] as bigint;

    await mine(
      h,
      await h.underlying.write.mint([counterparty, proceeds], {
        account: h.wallets[ROLE_INDEX.deployer].account,
      }),
    );
    await mine(
      h,
      await h.underlying.write.approve([cross.book.address, proceeds], {
        account: h.wallets[3].account,
      }),
    );

    const sellerPublicBefore = (await h.underlying.read.balanceOf([seller])) as bigint;
    const feePublicBefore = (await h.underlying.read.balanceOf([feeBeneficiary])) as bigint;
    const counterpartySeriesBefore = await confidentialBalance(h, series.token, 3);

    const receipt = await mine(
      h,
      await cross.book.write.settleResidualPublicly(
        [exitId, settleQty, decrypted.decryptionProof, counterparty],
        { account: h.wallets[sellerIndex].account },
      ),
    );
    gas.settleResidualPublicly = String(receipt.gasUsed);

    assert.equal(
      (await h.underlying.read.balanceOf([seller])) as bigint,
      sellerPublicBefore + net,
      "the seller received public loan tokens, net of the declared fee",
    );
    assert.equal(
      (await h.underlying.read.balanceOf([feeBeneficiary])) as bigint,
      feePublicBefore + fee,
      "and the fee went to the immutable beneficiary",
    );
    assert.equal(
      await confidentialBalance(h, series.token, 3),
      counterpartySeriesBefore + settleQty,
      "the public counterparty received the claim",
    );

    /**
     * THE TWO IDENTITIES, MEASURED END TO END.
     *
     *   series debited from the seller = series credited to the buyer + series sold publicly
     *                                    + what is still escrowed
     *   assets debited from the buyer  = assets credited to the seller + declared fees + dust returned
     *
     * Every term is decrypted from the chain as its owner. Nothing is inferred, and nothing is
     * allowed to be "close": a book whose rounding leaked a unit would fail here by that unit.
     */
    const sellerSeriesNow = await readSeriesBalance(h, series, sellerIndex, seller);
    const buyerSeriesNow = await confidentialBalance(h, series.token, buyerIndex);
    const stillEscrowed = await decryptAs(
      h,
      sellerIndex,
      (await cross.book.read.confidentialEscrowOf([exitId])) as Handle,
    );

    assert.equal(
      opening.sellerSeries - sellerSeriesNow,
      buyerSeriesNow - opening.buyerSeries + settleQty + stillEscrowed,
      "series conservation: debited from the seller = credited to the buyer + sold publicly + escrowed",
    );

    const sellerAssetsNow = await confidentialBalance(h, h.asset, sellerIndex);
    const buyerAssetsNow = await confidentialBalance(h, h.asset, buyerIndex);
    const feeAssetsNow = await confidentialBalance(h, h.asset, ROLE_INDEX.residueBeneficiary);

    assert.equal(
      opening.buyerAssets - buyerAssetsNow,
      sellerAssetsNow - opening.sellerAssets + (feeAssetsNow - opening.fee),
      "asset conservation: debited from the buyer = credited to the seller + declared fees",
    );
    assert.equal(
      opening.buyerAssets - buyerAssetsNow,
      model.cost,
      "and the buyer paid exactly the modelled cost — the dust came back on cancellation",
    );
  });

  it("15c. a residual proof cannot be substituted, and cannot over-settle", async () => {
    const residualHandle = (await cross.book.read.orderOf([exitId]))[6] as Handle;
    const publicClient = await clientFor(h, outsiderIndex);
    const decrypted = await publicClient.publicDecrypt(residualHandle, SUITE_POLL);
    const counterparty = h.wallets[3].account.address as `0x${string}`;

    // Over-settling beyond the proven residual. The bound is the PROOF, not a stored number a
    // caller could have influenced.
    await assertRevertsWithError(
      () =>
        cross.book.write.settleResidualPublicly(
          [exitId, decrypted.value + 1n, decrypted.decryptionProof, counterparty],
          { account: h.wallets[sellerIndex].account },
        ),
      cross.book,
      "ResidualExceeded",
      "settling more than the published residual",
    );

    // A tampered proof. `validateDecryptionProof` is a pure signature check, so the tamper must be
    // caught by the signature rather than by anything Kyrve stores.
    const tampered = `${decrypted.decryptionProof.slice(0, -2)}${
      decrypted.decryptionProof.slice(-2) === "ff" ? "ee" : "ff"
    }` as `0x${string}`;
    await assert.rejects(
      () =>
        cross.book.write.settleResidualPublicly([exitId, 1n, tampered, counterparty], {
          account: h.wallets[sellerIndex].account,
        }),
      "a tampered decryption proof must be refused",
    );
  });

  it("records the Cross gas, for the Sepolia budget", () => {
    mkdirSync(new URL("../../evidence/phase6/", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("../../evidence/phase6/cross-gas.json", import.meta.url),
      `${JSON.stringify(gas, null, 2)}\n`,
    );
    assert.ok(gas.matchOrders !== undefined, "the match must have been measured");
  });
});
