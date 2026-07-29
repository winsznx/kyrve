/**
 * Phase 4: one confidential epoch becomes one public quote and settles exactly once, through REAL
 * unmodified Morpho Midnight, with the REAL iExec Nox stack behind the curve.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THIS IS ONE CONNECTED LIFECYCLE, NOT SEVENTEEN ISOLATED TESTS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every assertion below runs against state the previous ones produced. The quote that rejects a
 * partial fill is the quote that then settles; the quote that settles is the quote that then
 * rejects a replay. Nothing is re-seeded between steps, because the property being proven is that
 * the composition holds — and a suite that rebuilt its fixture between each attack would prove only
 * that each check works in isolation, which is the easier and less useful claim.
 *
 *    1. a real curve epoch runs to a sealed graph and a published aggregate
 *    2. the selected leaf decrypts publicly, through the real gateway
 *    3. the proof and the graph binding verify on chain
 *    4. one Midnight offer is activated from it
 *    5. only the approved borrower may take it
 *    6. a partial fill is rejected
 *    7. the rejected fill leaves NO state behind
 *    8. an oversized fill is rejected
 *    9. the exact fill settles
 *   10. borrower debt and vault credit both exist, publicly
 *   11. exactly `buyerAssets` moved, and no allowance survived
 *   12. the quote is consumed
 *   13. a replay is rejected
 *   14. an unused quote can be cancelled
 *   15. an expired quote can be recovered, by anyone
 *   16. wrong market, tick, callback, ratifier, group and deployment are each rejected by name
 *   17. a tampered decryption proof is rejected by the gateway's own signature check
 *
 * Demonstration 18 — the same flow in a real Chromium — is `91-settlement-browser.ts`.
 *
 * Nothing on either path is mocked. `contracts/kyrve/test/CurveLayerStub.sol` exists for the
 * Foundry suite and is absent here on purpose: this file's entire value is that the curve result
 * being settled is one a real KMS, ingestor, runner and gateway produced.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { before, describe, it } from "node:test";

import { CURVE_RECOMMENDED_CELLS_PER_TRANSACTION, UNIT } from "@kyrve/curve";
import { encodeOffer } from "@kyrve/midnight";
import { keccak256 } from "viem";

import {
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
import { flattenError, mine } from "./helpers.js";
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

/** Midnight's `QuoteStatus`, mirrored. */
const STATUS = { None: 0, Executable: 1, Consumed: 2, Cancelled: 3, Expired: 4 } as const;

