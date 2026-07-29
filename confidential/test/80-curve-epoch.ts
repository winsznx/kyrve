/**
 * Phase 3 demonstrations 1–12 and 19–20: one complete confidential quote, end to end.
 *
 *    1. Four providers submit different mandates.
 *    2. One borrower submits a request.
 *    3. At least 64 leaves are evaluated.
 *    4. One provider is privately excluded.
 *    5. The public surface does not reveal which provider, or why.
 *    6. The privacy floor passes.
 *    7. One winning leaf is selected.
 *    8. Selected market, rate and aggregate amount decrypt publicly.
 *    9. Losing leaves remain private.
 *   10. Provider allocations decrypt only to their owners.
 *   11. Reservations sum to the public aggregate.
 *   12. Dust reconciliation is exact.
 *   20. Nox output matches the plaintext reference model exactly.
 *
 * Against the REAL local Nox stack. Every handle is a real handle, every proof a real gateway
 * signature, every refusal a real on-chain ACL read.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { assertConservation, assertDustBound, UNIT } from "@kyrve/curve";
import type { Handle } from "@kyrve/nox";

import {
  acl,
  type CurveHarness,
  createUniverse,
  deployCurveHarness,
  type EpochState,
  openAndSeal,
  runEpoch,
  type SealedProviderState,
  setupBorrower,
  setupProvider,
  verifyPublishedQuote,
} from "./curve-helpers.js";
import { SUITE_POLL } from "./helpers.js";

describe("Phase 3: one confidential quote from four encrypted mandates", () => {
  let h: CurveHarness;
  let universeId: `0x${string}`;
  let epoch: EpochState;
  let providers: SealedProviderState[];
  let published: Awaited<ReturnType<typeof verifyPublishedQuote>>;

  before(async () => {
    h = await deployCurveHarness();

    // 4 markets x 16 rates = 64 leaves, which is demonstration 3's floor exactly.
    const created = await createUniverse(h, {
      markets: 4,
      ratesPerMarket: 16,
      privacyFloor: 2,
      cellsPerChunk: 64,
    });
    universeId = created.universeId;

    // ── Demonstration 1: four providers, four DIFFERENT mandates ───────────────────────────
    // Provider 3 is the one that gets privately excluded (demonstration 4), and it is excluded by
    // a real predicate — a confidential balance below the universe's minimum ticket — not by being
    // left out of the epoch. Being left out would be visible; being short is not.
    providers = [];
    providers.push(
      await setupProvider(h, universeId, {
        walletIndex: 1,
        mandate: { marketCaps: [400n * UNIT], minRateIndexes: [0, 0, 0, 0] },
        balance: 2_000n * UNIT,
      }),
    );
    providers.push(
      await setupProvider(h, universeId, {
        walletIndex: 2,
        mandate: { marketCaps: [300n * UNIT], minRateIndexes: [2, 1, 0, 0] },
        balance: 1_500n * UNIT,
      }),
    );
    providers.push(
      await setupProvider(h, universeId, {
        walletIndex: 3,
        mandate: { marketCaps: [250n * UNIT], minRateIndexes: [4, 2, 1, 0] },
        balance: 1_200n * UNIT,
      }),
    );
    providers.push(
      await setupProvider(h, universeId, {
        walletIndex: 4,
        mandate: { marketCaps: [500n * UNIT], minRateIndexes: [0, 0, 0, 0] },
        // A REAL confidential balance that is simply too small — half the universe's minimum
        // ticket. The exclusion is therefore by predicate, under encryption, and not by the
        // provider being absent from the epoch.
        //
        // Zero would not do: a provider who never deposited has an UNDEFINED vault handle, and an
        // undefined handle resolves to the type's public zero, which has no ACL and cannot be
        // granted or computed on. `sealProviderSnapshot` refuses it by name — see
        // `81-curve-attacks.ts`. That is correct behaviour and a different situation from being
        // short, which is what this demonstration is about.
        balance: UNIT / 2n,
      }),
    );

    // ── Demonstration 2: one borrower, one encrypted request ───────────────────────────────
    const borrower = await setupBorrower(h, universeId, 5, {
      desiredAssets: 600n * UNIT,
      minimumAssets: 50n * UNIT,
      maxRateIndexes: [15, 15, 15, 15],
      preferredMaturityIndex: 0,
    });

    epoch = await openAndSeal(h, universeId, created.universe, providers, borrower);
    await runEpoch(h, epoch);
    published = await verifyPublishedQuote(h, epoch);
  });

  it("3. evaluates at least 64 leaves, every one of them under encryption", async () => {
    const onChain = await h.epochs.read.epochOf([epoch.epochId]);
    assert.equal(Number(onChain.leafCount), 64);
    assert.ok(epoch.universe.leaves.length >= 64, "demonstration 3 requires at least 64 leaves");

    // Every leaf really was accumulated: each carries a handle, and no two adjacent leaves share
    // one by accident of an unwritten slot.
    const capacities: Handle[] = [];
    for (let leaf = 0; leaf < 64; leaf += 1) {
      const handle = (await h.engine.read.confidentialFillableOf([epoch.epochId, leaf])) as Handle;
      assert.notEqual(handle, `0x${"00".repeat(32)}`, `leaf ${leaf} was never finalised`);
      capacities.push(handle);
    }
    assert.equal(capacities.length, 64);
  });

  it("4+5. a provider is privately excluded, and nothing public says which or why", async () => {
    const excluded = providers[3]!;

    // The reference model knows exactly why, because it has the plaintext. The chain does not.
    const cell = epoch.expected.cached[3]?.[0];
    assert.equal(cell?.capacity, 0n, "provider 3 must contribute nothing");
    assert.equal(cell?.predicates.balanceSufficient, false);

    // What IS public: that they were considered. That is the honest cost of a permissionless
    // keeper, and it is the only thing an observer learns.
    assert.equal(await h.epochs.read.isSealedProvider([epoch.epochId, excluded.address]), true);

    // What is NOT public: the cached capacity handle exists but nobody can read it, including the
    // provider it belongs to — an intermediate is never granted to anyone.
    const cached = await h.engine.read.cachedOf([epoch.epochId, 3, 0]);
    for (const address of [
      excluded.address,
      h.wallets[0].account.address,
      h.wallets[5].account.address,
    ]) {
      const state = await acl(h, cached.capacity as Handle, address as `0x${string}`);
      assert.equal(state.isAdmin, false, "no account may compute on a cached intermediate");
      assert.equal(state.isPublic, false, "no intermediate is ever published");
    }

    // And the public surface carries exactly five values — none of which is a reason.
    const publishedHandles = await h.engine.read.publishedOf([epoch.epochId]);
    assert.equal(Object.keys(publishedHandles).length, 5);
  });

  it("6+7. the privacy floor passes and exactly one leaf is selected", async () => {
    assert.equal(published.privacyFloorPassed, true, "the winning leaf must clear the floor");
    assert.equal(published.quoteReady, true);
    assert.ok(epoch.expected.winner !== null, "the reference model expects a winner");
    assert.equal(published.marketIndex, epoch.expected.winner.marketIndex);
    assert.equal(published.rateIndex, epoch.expected.winner.rateIndex);
  });

  it("8. the selected market, rate and aggregate decrypt publicly, and nothing else does", async () => {
    const handles = await h.engine.read.publishedOf([epoch.epochId]);
    for (const handle of Object.values(handles) as Handle[]) {
      const state = await acl(h, handle, h.wallets[7].account.address as `0x${string}`);
      assert.equal(state.isPublic, true, "each of the five results must be publicly decryptable");
    }
    assert.ok(published.aggregateFillAmount > 0n);
  });

  it("9. losing leaves stay private — nobody holds a grant on any of them", async () => {
    const winningLeaf = epoch.expected.winner!.leafIndex;
    const readers = [
      h.wallets[0].account.address,
      h.wallets[1].account.address,
      h.wallets[5].account.address,
      h.wallets[9].account.address,
    ] as `0x${string}`[];

    let checked = 0;
    for (let leaf = 0; leaf < 64; leaf += 1) {
      if (leaf === winningLeaf) continue;
      const capacity = (await h.engine.read.confidentialLeafCapacityOf([
        epoch.epochId,
        leaf,
      ])) as Handle;
      const count = (await h.engine.read.confidentialProviderCountOf([
        epoch.epochId,
        leaf,
      ])) as Handle;
      for (const handle of [capacity, count]) {
        const anyone = await acl(h, handle, readers[checked % readers.length]!);
        assert.equal(anyone.isPublic, false, `leaf ${leaf} became publicly decryptable`);
        assert.equal(
          anyone.canDecrypt,
          false,
          `leaf ${leaf} is readable by ${readers[checked % readers.length]}`,
        );
      }
      checked += 1;
    }
    assert.equal(checked, 63, "every losing leaf must be checked, not a sample");

    // The exact provider count for the WINNING leaf is private too. Only the floor boolean is not.
    const winningCount = (await h.engine.read.confidentialProviderCountOf([
      epoch.epochId,
      winningLeaf,
    ])) as Handle;
    assert.equal(
      (await acl(h, winningCount, h.wallets[5].account.address as `0x${string}`)).isPublic,
      false,
    );
  });

  it("10. a provider decrypts their own allocation, and cannot decrypt anyone else's", async () => {
    for (let slot = 0; slot < providers.length; slot += 1) {
      const provider = providers[slot]!;
      const handle = (await h.engine.read.confidentialAllocationOf([
        epoch.epochId,
        slot,
      ])) as Handle;

      const own = await acl(h, handle, provider.address);
      assert.equal(own.canDecrypt, true, `provider ${slot} cannot read their own allocation`);
      assert.equal(own.isPublic, false, "an allocation is never published");

      const value = await provider.client.decrypt(handle, SUITE_POLL);
      assert.equal(
        value,
        epoch.expected.providers[slot]!.allocation,
        `slot ${slot} allocation diverged`,
      );

      // Nobody else, including the borrower and the keeper.
      for (const other of [h.wallets[5], h.wallets[9]]) {
        const state = await acl(h, handle, other.account.address as `0x${string}`);
        assert.equal(state.canDecrypt, false, "an allocation leaked beyond its owner");
      }
    }
  });

  it("11. the reservations sum to the published aggregate, exactly", async () => {
    let summed = 0n;
    for (const provider of providers) {
      const handle = (await h.ledger.read.confidentialReservedOf([
        epoch.epochId,
        provider.address,
      ])) as Handle;
      summed += await provider.client.decrypt(handle, SUITE_POLL);
    }
    assert.equal(
      summed,
      published.aggregateFillAmount,
      "the aggregate is DEFINED as the sum of what was reserved; if these differ the definition drifted",
    );
    assert.equal(summed, epoch.expected.published.aggregateFillAmount);
  });

  it("12. dust reconciles exactly, and every provider's balance is conserved", async () => {
    const winner = epoch.expected.winner!;
    const dust = winner.fill - published.aggregateFillAmount;

    assert.equal(dust, epoch.expected.dustResidue, "dust diverged from the reference model");
    assertDustBound(epoch.expected);

    // Conservation, read from the chain rather than from the model: remaining + reserved == seed.
    for (const provider of providers) {
      const seed = (await h.ledger.read.confidentialSeedOf([
        epoch.epochId,
        provider.address,
      ])) as Handle;
      const remaining = (await h.ledger.read.confidentialRemainingOf([
        epoch.epochId,
        provider.address,
      ])) as Handle;
      const reserved = (await h.ledger.read.confidentialReservedOf([
        epoch.epochId,
        provider.address,
      ])) as Handle;

      const [seedValue, remainingValue, reservedValue] = [
        await provider.client.decrypt(seed, SUITE_POLL),
        await provider.client.decrypt(remaining, SUITE_POLL),
        await provider.client.decrypt(reserved, SUITE_POLL),
      ];
      assert.equal(
        remainingValue + reservedValue,
        seedValue,
        `provider ${provider.address} does not conserve`,
      );
    }
    assertConservation(
      providers.map((p) => ({ address: p.address, mandate: p.mandate, balance: p.balance })),
      epoch.expected.providers,
    );

    // The dust residue itself is never granted to anyone: publishing it would disclose the winning
    // leaf's total capacity, which is private.
    const dustHandle = (await h.engine.read.confidentialDustOf([epoch.epochId])) as Handle;
    for (const wallet of [h.wallets[1], h.wallets[5], h.wallets[9]]) {
      const state = await acl(h, dustHandle, wallet.account.address as `0x${string}`);
      assert.equal(state.canDecrypt, false, "the dust residue must stay private");
    }
  });

  it("20. every published value matches the plaintext reference model exactly", async () => {
    assert.deepEqual(
      {
        marketIndex: published.marketIndex,
        rateIndex: published.rateIndex,
        privacyFloorPassed: published.privacyFloorPassed,
        quoteReady: published.quoteReady,
        aggregateFillAmount: published.aggregateFillAmount,
      },
      {
        marketIndex: epoch.expected.published.selectedMarketIndex,
        rateIndex: epoch.expected.published.selectedRateIndex,
        privacyFloorPassed: epoch.expected.published.privacyFloorPassed,
        quoteReady: epoch.expected.published.quoteReady,
        aggregateFillAmount: epoch.expected.published.aggregateFillAmount,
      },
    );
  });

  it("20b. every provider's private allocation and reservation match the model too", async () => {
    // The published surface agreeing is necessary and nowhere near sufficient: a wrong stage D
    // could still produce a right-looking aggregate. So the private per-provider values are
    // compared as well, decrypted by their owners.
    for (let slot = 0; slot < providers.length; slot += 1) {
      const provider = providers[slot]!;
      const expected = epoch.expected.providers[slot]!;
      const allocation = (await h.engine.read.confidentialAllocationOf([
        epoch.epochId,
        slot,
      ])) as Handle;
      const reserved = (await h.ledger.read.confidentialReservedOf([
        epoch.epochId,
        provider.address,
      ])) as Handle;
      assert.equal(await provider.client.decrypt(allocation, SUITE_POLL), expected.allocation);
      assert.equal(await provider.client.decrypt(reserved, SUITE_POLL), expected.reserved);
    }
  });

  it("the graph is sealed and the epoch is complete", async () => {
    const graph = await h.graph.read.graphOf([epoch.epochId]);
    assert.equal(graph.sealedGraph, true);
    assert.equal(Number(graph.resultCount), 5);
    assert.ok(Number(graph.chunkCount) > 0);
    assert.notEqual(graph.root, `0x${"00".repeat(32)}`);

    const state = await h.epochs.read.epochOf([epoch.epochId]);
    assert.equal(Number(state.stage), 8, "the epoch must have reached Complete");
  });
});
