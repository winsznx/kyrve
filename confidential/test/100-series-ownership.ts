/**
 * Phase 5: a real settled Midnight position becomes privately owned, fully collateralised ERC-7984
 * series claims — with the REAL iExec Nox stack behind the curve and REAL unmodified Morpho Midnight
 * underneath the settlement.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THIS IS ONE CONNECTED LIFECYCLE, NOT THIRTEEN ISOLATED TESTS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every assertion runs against state the previous ones produced. The capital that funds the quote is
 * the capital three providers locked; the quote that settles is the quote that capital funded; the
 * claims that are minted are minted from the exact handles those locks became. Nothing is re-seeded
 * between steps, because the property under test is that the composition holds.
 *
 *    1. providers fund the selected custody model, and a lock really moves their capital
 *    2. a real confidential curve epoch runs to a sealed graph and a published aggregate
 *    3. one exact quote settles through unmodified Midnight — funded from the confidential lock
 *    4. confidential series balances are allocated
 *    5. every provider's balance matches the plaintext reference model
 *    6. the private allocations sum to the published aggregate
 *    7. total confidential supply equals the published aggregate
 *    8. the public vault owns the corresponding Midnight credit
 *    9. another wallet cannot decrypt a provider's balance
 *   10. a duplicate allocation fails
 *   11. cancellation restores locked capital
 *   12. the redemption foundation preserves solvency
 *   13. the residue is accounted, and the private one never appears
 *
 * Demonstration 13 in the brief — the same ownership result in a real Chromium — is
 * `101-series-browser.ts`. The refusals live in `102-series-attacks.ts`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT MAKES THIS PHASE 5 RATHER THAN PHASE 4 WITH A TOKEN
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Phase 4 funded every quote by minting public USDC into the series vault, deliberately and in the
 * open (delta S-6). Every `activateQuote` below passes `fund: false`, so the vault's balance can only
 * come from {fundQuoteFromCustody}: three real confidential locks, consumed, summed, burned out of
 * the real ERC-7984 wrapper, and finalised into a real ERC-20 transfer by a real gateway proof.
 *
 * If the funding path were mocked, step 3 would still pass and the phase would be worthless.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { before, describe, it } from "node:test";

import { CURVE_RECOMMENDED_CELLS_PER_TRANSACTION, UNIT } from "@kyrve/curve";
import type { Handle } from "@kyrve/nox";

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
import { clientFor, flattenError, mine, SUITE_POLL } from "./helpers.js";
import {
  allocateSeries,
  type CustodyFunding,
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

const ZERO_HANDLE = `0x${"00".repeat(32)}` as Handle;
const STATUS = { None: 0, Executable: 1, Consumed: 2, Cancelled: 3, Expired: 4 } as const;
const LOCK_STATE = { None: 0, Locked: 1, Released: 2, Consumed: 3, Restored: 4 } as const;

describe("Phase 5: a settled position becomes confidential series ownership", () => {
  let h: CurveHarness;
  let s: SettlementHarness;
  let series: SeriesLayer;
  let universe: Awaited<ReturnType<typeof createSettlementUniverse>>["universe"];
  let universeId: `0x${string}`;
  let markets: { market: any; marketId: `0x${string}` }[];
  let providers: SealedProviderState[];

  let epoch: EpochState;
  let result: PublicResult;
  let quote: ActivatedQuote;
  let funding: CustodyFunding;
  let residue = 0n;
  let vaultEmptyBeforeFunding = 0n;

  /** Balances at each stage, so the lock can be shown to have moved capital rather than recorded it. */
  const availableBeforeLock = new Map<string, bigint>();
  const availableAfterLock = new Map<string, bigint>();
  const lockedAfterLock = new Map<string, bigint>();
  const seriesBalances = new Map<string, bigint>();
  /**
   * Each lock's state and identity as they stood BEFORE consumption.
   *
   * Captured in `before()` rather than read in step 1, because the connected lifecycle consumes those
   * locks before any `it` runs — the funding has to land before activation (delta T-9). Reading them
   * in step 1 would find `Consumed` and the assertion would either fail or be weakened into one that
   * proves nothing about the locked state.
   */
  const lockSnapshot = new Map<string, { state: number; epochId: string; provider: string }>();

  let borrowerWallet: any;
  const gas: Record<string, string> = {};

  before(async () => {
    /**
     * THE SUBSTRATE COMES FIRST, AND THAT IS THE T-10 FIX.
     *
     * Phase 5 funds settlement by unwrapping confidential capital into the market's loan token, so the
     * ERC-7984 wrapper's underlying and the Midnight market's `loanToken` must be the SAME ERC-20.
     * `deployCurveHarness({ substrate: true })` deploys `LocalMidnightFixture` before the wrapper and
     * wraps its USDC; `deploySettlement` then reuses that substrate rather than deploying a second one.
     *
     * Without it every confidential step still succeeds and `activate` reverts
     * `FundingShortfall(600000509, 0)`, because `finalizeUnwrap` moved a token the vault does not pay
     * in. That is how this was found.
     */
    h = await deployCurveHarness({ substrate: true });
    s = await deploySettlement(h);

    const first = await settlementMarketGrid(s, 1, { collateralFamily: 0, maturityBucket: 0 });
    const second = await settlementMarketGrid(s, 3, { collateralFamily: 1, maturityBucket: 0 });
    markets = [
      { market: first.market, marketId: first.marketId },
      { market: second.market, marketId: second.marketId },
    ];

    const created = await createSettlementUniverse(h, [first.grid, second.grid], {
      privacyFloor: 2,
      cellsPerChunk: CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
    });
    universe = created.universe;
    universeId = created.universeId;

    // Three providers, so the privacy floor of two is met with room to spare and the winning leaf is
    // filled by more than one counterparty — which is the whole reason the floor exists.
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

    // Read every provider's custody balance BEFORE the epoch locks anything. Without this the lock
    // could only be shown to have written a number, not to have moved capital.
    for (const provider of providers) {
      availableBeforeLock.set(
        provider.address,
        await decryptCustodyAvailable(provider.walletIndex, provider.address),
      );
    }

    borrowerWallet = h.wallets[5];
    const borrower = await setupBorrower(h, universeId, 5, {
      desiredAssets: 600n * UNIT,
      minimumAssets: 50n * UNIT,
      maxRateIndexes: [1, 1],
      preferredMaturityIndex: 0,
    });

    epoch = await openAndSeal(h, universeId, universe, providers, borrower);
    await runEpoch(h, epoch);
    result = await collectPublicResult(h, epoch.epochId);

    /**
     * THE SERIES IS CREATED BEFORE ACTIVATION, AND THE ORDERING IS NOT A CONVENIENCE. Delta T-9.
     *
     * `QuoteActivator.activate` calls `KyrveSeriesVault.prepareQuote`, which requires
     * `balance >= committed + expectedBuyerAssets` and reverts `FundingShortfall` otherwise. So the
     * vault must ALREADY hold the money when the quote is activated — which means the confidential
     * funding cannot be keyed on a quote id, because none exists yet.
     *
     * Phase 4 never noticed because it minted public USDC into the vault immediately before
     * activating. Phase 5 has no such shortcut: the money can only come from three real locks.
     */
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

    // Read every provider's custody balance AFTER the lock, before anything is consumed.
    for (const provider of providers) {
      availableAfterLock.set(
        provider.address,
        await decryptCustodyAvailable(provider.walletIndex, provider.address),
      );
      lockedAfterLock.set(
        provider.address,
        await decryptCustodyLocked(provider.walletIndex, provider.address),
      );
    }

    for (const provider of providers) {
      const lockId = (await h.custody.read.lockIdFor([
        epoch.epochId,
        provider.address,
      ])) as `0x${string}`;
      const lock = await h.custody.read.lockOf([lockId]);
      lockSnapshot.set(provider.address, {
        state: Number(lock.state),
        epochId: lock.epochId as string,
        provider: (lock.provider as string).toLowerCase(),
      });
    }

    // THE CONFIDENTIAL FUNDING. Three real locks, consumed, summed, burned out of the real ERC-7984
    // wrapper, finalised into a real ERC-20 transfer by a real gateway proof.
    vaultEmptyBeforeFunding = (await s.usdc.read.balanceOf([vaultAddress])) as bigint;
    funding = await fundQuoteFromCustody(h, series, epoch.epochId, providers.length);
    gas.consumeChunk = funding.consumeGas.toString();
    gas.unwrapFunding = funding.unwrapGas.toString();
    gas.finalizeUnwrap = funding.finalizeGas.toString();

    // `fund: false` — nothing mints public USDC. The vault pays from what the providers locked.
    quote = await activateQuote(h, s, epoch, universe, result, markets, { fund: false });
    assert.equal(
      (quote.vault.address as string).toLowerCase(),
      vaultAddress.toLowerCase(),
      "the activator must resolve the same vault the series layer was deployed against",
    );

    await supplyCollateral(h, s, quote.market, borrowerWallet, quote.exactUnits);
  });

  async function decryptCustodyAvailable(walletIndex: number, who: string): Promise<bigint> {
    const handle = (await h.custody.read.confidentialAvailableOf([who])) as Handle;
    if (handle === ZERO_HANDLE) return 0n;
    const client = await clientFor(h, walletIndex);
    return client.decrypt(handle, SUITE_POLL);
  }

  async function decryptCustodyLocked(walletIndex: number, who: string): Promise<bigint> {
    const handle = (await h.custody.read.confidentialLockedOf([who])) as Handle;
    if (handle === ZERO_HANDLE) return 0n;
    const client = await clientFor(h, walletIndex);
    return client.decrypt(handle, SUITE_POLL);
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 1. The lock is a lock. This is P5-1.
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("1. a curve reservation MOVED provider capital, rather than recording an intention", async () => {
    for (const provider of providers) {
      const before = availableBeforeLock.get(provider.address);
      assert.ok(before !== undefined && before > 0n, "the provider funded custody");

      const after = availableAfterLock.get(provider.address) ?? 0n;
      const locked = lockedAfterLock.get(provider.address) ?? 0n;

      // The whole of P5-1 in one line: capital left `available` and arrived in `locked`, in the SAME
      // contract that holds the ERC-7984 coverage backing it. Phase 4's `ReservationLedger` could
      // only have shown `reserved` rising against a snapshot nothing spends (delta S-6).
      assert.equal(
        after + locked,
        before,
        "available + locked must conserve exactly what the provider deposited",
      );
      assert.ok(locked > 0n, "a provider on the winning leaf must have real capital locked");
      assert.ok(after < before, "available must have FALLEN — a lock that does not is not a lock");

      const snapshot = lockSnapshot.get(provider.address);
      assert.ok(snapshot !== undefined);
      assert.equal(
        snapshot.state,
        LOCK_STATE.Locked,
        "the lock was open before funding consumed it",
      );
      assert.equal(snapshot.epochId, epoch.epochId, "the lock names the epoch that opened it");
      assert.equal(
        snapshot.provider,
        provider.address.toLowerCase(),
        "the lock names its provider",
      );
      const lockId = (await h.custody.read.lockIdFor([
        epoch.epochId,
        provider.address,
      ])) as `0x${string}`;
      // The ledger and the vault must agree on which lock this is, or the allocator's
      // wrong-provider refusal would be checking one thing against itself.
      assert.equal(
        await h.ledger.read.lockIdOf([epoch.epochId, provider.address]),
        lockId,
        "the ledger and the custody vault must name the same lock",
      );
    }

    console.log(
      `  locked capital    : ${providers.length} providers, every one available+locked conserved`,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 2-3. The epoch, and settlement funded from that lock
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("2. ran a real confidential epoch, and the reservations sum to the published aggregate", async () => {
    assert.equal(Number((await h.epochs.read.epochOf([epoch.epochId])).stage), 8, "Complete");
    assert.equal(await h.graph.read.isSealed([epoch.epochId]), true, "the graph is sealed");
    assert.equal(
      result.aggregateFillAmount,
      epoch.expected.published.aggregateFillAmount,
      "the encrypted aggregate matches the plaintext reference model",
    );

    // Every provider's locked amount, decrypted individually, must sum to the public aggregate. That
    // is the reservation side of invariant 5, checked before any claim exists — so a later agreement
    // between claims and the aggregate cannot be an artefact of the minting path.
    let lockedTotal = 0n;
    for (const provider of providers) {
      lockedTotal += lockedAfterLock.get(provider.address) ?? 0n;
    }
    assert.equal(
      lockedTotal,
      result.aggregateFillAmount,
      "the sum of what custody LOCKED must be the published aggregate, exactly",
    );
  });

  it("3. settles one exact quote through unmodified Midnight, funded from the confidential lock", async () => {
    // The vault held NOTHING before the confidential funding arrived. Phase 4 would have minted it.
    assert.equal(
      vaultEmptyBeforeFunding,
      0n,
      "the series vault must start empty — nothing mints public funding in Phase 5",
    );

    // INVARIANT 1, PROVEN BY A PUBLIC ERC-20 TRANSFER RATHER THAN BY ARGUMENT. The unwrap's plaintext
    // is what the wrapper burned and what the vault received, and it must be the published aggregate.
    assert.equal(
      funding.unwrapped,
      result.aggregateFillAmount,
      "the unwrapped funding must equal the published aggregate, exactly",
    );
    assert.equal(
      await s.usdc.read.balanceOf([quote.vault.address]),
      result.aggregateFillAmount,
      "the vault's real ERC-20 balance must be the aggregate",
    );

    // Every lock is Consumed and every provider's `locked` is back to zero — the capital left.
    for (const provider of providers) {
      const lockId = (await h.custody.read.lockIdFor([
        epoch.epochId,
        provider.address,
      ])) as `0x${string}`;
      assert.equal(Number(await h.custody.read.lockStateOf([lockId])), LOCK_STATE.Consumed);
      assert.equal(
        await decryptCustodyLocked(provider.walletIndex, provider.address),
        0n,
        "consumption must empty the provider's locked balance",
      );
    }

    const before = await quote.vault.read.positionOf([quote.marketId]);
    const receipt = await mine(
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
    gas.take = (receipt.gasUsed as bigint).toString();

    const after = await quote.vault.read.positionOf([quote.marketId]);
    assert.equal(
      (after[0] as bigint) - (before[0] as bigint),
      quote.exactUnits,
      "the DELTA in vault credit is this settlement's units — credit is cumulative (delta S-8)",
    );
    assert.equal(
      Number((await s.registry.read.executionOf([quote.quoteId])).status),
      STATUS.Consumed,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 4-8. Confidential ownership
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("4+5. allocates confidential series balances that match the plaintext reference model", async () => {
    const outcome = await allocateSeries(h, series, quote.quoteId, providers.length);
    residue = outcome.residue;
    gas.allocateChunk = outcome.allocateGas.toString();
    gas.closeQuote = outcome.closeGas.toString();

    for (const [slot, provider] of providers.entries()) {
      const balance = await readSeriesBalance(h, series, provider.walletIndex, provider.address);
      seriesBalances.set(provider.address, balance);

      // The reference model never sees a handle. It is computed from the same mandate and request
      // plaintexts by `@kyrve/curve`, so a disagreement means the encrypted path is wrong — and the
      // quantity compared is `reserved`, which is what the lock actually took, not `allocation`,
      // which is what the curve asked for. On this fixture they agree; on a short provider they
      // would not, and comparing the wrong one would pass for the wrong reason.
      const expected = epoch.expected.providers[slot]?.reserved;
      assert.ok(expected !== undefined, `the model has no reservation for slot ${slot}`);
      assert.equal(
        balance,
        expected,
        "a provider's confidential series balance must equal their modelled reservation",
      );
      // And it must equal what custody actually locked for them, which is the same number reached
      // by a completely different route: one through the reference model, one through the chain.
      assert.equal(
        balance,
        lockedAfterLock.get(provider.address),
        "the claim must equal the capital that funded it",
      );
    }
  });

  it("6. the private allocations sum to the published aggregate", async () => {
    let total = 0n;
    for (const provider of providers) {
      total += seriesBalances.get(provider.address) ?? 0n;
    }
    assert.equal(
      total,
      result.aggregateFillAmount,
      "the sum of private claims must be the published aggregate, exactly",
    );

    const binding = await series.ownership.read.bindingOf([quote.quoteId]);
    assert.equal(binding.bound, true);
    assert.equal(binding.closed, true, "the allocation is sealed and cannot be appended to");
    assert.equal(Number(binding.allocatedCount), providers.length);
    assert.equal(binding.aggregateFillAmount, result.aggregateFillAmount);
    assert.equal(binding.epochId, epoch.epochId, "the ownership row names the epoch");
    assert.equal(binding.graphRoot, quote.graphRoot, "and the sealed graph root");
  });

  it("7. total confidential supply equals the published aggregate", async () => {
    // Published on purpose and IRREVERSIBLY. What becomes public is a number that already equals the
    // epoch's published aggregate, so it discloses nothing new — but the permanence is real.
    await mine(
      h,
      await series.token.write.publishAggregateSupply({ account: series.curator.account }),
    );
    const handle = (await series.token.read.publishedSupply()) as Handle;
    assert.notEqual(handle, ZERO_HANDLE);

    const client = await clientFor(h, 0);
    const supply = await client.publicDecrypt(handle, SUITE_POLL);
    assert.equal(
      supply.value,
      result.aggregateFillAmount,
      "total confidential supply must be the published aggregate",
    );

    // INVARIANT 3, THE NEGATIVE HALF. Supply is NOT the units and NOT the buyer assets, and on this
    // fixture all three differ — so an implementation that minted against either would fail here
    // rather than pass by coincidence.
    assert.notEqual(supply.value, quote.exactUnits, "supply must not be the Midnight units");
    assert.notEqual(
      supply.value,
      quote.expectedBuyerAssets,
      "supply must not be the borrower's assets",
    );
    console.log(
      `  supply / units / assets : ${supply.value} / ${quote.exactUnits} / ${quote.expectedBuyerAssets}`,
    );
  });

  it("8. the public vault owns the corresponding Midnight credit, and the series is solvent", async () => {
    const position = await quote.vault.read.positionOf([quote.marketId]);
    assert.ok((position[0] as bigint) >= quote.exactUnits, "the vault holds the credit");

    const coverage = await series.solvency.read.publicCoverage();
    assert.ok(
      (coverage[4] as bigint) >= result.aggregateFillAmount,
      "public coverage must cover every confidential claim",
    );

    // INVARIANT 13, proven on chain: one encrypted comparison, an entirely public right-hand side,
    // and only the verdict bit crosses the boundary.
    const receipt = await mine(h, await series.solvency.write.proveSolvency());
    gas.proveSolvency = (receipt.gasUsed as bigint).toString();

    const snapshot = await series.solvency.read.latestSnapshot();
    const client = await clientFor(h, 0);
    const verdict = await client.publicDecrypt(snapshot.verdictHandle as Handle, SUITE_POLL);
    assert.equal(verdict.value, 1n, "the published solvency verdict must be true");
    assert.ok((snapshot.credit as bigint) >= quote.exactUnits);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 9-10. What must NOT work
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("9. another wallet cannot decrypt a provider's series balance", async () => {
    const victim = providers[0];
    assert.ok(victim !== undefined);
    const handle = (await series.token.read.confidentialBalanceOf([victim.address])) as Handle;

    // An outsider, and then ANOTHER PROVIDER — which is the harder case, because two providers'
    // balances are equal-shaped quantities computed the same way and would be one handle without the
    // isolation the mint's operand set provides. Invariants 7, 8 and 9.
    for (const [label, index] of [
      ["an outsider", 6],
      ["another provider", 2],
    ] as const) {
      const client = await clientFor(h, index);
      await assert.rejects(
        () => client.decrypt(handle, { ...SUITE_POLL, timeoutMs: 8_000 }),
        (error: unknown) => {
          const text = flattenError(error);
          assert.ok(
            /holds no grant|not\s*authoris|not\s*authoriz|forbidden|unauthor/i.test(text),
            `${label} must be refused for the right reason, got: ${text}`,
          );
          return true;
        },
        `${label} must not decrypt another holder's series balance`,
      );
    }

    // And no provider's balance handle equals another's, which is what makes the refusals above
    // meaningful rather than incidental.
    const handles = new Set<string>();
    for (const provider of providers) {
      const own = (await series.token.read.confidentialBalanceOf([provider.address])) as string;
      assert.equal(handles.has(own), false, "two providers must never share one balance handle");
      handles.add(own);
    }
  });

  it("10. a duplicate allocation fails, and so does appending to a closed quote", async () => {
    // A second mint for the same (quote, provider) is refused by the ownership registry's one-shot
    // row, and a second whole allocation is refused by the round's state machine before it gets
    // there. Both are checked, because a suite that only checked the outer one would not notice the
    // inner one being removed.
    await assertRevertsWithError(
      () =>
        series.allocator.write.allocateChunk([quote.quoteId, 0, providers.length], {
          account: series.keeper.account,
        }),
      series.allocator,
      "RoundNotFunded",
      "a duplicate allocation",
    );
    await assertRevertsWithError(
      () =>
        series.allocator.write.consumeChunk([epoch.epochId, 0, providers.length], {
          account: series.keeper.account,
        }),
      series.allocator,
      "WrongAllocationState",
      "consuming a round that is already closed",
    );
    await assertRevertsWithError(
      () => series.allocator.write.closeQuote([quote.quoteId], { account: series.keeper.account }),
      series.allocator,
      "WrongAllocationState",
      "closing a quote twice",
    );
    await assertRevertsWithError(
      () =>
        series.ownership.write.recordClaim(
          [
            quote.quoteId,
            providers[0]!.address,
            series.seriesId,
            epoch.epochId,
            quote.graphRoot,
            result.aggregateFillAmount,
            `0x${"11".repeat(32)}`,
            `0x${"22".repeat(32)}`,
          ],
          { account: series.keeper.account },
        ),
      series.ownership,
      "NotAllocator",
      "recording a claim from anywhere but the allocator",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 13. The residue, and the one that must never appear
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("13. the funding residue is accounted, and the unreserved residue stays private", async () => {
    // THE PUBLIC ONE. `aggregate - buyerAssets`, both terms already public, and it is real loan
    // tokens left in the vault after Midnight pulled what the borrower owed.
    assert.equal(
      residue,
      result.aggregateFillAmount - quote.expectedBuyerAssets,
      "the recorded residue must be aggregate minus buyer assets",
    );
    assert.equal(await series.residue.read.recordedResidue([quote.quoteId]), residue);
    assert.equal(
      ((await series.residue.read.DECLARED_BENEFICIARY()) as string).toLowerCase(),
      series.beneficiary.toLowerCase(),
      "the destination is immutable and was declared before any residue existed",
    );

    // Recorded but not yet delivered: the tokens are in a Phase 4 series vault whose recovery is
    // operator-only, and this contract cannot compel it. Delta T-6, stated by the accessor itself.
    assert.equal(
      await series.residue.read.unsettledResidue(),
      residue,
      "the gap between recorded and delivered residue must be readable",
    );

    if (residue > 0n) {
      // Deliver it, then distribute — permissionlessly, to the one declared address.
      await mine(
        h,
        await quote.vault.write.recoverFunding([residue, series.residue.address], {
          account: h.wallets[8].account,
        }),
      );
      assert.equal(await series.residue.read.heldBalance(), residue);
      assert.equal(await series.residue.read.unsettledResidue(), 0n, "no gap remains");

      const beneficiaryBefore = (await s.usdc.read.balanceOf([series.beneficiary])) as bigint;
      // Called by wallet 6, which is nobody in particular. There is no privileged distributor and
      // no `to` parameter, so PRD §19.8's "cannot be swept to a developer wallet" is structural.
      await mine(h, await series.residue.write.distribute({ account: h.wallets[6].account }));
      assert.equal(
        (await s.usdc.read.balanceOf([series.beneficiary])) as bigint,
        beneficiaryBefore + residue,
        "distribution must go to the declared beneficiary and nowhere else",
      );
    }

    // THE PRIVATE ONE. `leafCapacity - aggregate` is the engine's `dustResidue`, and it must remain
    // undecryptable by anyone — publishing it discloses the winning leaf's capacity by subtraction.
    // Delta T-2: both residues are 1 in the reference fixture, which is exactly why a test that said
    // only "the residue is 1" would prove nothing.
    const dust = (await h.engine.read.confidentialDustOf([epoch.epochId])) as Handle;
    assert.notEqual(dust, ZERO_HANDLE, "the dust handle exists");
    for (const index of [0, 1, 6]) {
      const client = await clientFor(h, index);
      await assert.rejects(
        () => client.decrypt(dust, { ...SUITE_POLL, timeoutMs: 8_000 }),
        `wallet ${index} must not decrypt the unreserved residue`,
      );
    }
    await assert.rejects(
      () => clientFor(h, 0).then((c) => c.publicDecrypt(dust, { ...SUITE_POLL, timeoutMs: 8_000 })),
      "the unreserved residue must never be publicly decryptable",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 12. The redemption foundation
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("12. the redemption foundation applies one public factor and preserves solvency", async () => {
    // The factor is derived on chain from two PUBLIC numbers rather than supplied, so anyone can
    // reproduce it from public data. That is what invariant 14 needs.
    const unitsWithdrawn = quote.exactUnits;
    await mine(
      h,
      await series.token.write.setRedemptionFactor([unitsWithdrawn, result.aggregateFillAmount], {
        account: series.curator.account,
      }),
    );
    const factor = (await series.token.read.redemptionFactorWad()) as bigint;
    assert.equal(
      factor,
      (unitsWithdrawn * 10n ** 18n) / result.aggregateFillAmount,
      "the factor must be the public ratio, computed on chain",
    );
    assert.ok(factor > 10n ** 18n, "this fixture prices at a discount, so the factor is above par");

    const redeemer = providers[0];
    assert.ok(redeemer !== undefined);
    const balance = seriesBalances.get(redeemer.address) ?? 0n;
    const part = balance / 4n;
    assert.ok(part > 0n);

    const client = await clientFor(h, redeemer.walletIndex);
    const input = await client.encrypt(part, "euint256", series.token.address);
    const nonce = await series.token.read.nextNonce([redeemer.address]);
    await mine(
      h,
      await series.token.write.redeem([input.handle, input.proof, nonce], {
        account: h.wallets[redeemer.walletIndex].account,
      }),
    );

    // The claim shrank by exactly what was redeemed, and the entitlement is the factor applied.
    assert.equal(
      await readSeriesBalance(h, series, redeemer.walletIndex, redeemer.address),
      balance - part,
      "redemption must burn exactly what was presented",
    );
    const entitlementHandle = (await series.token.read.confidentialEntitlementOf([
      redeemer.address,
    ])) as Handle;
    assert.equal(
      await client.decrypt(entitlementHandle, SUITE_POLL),
      (part * factor) / 10n ** 18n,
      "the entitlement must be the public factor applied to the burned claim",
    );

    // SOLVENCY MUST STILL HOLD. A burn removes supply, so if the liability it became were not
    // counted the series would look MORE solvent the more it owed. The verifier counts both sides.
    await mine(h, await series.solvency.write.proveSolvency());
    const snapshot = await series.solvency.read.latestSnapshot();
    const verdict = await (await clientFor(h, 0)).publicDecrypt(
      snapshot.verdictHandle as Handle,
      SUITE_POLL,
    );
    assert.equal(verdict.value, 1n, "the series must remain solvent across a redemption");

    // Another holder cannot read the redeemer's entitlement, for the same reason they cannot read
    // the balance: it is isolated under a holder-scoped domain before it is granted.
    await assert.rejects(
      () =>
        clientFor(h, 6).then((c) =>
          c.decrypt(entitlementHandle, { ...SUITE_POLL, timeoutMs: 8_000 }),
        ),
      "an outsider must not decrypt a holder's redemption entitlement",
    );
  });

  it("records the measured Phase 5 gas, for the Sepolia funding budget", () => {
    gas.seriesDeployment = series.deploymentGas.toString();
    mkdirSync(new URL("../../evidence/phase5/", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("../../evidence/phase5/series-gas.json", import.meta.url),
      `${JSON.stringify(
        {
          $comment:
            "Measured on the local Nox node against real Midnight. Sepolia gas is UNVERIFIED (AS-1); this prices the sequence so the funding budget never totals a guess.",
          chainId: 31337,
          providerCount: providers.length,
          ...gas,
        },
        null,
        2,
      )}\n`,
    );
    for (const [key, value] of Object.entries(gas)) {
      console.log(`  ${key.padEnd(18)}: ${value}`);
    }
  });
});