describe("Phase 4: one confidential quote settles once, through unmodified Midnight", () => {
  let h: CurveHarness;
  let s: SettlementHarness;
  let universe: Awaited<ReturnType<typeof createSettlementUniverse>>["universe"];
  let universeId: `0x${string}`;
  let markets: { market: any; marketId: `0x${string}` }[];
  let providers: SealedProviderState[];

  let epoch: EpochState;
  let result: PublicResult;
  let quote: ActivatedQuote;

  /** Second and third epochs, for the two terminal states settlement cannot also reach. */
  let cancelEpoch: EpochState;
  let cancelQuote: ActivatedQuote;
  let expireEpoch: EpochState;
  let expireQuote: ActivatedQuote;

  let borrowerWallet: any;
  let attackerWallet: any;
  /** Recorded so the Sepolia funding budget prices a measured sequence, never a guessed one. */
  let settlementGas = 0n;

  before(async () => {
    h = await deployCurveHarness();
    s = await deploySettlement(h);

    // Two REAL Midnight markets, each with a two-rate grid whose prices are `TickLib.tickToPrice`.
    // Both halves matter: the activator checks the market against Midnight's own `IdLib.toId` and
    // the price against the pinned library, so the Phase 3 fixture universe — synthetic ids, a
    // synthetic price curve — is correctly refused.
    const first = await settlementMarketGrid(s, 1, { collateralFamily: 0, maturityBucket: 0 });
    const second = await settlementMarketGrid(s, 3, { collateralFamily: 1, maturityBucket: 0 });
    markets = [
      { market: first.market, marketId: first.marketId },
      { market: second.market, marketId: second.marketId },
    ];

    // 192 cells per chunk — the bound the registry now enforces, read from the constant rather
    // than repeated. This universe has four cells, so the width is not what makes the epoch run;
    // configuring it at the maximum is what proves the maximum is usable. Delta S-2.
    const created = await createSettlementUniverse(h, [first.grid, second.grid], {
      privacyFloor: 2,
      cellsPerChunk: CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
    });
    universe = created.universe;
    universeId = created.universeId;

    // Three providers so the privacy floor of two is met with room to spare, and so the winning
    // leaf is filled by more than one counterparty — which is the whole point of the floor.
    providers = [
      await setupProvider(h, universeId, {
        walletIndex: 1,
        mandate: { marketCaps: [400n * UNIT, 400n * UNIT], minRateIndexes: [0, 0] },
        balance: 2_000n * UNIT,
      }),
      await setupProvider(h, universeId, {
        walletIndex: 2,
        mandate: { marketCaps: [300n * UNIT, 300n * UNIT], minRateIndexes: [0, 0] },
        balance: 1_500n * UNIT,
      }),
      await setupProvider(h, universeId, {
        walletIndex: 3,
        mandate: { marketCaps: [250n * UNIT, 250n * UNIT], minRateIndexes: [0, 0] },
        balance: 1_200n * UNIT,
      }),
    ];

    borrowerWallet = h.wallets[5];
    attackerWallet = h.wallets[6];

    const borrower = await setupBorrower(h, universeId, 5, {
      desiredAssets: 600n * UNIT,
      minimumAssets: 50n * UNIT,
      maxRateIndexes: [1, 1],
      preferredMaturityIndex: 0,
    });

    epoch = await openAndSeal(h, universeId, universe, providers, borrower);
    await runEpoch(h, epoch);
    result = await collectPublicResult(h, epoch.epochId);

    quote = await activateQuote(h, s, epoch, universe, result, markets);
    await supplyCollateral(h, s, quote.market, borrowerWallet, quote.exactUnits);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 1-3. The confidential result, and what makes it usable
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("1. runs a real curve epoch to a sealed graph and a published aggregate", async () => {
    const onChain = await h.epochs.read.epochOf([epoch.epochId]);
    assert.equal(Number(onChain.stage), 8, "the epoch reached Complete");
    assert.equal(await h.graph.read.isSealed([epoch.epochId]), true, "the graph is sealed");

    // The plaintext reference model is computed from the same inputs and never sees a handle. A
    // disagreement here means the encrypted computation is wrong, not that the model is.
    assert.equal(
      result.aggregateFillAmount,
      epoch.expected.published.aggregateFillAmount,
      "the encrypted aggregate matches the plaintext reference model",
    );
    assert.equal(result.marketIndex, epoch.expected.published.selectedMarketIndex);
    assert.equal(result.rateIndex, epoch.expected.published.selectedRateIndex);
    assert.equal(result.quoteReady, true);
    assert.equal(result.privacyFloorPassed, true);
  });

  it("2. decrypts the selected leaf publicly, through the real gateway", async () => {
    // The handles were read AFTER `publishAggregate`, which is delta R-14. Read between the two
    // publishing transactions and the fifth is undefined, carries chain id 0, and the gateway
    // answers `unknown_chain` on a path where the other four decrypt perfectly.
    for (const [role, handle] of Object.entries(result.handles)) {
      assert.notEqual(handle, `0x${"00".repeat(32)}`, `${role} handle must be published`);
      assert.equal(
        await h.graph.read.isRegisteredResult([epoch.epochId, handle]),
        true,
        `${role} handle must be one the sealed graph registered`,
      );
    }
  });

  it("3. verifies the proof and the graph binding on chain, before anything is activated", async () => {
    const verified = await s.resultVerifier.read.requireFreshHandles([epoch.epochId]);
    assert.equal(verified.aggregateFill, result.handles.aggregateFill);
    assert.equal(await s.resultVerifier.read.isActivatable([epoch.epochId]), true);

    // The same call the activator makes, read-only. A proof for the wrong handle, the wrong epoch
    // or an unsealed graph is refused here — see step 17 and `contracts/kyrve/test/Activation.t.sol`.
    const bound = await s.resultVerifier.read.verifyForActivation([
      epoch.epochId,
      quote.graphRoot,
      epoch.borrower.requestId,
      universeId,
      result.proofs.market,
      result.proofs.rate,
      result.proofs.floor,
      result.proofs.ready,
      result.proofs.aggregate,
    ]);
    assert.equal(bound.aggregateFillAmount, result.aggregateFillAmount);
    assert.equal(bound.borrower.toLowerCase(), borrowerWallet.account.address.toLowerCase());
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 4. Activation — the public/private boundary crossing
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("4. activates exactly one Midnight offer, bound to every term of the epoch", async () => {
    const execution = await s.registry.read.executionOf([quote.quoteId]);
    const provenance = await s.registry.read.provenanceOf([quote.quoteId]);

    assert.equal(Number(execution.status), STATUS.Executable);
    assert.equal(provenance.epochId, epoch.epochId, "epoch bound");
    assert.equal(provenance.graphRoot, quote.graphRoot, "graph root bound");
    assert.equal(provenance.requestId, epoch.borrower.requestId, "request bound");
    assert.equal(provenance.universeId, universeId, "universe bound");
    assert.equal(provenance.aggregateFillAmount, result.aggregateFillAmount, "aggregate bound");
    assert.equal(
      provenance.deploymentId,
      await s.registry.read.DEPLOYMENT_ID(),
      "deployment bound",
    );
    assert.equal(
      execution.taker.toLowerCase(),
      borrowerWallet.account.address.toLowerCase(),
      "the approved borrower is the request's borrower, not a parameter",
    );
    assert.equal(
      execution.vault.toLowerCase(),
      quote.vault.address.toLowerCase(),
      "the maker vault is derived from the series, not supplied",
    );

    // One epoch, one quote, forever.
    assert.equal(await s.registry.read.quoteOfEpoch([epoch.epochId]), quote.quoteId);

    // The maker never owes more than providers reserved.
    assert.ok(
      quote.expectedBuyerAssets <= result.aggregateFillAmount,
      "buyer assets must not exceed the published aggregate",
    );
    assert.equal(quote.offer.group, quote.quoteId, "the group IS the quote id");
    assert.equal(quote.offer.maker.toLowerCase(), quote.vault.address.toLowerCase());
    assert.equal(quote.offer.callback.toLowerCase(), quote.vault.address.toLowerCase());
    assert.equal(quote.offer.ratifier.toLowerCase(), s.ratifier.address.toLowerCase());
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 5-8. What must NOT settle
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("5. lets only the approved borrower take it", async () => {
    await supplyCollateral(h, s, quote.market, attackerWallet, quote.exactUnits);
    await assertRevertsWithError(
      () => take(quote.exactUnits, attackerWallet),
      s.ratifier,
      "UnauthorisedTaker",
      "an unapproved taker",
    );
    assert.equal(await creditOf(quote), 0n, "and nothing settled");
  });

  it("6. rejects a partial fill, which Midnight itself would permit", async () => {
    await assertRevertsWithError(
      () => take(quote.exactUnits - 1n, borrowerWallet),
      quote.vault,
      "WrongUnits",
      "a partial fill",
    );
    assert.equal(await creditOf(quote), 0n);
  });

  it("7. leaves NO state behind after the rejected fill", async () => {
    assert.equal(
      await s.midnight.read.consumed([quote.vault.address, quote.quoteId]),
      0n,
      "group consumption rolled back",
    );
    assert.equal(await creditOf(quote), 0n, "no credit created");
    assert.equal(await debtOf(quote, borrowerWallet.account.address), 0n, "no debt created");
    assert.equal(
      Number((await s.registry.read.executionOf([quote.quoteId])).status),
      STATUS.Executable,
      "the quote is still live",
    );
    assert.equal(
      await s.usdc.read.allowance([quote.vault.address, s.midnight.address]),
      0n,
      "no allowance survived the revert",
    );
    assert.equal(
      await quote.vault.read.committedFunding(),
      quote.expectedBuyerAssets,
      "the funding commitment is intact",
    );
  });

  it("8. rejects an oversized fill, through Midnight's own group accounting", async () => {
    // Refused by Midnight's own group accounting, before Kyrve is reached at all.
    await assertRevertsWithError(
      () => take(quote.exactUnits + 1n, borrowerWallet),
      s.midnight,
      "ConsumedUnits",
      "an oversized fill",
    );
    assert.equal(await creditOf(quote), 0n);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 9-13. The settlement, and what it makes impossible afterwards
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("9. settles the exact fill through real, unmodified Midnight", async () => {
    const before = await s.usdc.read.balanceOf([quote.vault.address]);

    settlementGas = (await take(quote.exactUnits, borrowerWallet)).gasUsed as bigint;

    const after = await s.usdc.read.balanceOf([quote.vault.address]);
    assert.equal(before - after, quote.expectedBuyerAssets, "the vault paid exactly buyer assets");
  });

  it("10. creates a public credit position for the vault and a public debt for the borrower", async () => {
    assert.equal(await creditOf(quote), quote.exactUnits, "the vault holds the public credit");
    assert.equal(
      await debtOf(quote, borrowerWallet.account.address),
      quote.exactUnits,
      "the borrower holds the public debt",
    );

    const position = await quote.vault.read.positionOf([quote.marketId]);
    assert.equal(position[0], quote.exactUnits, "the vault exposes it");
    assert.equal(position[1], 0n, "the maker takes no debt");
  });

  it("11. moved exactly the quoted assets, and left no allowance behind", async () => {
    const borrowerBalance = await s.usdc.read.balanceOf([borrowerWallet.account.address]);
    assert.ok(borrowerBalance > 0n, "the borrower received the seller assets");
    assert.ok(
      borrowerBalance <= quote.expectedBuyerAssets,
      "the borrower's proceeds are the buyer assets less the settlement fee",
    );
    assert.equal(
      await s.usdc.read.allowance([quote.vault.address, s.midnight.address]),
      0n,
      "the settlement consumed exactly the allowance it granted",
    );
    assert.equal(await quote.vault.read.committedFunding(), 0n, "the commitment is released");
  });

  it("12. consumes the quote, in Kyrve's registry and in Midnight's group accounting", async () => {
    assert.equal(
      Number((await s.registry.read.executionOf([quote.quoteId])).status),
      STATUS.Consumed,
    );
    assert.equal(
      await s.midnight.read.consumed([quote.vault.address, quote.quoteId]),
      quote.exactUnits,
      "the group is fully consumed",
    );
  });

  it("13. rejects a replay of the settled quote", async () => {
    await mine(h, await s.usdc.write.mint([quote.vault.address, quote.expectedBuyerAssets]));
    await assertRevertsWithError(
      () => take(quote.exactUnits, borrowerWallet),
      s.ratifier,
      "QuoteNotExecutable",
      "a replay of the settled quote",
    );
    assert.equal(await creditOf(quote), quote.exactUnits, "credit was created exactly once");
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 14-15. The two terminal states settlement cannot also reach
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("14. cancels an unused quote, and the cancellation is real at the protocol level", async () => {
    const borrower = await setupBorrower(h, universeId, 4, {
      desiredAssets: 300n * UNIT,
      minimumAssets: 50n * UNIT,
      maxRateIndexes: [1, 1],
      preferredMaturityIndex: 0,
    });
    cancelEpoch = await openAndSeal(h, universeId, universe, providers, borrower);
    await runEpoch(h, cancelEpoch);
    const cancelResult = await collectPublicResult(h, cancelEpoch.epochId);
    cancelQuote = await activateQuote(h, s, cancelEpoch, universe, cancelResult, markets);

    await mine(
      h,
      await s.expiryController.write.cancelQuote([cancelQuote.quoteId], {
        account: h.wallets[8].account,
      }),
    );

    assert.equal(
      Number((await s.registry.read.executionOf([cancelQuote.quoteId])).status),
      STATUS.Cancelled,
    );
    // Flipping local status alone would not be enough: the group is what Midnight accounts
    // against, and an offer is only truly dead once the group is consumed.
    assert.equal(
      await s.midnight.read.consumed([cancelQuote.vault.address, cancelQuote.quoteId]),
      cancelQuote.exactUnits,
      "the group is pre-consumed at the protocol level",
    );

    await assertRevertsWithError(
      () => take(cancelQuote.exactUnits, h.wallets[4], cancelQuote.offer),
      s.ratifier,
      "QuoteNotExecutable",
      "a cancelled quote",
    );
  });

  it("15. expires an unused quote — permissionlessly — and recovers its funding", async () => {
    const borrower = await setupBorrower(h, universeId, 7, {
      desiredAssets: 200n * UNIT,
      minimumAssets: 50n * UNIT,
      maxRateIndexes: [1, 1],
      preferredMaturityIndex: 0,
    });
    expireEpoch = await openAndSeal(h, universeId, universe, providers, borrower);
    await runEpoch(h, expireEpoch);
    const expireResult = await collectPublicResult(h, expireEpoch.epochId);
    expireQuote = await activateQuote(h, s, expireEpoch, universe, expireResult, markets, {
      lifetime: 300n,
    });

    const execution = await s.registry.read.executionOf([expireQuote.quoteId]);
    const committedBefore = (await expireQuote.vault.read.committedFunding()) as bigint;
    await h.publicClient.request({
      method: "evm_setNextBlockTimestamp",
      params: [`0x${(BigInt(execution.expiry) + 1n).toString(16)}`],
    } as never);
    await h.publicClient.request({ method: "evm_mine", params: [] } as never);

    // Permissionless on purpose: committed funding must never be hostage to an operator's uptime.
    await mine(
      h,
      await s.expiryController.write.expireQuote([expireQuote.quoteId], {
        account: attackerWallet.account,
      }),
    );

    assert.equal(
      Number((await s.registry.read.executionOf([expireQuote.quoteId])).status),
      STATUS.Expired,
    );
    // A DELTA, not a zero. One vault serves every quote of its series, so asserting the total is
    // zero would be asserting something about the other quotes' lifecycles rather than this one's.
    assert.equal(
      committedBefore - ((await expireQuote.vault.read.committedFunding()) as bigint),
      expireQuote.expectedBuyerAssets,
      "expiry releases exactly this quote's commitment",
    );

    const recoverable = (await expireQuote.vault.read.availableFunding()) as bigint;
    assert.ok(recoverable >= expireQuote.expectedBuyerAssets, "the funding is recoverable");
    await mine(
      h,
      await expireQuote.vault.write.recoverFunding([recoverable, s.operator], {
        account: h.wallets[8].account,
      }),
    );
    assert.equal(await expireQuote.vault.read.availableFunding(), 0n, "nothing left behind");
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 16-17. Every substitution, by name
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("16. rejects a wrong market, tick, callback, ratifier, group and deployment", async () => {
    // A fresh live quote to attack, so each mutation is tested against something that WOULD
    // otherwise settle. Attacking a consumed quote would pass for the wrong reason.
    const borrower = await setupBorrower(h, universeId, 10, {
      desiredAssets: 250n * UNIT,
      minimumAssets: 50n * UNIT,
      maxRateIndexes: [1, 1],
      preferredMaturityIndex: 0,
    });
    const victimEpoch = await openAndSeal(h, universeId, universe, providers, borrower);
    await runEpoch(h, victimEpoch);
    const victimResult = await collectPublicResult(h, victimEpoch.epochId);
    const victim = await activateQuote(h, s, victimEpoch, universe, victimResult, markets);
    const victimBorrower = h.wallets[10];
    await supplyCollateral(h, s, victim.market, victimBorrower, victim.exactUnits);

    const otherMarket = markets[victim.market === markets[0]?.market ? 1 : 0];
    assert.ok(otherMarket !== undefined);

    const mutations: readonly { readonly name: string; readonly mutate: (offer: any) => any }[] = [
      { name: "market", mutate: (o) => ({ ...o, market: otherMarket.market }) },
      { name: "tick", mutate: (o) => ({ ...o, tick: o.tick - 4n }) },
      {
        name: "callback",
        mutate: (o) => ({ ...o, callback: "0x0000000000000000000000000000000000000000" }),
      },
      { name: "ratifier", mutate: (o) => ({ ...o, ratifier: s.resultVerifier.address }) },
      { name: "group", mutate: (o) => ({ ...o, group: keccak256("0xdeadbeef") }) },
      { name: "maxUnits", mutate: (o) => ({ ...o, maxUnits: o.maxUnits * 2n }) },
    ];

    for (const mutation of mutations) {
      const mutated = mutation.mutate(victim.offer);
      assert.notEqual(
        keccak256(encodeOffer(mutated)),
        keccak256(encodeOffer(victim.offer)),
        `mutating ${mutation.name} must change the offer hash`,
      );
      const failure = await takeExpectingFailure(victim.exactUnits, victimBorrower, mutated);
      assert.ok(failure.length > 0, `a mutated ${mutation.name} must be rejected`);
      assert.ok(
        !failure.includes("invalid opcode"),
        `a mutated ${mutation.name} must be rejected by a NAMED revert, not by an invalid ` +
          `opcode:\n${failure.slice(0, 400)}`,
      );
    }

    // Wrong deployment: a second, complete Kyrve settlement layer against the same Midnight. Its
    // registry has never heard of this quote, which is what "wrong deployment" means here.
    const otherSettlement = await deploySettlement(h, { keeperIndex: 9, operatorIndex: 8 });
    assert.notEqual(
      await otherSettlement.registry.read.DEPLOYMENT_ID(),
      await s.registry.read.DEPLOYMENT_ID(),
      "two deployments, two identities",
    );
    assert.equal(
      Number((await otherSettlement.registry.read.executionOf([victim.quoteId])).status),
      STATUS.None,
      "the other deployment has never heard of this quote",
    );

    // And the victim still settles, so every rejection above was about the mutation and not about
    // the quote having been spoiled.
    //
    // A DELTA, because one vault is the maker for every quote of its series and its credit is
    // cumulative. Asserting the total would be asserting something about the earlier settlements.
    const creditBefore = await creditOf(victim);
    await take(victim.exactUnits, victimBorrower, victim.offer);
    assert.equal(
      (await creditOf(victim)) - creditBefore,
      victim.exactUnits,
      "the unmutated offer still settles",
    );
  });

  it("17. rejects a tampered public-decryption proof", async () => {
    // The gateway's signature is over the handle and the value. Flip one byte of the signature and
    // the recovered signer is not the gateway, so `validateDecryptionProof` refuses — before the
    // settlement layer ever sees a number.
    const tampered = flipByte(result.proofs.aggregate);
    assert.notEqual(tampered, result.proofs.aggregate);

    let refused = "";
    try {
      await s.resultVerifier.read.verifyForActivation([
        epoch.epochId,
        quote.graphRoot,
        epoch.borrower.requestId,
        universeId,
        result.proofs.market,
        result.proofs.rate,
        result.proofs.floor,
        result.proofs.ready,
        tampered,
      ]);
    } catch (error) {
      refused = flattenError(error);
    }
    assert.ok(refused.length > 0, "a tampered proof must be refused");

    // And the untampered set still verifies, so the rejection was about the tampering.
    const ok = await s.resultVerifier.read.verifyForActivation([
      epoch.epochId,
      quote.graphRoot,
      epoch.borrower.requestId,
      universeId,
      result.proofs.market,
      result.proofs.rate,
      result.proofs.floor,
      result.proofs.ready,
      result.proofs.aggregate,
    ]);
    assert.equal(ok.aggregateFillAmount, result.aggregateFillAmount);
  });

  /**
   * The measurement the Sepolia funding budget prices against.
   *
   * Recorded from receipts rather than estimated, and recorded LAST so it describes a sequence that
   * actually completed. `scripts/test/sepolia-settlement-budget.ts` refuses to produce a total while
   * any component is missing, so an unmeasured settlement path cannot be funded by guesswork.
   */
  it("records the measured settlement gas, for the Sepolia funding budget", async () => {
    assert.ok(settlementGas > 0n, "the exact fill must have been measured");
    assert.ok(quote.activationGas > 0n, "the activation must have been measured");

    const evidence = {
      $comment:
        "GENERATED by confidential/test/90-quote-settlement.ts against the real Nox stack and " +
        "real unmodified Midnight. Gas from receipts, not estimates. No decrypted value appears " +
        "here: every number is a public gas figure.",
      chainId: 31337,
      activateGas: Number(quote.activationGas),
      takeGas: Number(settlementGas),
      fundingGas: Number(quote.fundingGas),
      exactUnits: quote.exactUnits.toString(),
      expectedBuyerAssets: quote.expectedBuyerAssets.toString(),
      note:
        "The units and buyer assets are PUBLIC from activation — they are in the offer every " +
        "borrower sees. The aggregate they derive from is public too. Nothing about a provider " +
        "allocation, a leaf capacity or a provider count is representable in this file.",
    };
    mkdirSync(new URL("../../evidence/phase4/", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("../../evidence/phase4/settlement-gas.json", import.meta.url),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * `gas` is explicit on every take in this file.
   *
   * Without it viem estimates first, and an estimation that reverts surfaces as a bare
   * `ProviderError` with no revert data at all — so an assertion on WHICH error was raised would
   * silently degrade to "it failed somehow", which is the exact weakening
   * `.claude/rules/testing.md` warns about. With an explicit limit the call is submitted, the
   * revert data comes back, and the selector can be matched.
   */
  const TAKE_GAS = 15_000_000n;

  async function take(units: bigint, taker: any, offer?: any): Promise<any> {
    return mine(
      h,
      await s.midnight.write.take(
        [
          offer ?? quote.offer,
          "0x",
          units,
          taker.account.address,
          taker.account.address,
          "0x0000000000000000000000000000000000000000",
          "0x",
        ],
        { account: taker.account, gas: TAKE_GAS },
      ),
    );
  }

  async function takeExpectingFailure(units: bigint, taker: any, offer?: any): Promise<string> {
    try {
      await take(units, taker, offer);
      return "";
    } catch (error) {
      return flattenError(error);
    }
  }

  async function creditOf(target: ActivatedQuote): Promise<bigint> {
    return (await s.midnight.read.credit([target.marketId, target.vault.address])) as bigint;
  }

  async function debtOf(target: ActivatedQuote, who: `0x${string}`): Promise<bigint> {
    return (await s.midnight.read.debt([target.marketId, who])) as bigint;
  }
});

/** Flips one byte of a hex string, leaving its length untouched. */
function flipByte(hex: `0x${string}`): `0x${string}` {
  const body = hex.slice(2);
  const index = 2; // inside the 65-byte gateway signature
  const byte = Number.parseInt(body.slice(index, index + 2), 16) ^ 0xff;
  return `0x${body.slice(0, index)}${byte.toString(16).padStart(2, "0")}${body.slice(index + 2)}` as `0x${string}`;
}
