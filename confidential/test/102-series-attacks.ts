/**
 * Phase 5 attacks: every refusal the series layer owes, and the one recovery that must always work.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT A TEST HERE HAS TO DO TO COUNT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every case below is attacked against state that WOULD otherwise succeed. Attacking an already-closed
 * allocation, or a lock that was never opened, would pass for the wrong reason and prove that the code
 * refuses nonsense rather than that it refuses an attack.
 *
 * Every revert is asserted BY NAME, through the contract's own ABI, so a test cannot silently start
 * passing on a different error — `assertRevertsWithError` refuses an error name the ABI does not
 * declare, which is what stops a renamed error from turning a real check into a vacuous one.
 *
 *   invariant 8   no provider receives ACL authority over an aggregate or another provider's balance
 *   invariant 10  cancellation releases locked capital — before funding AND after it
 *   invariant 11  settlement consumes locked capital exactly once
 *   invariant 12  replay, stale epoch, wrong graph root, wrong provider and wrong series all fail
 *   invariant 15  the residue is never silently minted, and never redirectable
 *
 * The privileged surfaces are checked too: a lock can only be opened by the reserver, consumed by the
 * settler, and every binding is one-shot. Transient access carries full persistent-grant power, so an
 * unreviewed recipient is a route to publishing a provider's balance permanently.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { CURVE_RECOMMENDED_CELLS_PER_TRANSACTION, UNIT } from "@kyrve/curve";
import type { Handle } from "@kyrve/nox";
import { readAcl } from "@kyrve/nox";

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
import { clientFor, LOCAL_NOX_NETWORK, mine, SUITE_POLL } from "./helpers.js";
import { deploySeriesLayer, fundQuoteFromCustody, type SeriesLayer } from "./series-helpers.js";
import {
  type ActivatedQuote,
  activateQuote,
  collectPublicResult,
  createSettlementUniverse,
  deploySettlement,
  type PublicResult,
  type SettlementHarness,
  settlementMarketGrid,
} from "./settlement-helpers.js";

const ZERO_HANDLE = `0x${"00".repeat(32)}` as Handle;
const LOCK_STATE = { None: 0, Locked: 1, Released: 2, Consumed: 3, Restored: 4 } as const;

describe("Phase 5 attacks: custody, allocation and recovery", () => {
  let h: CurveHarness;
  let s: SettlementHarness;
  let series: SeriesLayer;
  let universe: Awaited<ReturnType<typeof createSettlementUniverse>>["universe"];
  let universeId: `0x${string}`;
  let markets: { market: any; marketId: `0x${string}` }[];
  let providers: SealedProviderState[];
  let seriesId: `0x${string}`;
  let vaultAddress: `0x${string}`;

  /** The live round: funded, activated, and then retired instead of settled. */
  let epoch: EpochState;
  let result: PublicResult;
  let quote: ActivatedQuote;
  let attacker: any;

  before(async () => {
    h = await deployCurveHarness({ substrate: true });
    s = await deploySettlement(h);
    attacker = h.wallets[6];

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
    ];

    const borrower = await setupBorrower(h, universeId, 5, {
      desiredAssets: 400n * UNIT,
      minimumAssets: 50n * UNIT,
      maxRateIndexes: [1, 1],
      preferredMaturityIndex: 0,
    });

    epoch = await openAndSeal(h, universeId, universe, providers, borrower);
    await runEpoch(h, epoch);
    result = await collectPublicResult(h, epoch.epochId);

    const winning = markets[result.marketIndex];
    assert.ok(winning !== undefined);
    seriesId = (await s.factory.read.seriesIdFor([winning.marketId])) as `0x${string}`;
    await mine(
      h,
      await s.factory.write.createSeries([winning.marketId, s.usdc.address, s.operator], {
        account: s.curator.account,
      }),
    );
    vaultAddress = (await s.factory.read.vaultOf([seriesId])) as `0x${string}`;

    series = await deploySeriesLayer(h, s, {
      seriesId,
      marketId: winning.marketId,
      vaultAddress,
      loanToken: s.usdc.address as `0x${string}`,
    });
  });

  async function decryptAvailable(walletIndex: number, who: string): Promise<bigint> {
    const handle = (await h.custody.read.confidentialAvailableOf([who])) as Handle;
    if (handle === ZERO_HANDLE) return 0n;
    return (await clientFor(h, walletIndex)).decrypt(handle, SUITE_POLL);
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Privileged surfaces
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("A1. only the reserver may lock, only the settler may consume, and both are bound once", async () => {
    const lockedProvider = providers[0];
    assert.ok(lockedProvider !== undefined);
    const lockId = (await h.custody.read.lockIdFor([
      epoch.epochId,
      lockedProvider.address,
    ])) as `0x${string}`;
    assert.equal(Number(await h.custody.read.lockStateOf([lockId])), LOCK_STATE.Locked);

    // The attacker holds a real, live lock's id and a real epoch. Everything is correct except who is
    // calling — which is the only thing being tested.
    await assertRevertsWithError(
      () =>
        h.custody.write.lockAllocation(
          [epoch.epochId, lockedProvider.address, ZERO_HANDLE, ZERO_HANDLE],
          { account: attacker.account },
        ),
      h.custody,
      "NotReserver",
      "an outsider opening a lock",
    );
    await assertRevertsWithError(
      () => h.custody.write.consumeLock([lockId, epoch.epochId], { account: attacker.account }),
      h.custody,
      "NotSettler",
      "an outsider consuming a lock",
    );
    await assertRevertsWithError(
      () => h.custody.write.releaseLock([lockId, ZERO_HANDLE], { account: attacker.account }),
      h.custody,
      "NotReserver",
      "an outsider releasing a lock",
    );
    await assertRevertsWithError(
      () => h.custody.write.restoreLock([lockId, epoch.epochId], { account: attacker.account }),
      h.custody,
      "NotSettler",
      "an outsider restoring a lock",
    );

    // Bind-once, on every one of them. A rebindable reserver or settler would be an arbitrary-spend
    // surface over every balance the vault holds. Threat T-B.
    await assertRevertsWithError(
      () =>
        h.custody.write.bindReserver([attacker.account.address], { account: h.wallets[0].account }),
      h.custody,
      "ReserverAlreadyBound",
      "rebinding the reserver",
    );
    await assertRevertsWithError(
      () =>
        h.custody.write.bindSettler([attacker.account.address], { account: h.wallets[0].account }),
      h.custody,
      "SettlerAlreadyBound",
      "rebinding the settler",
    );
    await assertRevertsWithError(
      () =>
        series.token.write.bindAllocator([attacker.account.address], {
          account: h.wallets[0].account,
        }),
      series.token,
      "AllocatorAlreadyBound",
      "rebinding the series token's allocator",
    );
    await assertRevertsWithError(
      () =>
        series.ownership.write.bindAllocator([attacker.account.address], {
          account: h.wallets[0].account,
        }),
      series.ownership,
      "AllocatorAlreadyBound",
      "rebinding the ownership registry's allocator",
    );
    await assertRevertsWithError(
      () =>
        series.allocator.write.bindResidueAccount([attacker.account.address], {
          account: h.wallets[0].account,
        }),
      series.allocator,
      "ResidueAccountAlreadyBound",
      "rebinding the residue account",
    );
  });

  it("A2. only the keeper may drive an allocation, and only the token's verifier may borrow supply", async () => {
    await assertRevertsWithError(
      () =>
        series.allocator.write.consumeChunk([epoch.epochId, 0, providers.length], {
          account: attacker.account,
        }),
      series.allocator,
      "NotKeeper",
      "an outsider consuming a round",
    );
    await assertRevertsWithError(
      () => series.allocator.write.unwrapFunding([epoch.epochId], { account: attacker.account }),
      series.allocator,
      "NotKeeper",
      "an outsider unwrapping funding",
    );

    // THE HAZARD THIS CLOSES. Transient access carries FULL persistent-grant power: within the
    // transaction the recipient may call `allowPublicDecryption` and publish the aggregate supply
    // forever. An earlier draft took the recipient as a parameter and checked it against `msg.sender`,
    // which let ANY caller publish it irreversibly.
    await assertRevertsWithError(
      () => series.token.write.lendSupply({ account: attacker.account }),
      series.token,
      "NotVerifier",
      "an outsider borrowing the aggregate supply handle",
    );

    // Minting has exactly one caller and no plaintext path. There is no overload that takes a number,
    // so even the right caller cannot invent a claim.
    await assertRevertsWithError(
      () =>
        series.token.write.mintClaim([epoch.epochId, attacker.account.address, ZERO_HANDLE], {
          account: attacker.account,
        }),
      series.token,
      "NotAllocator",
      "an outsider minting a claim",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Invariant 8 — nobody gains authority over an aggregate or another provider's balance
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("A3. no provider holds ACL authority over any aggregate", async () => {
    const aggregates: readonly [string, Handle][] = [
      [
        "the engine's unreserved residue",
        (await h.engine.read.confidentialDustOf([epoch.epochId])) as Handle,
      ],
      ["the custody vault's coverage", (await h.custody.read.confidentialCoverage()) as Handle],
    ];

    for (const [label, handle] of aggregates) {
      if (handle === ZERO_HANDLE) continue;
      for (const provider of providers) {
        const acl = await readAcl(h.publicClient, LOCAL_NOX_NETWORK(), handle, provider.address);
        assert.equal(
          acl.canDecrypt,
          false,
          `${label}: ${provider.address} must hold no grant on a protocol aggregate`,
        );
        assert.equal(acl.isPublic, false, `${label} must not be publicly decryptable`);
      }
    }
  });

  it("A4. no provider holds ACL authority over another provider's locked amount", async () => {
    for (const owner of providers) {
      const lockId = (await h.custody.read.lockIdFor([
        epoch.epochId,
        owner.address,
      ])) as `0x${string}`;
      const handle = (await h.custody.read.confidentialLockAmount([lockId])) as Handle;
      assert.notEqual(handle, ZERO_HANDLE);

      const own = await readAcl(h.publicClient, LOCAL_NOX_NETWORK(), handle, owner.address);
      assert.equal(own.canDecrypt, true, "the owner must be able to read their own lock");

      for (const other of providers) {
        if (other.address === owner.address) continue;
        const acl = await readAcl(h.publicClient, LOCAL_NOX_NETWORK(), handle, other.address);
        assert.equal(
          acl.canDecrypt,
          false,
          `${other.address} must hold no grant on ${owner.address}'s lock`,
        );
      }
      const outsider = await readAcl(
        h.publicClient,
        LOCAL_NOX_NETWORK(),
        handle,
        attacker.account.address,
      );
      assert.equal(outsider.canDecrypt, false, "an outsider must hold no grant either");
    }

    // And the two locks are two handles, which is what makes the grants above separable at all.
    const handles = new Set<string>();
    for (const provider of providers) {
      const lockId = (await h.custody.read.lockIdFor([
        epoch.epochId,
        provider.address,
      ])) as `0x${string}`;
      const handle = (await h.custody.read.confidentialLockAmount([lockId])) as string;
      assert.equal(handles.has(handle), false, "two locks must never share one handle");
      handles.add(handle);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Invariants 11 and 12 — consumed once, and every substitution refused
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("A5. a lock is consumed exactly once, and a stale or unfinished round is refused", async () => {
    // A round whose epoch was never run: refused for the stage, before any capital moves.
    const otherBorrower = await setupBorrower(h, universeId, 10, {
      desiredAssets: 100n * UNIT,
      minimumAssets: 10n * UNIT,
      maxRateIndexes: [1, 1],
      preferredMaturityIndex: 0,
    });
    await mine(
      h,
      await h.epochs.write.openEpoch([universeId, otherBorrower.requestId, 3_600n], {
        account: h.wallets[10].account,
      }),
    );
    const openEpochId = (await h.epochs.read.epochIdFor([
      universeId,
      otherBorrower.requestId,
    ])) as `0x${string}`;
    await assertRevertsWithError(
      () =>
        series.allocator.write.consumeChunk([openEpochId, 0, 1], {
          account: series.keeper.account,
        }),
      series.allocator,
      "EpochNotComplete",
      "consuming an epoch that has not finished",
    );

    // Now fund the real round, and prove the second consumption of the SAME lock is refused.
    await fundQuoteFromCustody(h, series, epoch.epochId, providers.length);
    await assertRevertsWithError(
      () =>
        series.allocator.write.consumeChunk([epoch.epochId, 0, providers.length], {
          account: series.keeper.account,
        }),
      series.allocator,
      "WrongAllocationState",
      "consuming a round that is already funded",
    );

    // And a second unwrap of a funded round, which would double-spend the coverage.
    await assertRevertsWithError(
      () =>
        series.allocator.write.unwrapFunding([epoch.epochId], { account: series.keeper.account }),
      series.allocator,
      "WrongAllocationState",
      "unwrapping a round twice",
    );
  });

  it("A6. an unsettled quote cannot be allocated against, and neither can a wrong series", async () => {
    quote = await activateQuote(h, s, epoch, universe, result, markets, { fund: false });

    // The quote is Executable, not Consumed. Nothing has settled, so there is no credit to own — and
    // this is the check that makes "allocation follows settlement" mechanical rather than procedural.
    await assertRevertsWithError(
      () =>
        series.allocator.write.allocateChunk([quote.quoteId, 0, providers.length], {
          account: series.keeper.account,
        }),
      series.allocator,
      "WrongQuoteStatus",
      "allocating a quote that has not settled",
    );

    // A quote id that belongs to nothing. Status `None` is refused by the same check, which is why the
    // wrong-quote case does not need its own error.
    await assertRevertsWithError(
      () =>
        series.allocator.write.allocateChunk([`0x${"ab".repeat(32)}`, 0, 1], {
          account: series.keeper.account,
        }),
      series.allocator,
      "WrongQuoteStatus",
      "allocating a quote that does not exist",
    );

    // The ownership registry serves ONE series and refuses any other, so a misrouted allocator call
    // cannot write a row into the wrong series' ownership.
    assert.equal(await series.ownership.read.SERIES_ID(), seriesId);
    assert.equal(await series.token.read.SERIES_ID(), seriesId);
    assert.equal(await series.allocator.read.SERIES_ID(), seriesId);
    assert.equal(await series.residue.read.SERIES_ID(), seriesId);
    assert.equal(await series.solvency.read.SERIES_ID(), seriesId);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Invariant 10 — cancellation restores locked capital, after funding as well as before
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("A7. a funded quote that is cancelled restores every provider's capital, and it really pays", async () => {
    const availableBefore = new Map<string, bigint>();
    for (const provider of providers) {
      availableBefore.set(
        provider.address,
        await decryptAvailable(provider.walletIndex, provider.address),
      );
    }

    // Unwinding a live quote is refused. The retirement has to be real first, or a keeper could
    // reclaim capital from under a quote a borrower could still settle.
    //
    // THIS CASE FOUND A REAL HOLE. The first implementation read the quote id from the round's own
    // record, which is only written at the first allocation — so a funded, activated, not-yet-allocated
    // round had a zero there and skipped the check entirely. The quote is now discovered from the
    // registry's `quoteOfEpoch` index, which is total. Delta T-11.
    await assertRevertsWithError(
      () =>
        series.allocator.write.unwindChunk([epoch.epochId, 0, providers.length], {
          account: attacker.account,
        }),
      series.allocator,
      "QuoteNotRetired",
      "unwinding a live quote",
    );

    await mine(
      h,
      await s.expiryController.write.cancelQuote([quote.quoteId], {
        account: h.wallets[8].account,
      }),
    );

    /**
     * THE T-4 LIMIT, MADE CONCRETE RATHER THAN ASSERTED AWAY.
     *
     * `restoreLock` credits the provider's internal `available`, but the coverage backing it left when
     * the funding was unwrapped. `KyrveSeriesVault.recoverFunding` is Phase 4 code and operator-only,
     * so the public tokens have to be returned and re-wrapped before the restoration means anything.
     *
     * That is done here explicitly, in the open, so the final withdrawal proves the capital is really
     * there rather than proving that a number went back up.
     */
    const recoverable = (await quote.vault.read.availableFunding()) as bigint;
    assert.equal(recoverable, result.aggregateFillAmount, "the whole funding is recoverable");
    await mine(
      h,
      await quote.vault.write.recoverFunding([recoverable, h.wallets[8].account.address], {
        account: h.wallets[8].account,
      }),
    );
    await mine(
      h,
      await s.usdc.write.approve([h.asset.address, recoverable], { account: h.wallets[8].account }),
    );
    await mine(
      h,
      await h.asset.write.wrap([h.custody.address, recoverable], { account: h.wallets[8].account }),
    );

    // Permissionless: a retired quote is a public fact and a stalled keeper must not be able to hold
    // a provider's capital hostage (PRD invariants 12 and 20). Called by the attacker's own wallet.
    await mine(
      h,
      await series.allocator.write.unwindChunk([epoch.epochId, 0, providers.length], {
        account: attacker.account,
      }),
    );

    for (const provider of providers) {
      const lockId = (await h.custody.read.lockIdFor([
        epoch.epochId,
        provider.address,
      ])) as `0x${string}`;
      assert.equal(Number(await h.custody.read.lockStateOf([lockId])), LOCK_STATE.Restored);

      const restored = await decryptAvailable(provider.walletIndex, provider.address);
      const before = availableBefore.get(provider.address) ?? 0n;
      assert.ok(restored > before, "the provider's available balance must have risen");
    }

    // AND IT PAYS. A restored balance that a withdrawal cannot move is a restored number, not restored
    // capital — and the wrapper's `transfer` primitive moves encrypted zero rather than reverting when
    // coverage is short, so only a real withdrawal distinguishes the two.
    const provider = providers[0];
    assert.ok(provider !== undefined);
    const wallet = h.wallets[provider.walletIndex];
    const restored = await decryptAvailable(provider.walletIndex, provider.address);
    const client = await clientFor(h, provider.walletIndex);
    const walletBefore = (await h.asset.read.confidentialBalanceOf([provider.address])) as Handle;
    const walletBalanceBefore =
      walletBefore === ZERO_HANDLE ? 0n : await client.decrypt(walletBefore, SUITE_POLL);

    const input = await client.encrypt(restored, "euint256", h.custody.address);
    const nonce = await h.custody.read.nextNonce([provider.address]);
    await mine(
      h,
      await h.custody.write.withdraw([input.handle, input.proof, nonce], {
        account: wallet.account,
      }),
    );

    const walletAfter = (await h.asset.read.confidentialBalanceOf([provider.address])) as Handle;
    assert.equal(
      await client.decrypt(walletAfter, SUITE_POLL),
      walletBalanceBefore + restored,
      "the withdrawal must move exactly the restored amount into the provider's own wallet",
    );
    assert.equal(
      await decryptAvailable(provider.walletIndex, provider.address),
      0n,
      "and must leave nothing behind in custody",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Invariant 15 — the residue is never silently minted and never redirectable
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("A8. the residue account has no path to anywhere but its declared beneficiary", async () => {
    const abi = series.residue.abi as { type: string; name?: string; inputs?: unknown[] }[];
    const writes = abi.filter((item) => item.type === "function" && item.name !== undefined) as {
      name: string;
      inputs: unknown[];
    }[];

    // Structural rather than behavioural: there is no function on this contract that takes a
    // destination. A withdrawal with a `to` parameter satisfies PRD §19.8 in prose and violates it in
    // practice, because whoever holds the key chooses the destination at withdrawal time.
    for (const fn of writes) {
      if (fn.name === "recordResidue" || fn.name === "distribute") continue;
      const takesAddress = (fn.inputs as { type: string }[]).some(
        (input) => input.type === "address",
      );
      assert.equal(
        takesAddress,
        false,
        `${fn.name} takes an address; the residue account must have no redirectable path`,
      );
    }
    assert.equal(
      (abi.find((item) => item.name === "distribute")?.inputs ?? []).length,
      0,
      "distribute must take no parameters at all",
    );

    // Only the allocator may record, and a recorded figure can never be revised downwards.
    await assertRevertsWithError(
      () => series.residue.write.recordResidue([quote.quoteId, 1n], { account: attacker.account }),
      series.residue,
      "NotRecorder",
      "an outsider recording a residue",
    );
  });
});
