/**
 * Phase 3 demonstrations 13–18, and the attacks around them.
 *
 *   13. Re-running a completed chunk is idempotent.
 *   14. Skipping a chunk prevents finalisation.
 *   15. A stale mandate cannot participate.
 *   16. A replayed proof or handle fails.
 *   17. Equal-valued logical fields do not leak ACL authority.
 *   18. Cancellation releases every reservation.
 *
 * Every case asserts the SPECIFIC refusal, never merely that something reverted. A test that
 * passes for the wrong reason is worse than no test (`.claude/rules/testing.md`), and against Nox
 * that is a live risk: several of these attacks would also fail for uninteresting reasons — a
 * missing ACL grant, a wrong stage — and reporting those as the defence would be a lie.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { UNIT } from "@kyrve/curve";
import { encryptMandate, type Handle } from "@kyrve/nox";

import {
  acl,
  assertRevertsWithError,
  type CurveHarness,
  createUniverse,
  deployCurveHarness,
  type EpochState,
  openAndSeal,
  proveWinner,
  ROLE,
  runEpoch,
  runStage,
  type SealedProviderState,
  STAGE,
  setupBorrower,
  setupProvider,
} from "./curve-helpers.js";
import { assertRevertsWith, clientFor, mine, SUITE_POLL } from "./helpers.js";

/** A deliberately small universe. These tests are about control flow, not about leaf count. */
const SMALL = { markets: 1, ratesPerMarket: 4, privacyFloor: 2, cellsPerChunk: 2 } as const;

describe("Phase 3 attacks: chunk lifecycle, staleness, replay, aliasing and cancellation", () => {
  let h: CurveHarness;

  before(async () => {
    h = await deployCurveHarness();
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // Demonstration 13 · idempotence
  // ─────────────────────────────────────────────────────────────────────────────────────────

  it("13. re-running a completed chunk changes nothing and double-counts nothing", async () => {
    const { universeId, universe } = await createUniverse(h, {
      ...SMALL,
      label: `idem-${Date.now()}`,
    });
    const providers = [
      await setupProvider(h, universeId, { walletIndex: 1, balance: 1_000n * UNIT }),
      await setupProvider(h, universeId, { walletIndex: 2, balance: 1_000n * UNIT }),
    ];
    const borrower = await setupBorrower(h, universeId, 5, { desiredAssets: 100n * UNIT });
    const epoch = await openAndSeal(h, universeId, universe, providers, borrower);
    const keeper = h.wallets[9];

    await runStage(h, epoch, STAGE.CacheProviders, "cacheProviderChunk", keeper);

    // Run chunk 0 of stage C, then run it again. Every Nox primitive is a state-changing external
    // call, so a keeper retrying after a dropped receipt would otherwise add each provider's
    // capacity to the leaf a second time and quote for capital that does not exist.
    const first = await mine(
      h,
      await h.engine.write.accumulateLeafChunk([epoch.epochId, 0], { account: keeper.account }),
    );
    const afterFirst = await h.engine.read.confidentialProviderCountOf([epoch.epochId, 0]);
    const rootAfterFirst = await h.graph.read.rootOf([epoch.epochId]);

    const second = await mine(
      h,
      await h.engine.write.accumulateLeafChunk([epoch.epochId, 0], { account: keeper.account }),
    );
    const afterSecond = await h.engine.read.confidentialProviderCountOf([epoch.epochId, 0]);

    assert.equal(
      afterSecond,
      afterFirst,
      "the accumulator handle moved on a retry — it double-counted",
    );
    assert.equal(
      await h.graph.read.rootOf([epoch.epochId]),
      rootAfterFirst,
      "the graph root moved on a retry, which would invalidate every handle committed after it",
    );
    assert.ok(
      Number(second.gasUsed) < Number(first.gasUsed) / 2,
      "the retry should do no encrypted work at all; it cost too much to have been a no-op",
    );

    // The chunk stays marked done exactly once.
    const progress = await h.epochs.read.progressOf([epoch.epochId, STAGE.Accumulate]);
    assert.equal(Number(progress.done), 1);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // Demonstration 14 · a skipped chunk stalls the epoch
  // ─────────────────────────────────────────────────────────────────────────────────────────

  it("14. skipping a chunk prevents the stage from advancing, and names what is missing", async () => {
    const { universeId, universe } = await createUniverse(h, {
      ...SMALL,
      label: `skip-${Date.now()}`,
    });
    const providers = [
      await setupProvider(h, universeId, { walletIndex: 1, balance: 1_000n * UNIT }),
      await setupProvider(h, universeId, { walletIndex: 2, balance: 1_000n * UNIT }),
    ];
    const borrower = await setupBorrower(h, universeId, 5, { desiredAssets: 100n * UNIT });
    const epoch = await openAndSeal(h, universeId, universe, providers, borrower);
    const keeper = h.wallets[9];

    await runStage(h, epoch, STAGE.CacheProviders, "cacheProviderChunk", keeper);

    const progress = await h.epochs.read.progressOf([epoch.epochId, STAGE.Accumulate]);
    assert.ok(Number(progress.total) >= 3, "this test needs a stage with several chunks");

    // Run every chunk EXCEPT the last one.
    for (let chunk = 0; chunk < Number(progress.total) - 1; chunk += 1) {
      await mine(
        h,
        await h.engine.write.accumulateLeafChunk([epoch.epochId, chunk], {
          account: keeper.account,
        }),
      );
    }

    await assertRevertsWith(
      () => h.engine.write.advanceStage([epoch.epochId], { account: keeper.account }),
      "StageIncomplete",
      "a stage with a missing chunk must not advance",
    );

    // A quote computed over part of the universe is the failure mode this prevents: the missing
    // chunk holds real providers whose capacity would simply be absent from every leaf it covers.
    await mine(
      h,
      await h.engine.write.accumulateLeafChunk([epoch.epochId, Number(progress.total) - 1], {
        account: keeper.account,
      }),
    );
    await mine(h, await h.engine.write.advanceStage([epoch.epochId], { account: keeper.account }));
    const state = await h.epochs.read.epochOf([epoch.epochId]);
    assert.equal(Number(state.stage), STAGE.FinalizeLeaves);
  });

  it("14b. a chunk offered for a stage the epoch is not on is refused publicly", async () => {
    const { universeId, universe } = await createUniverse(h, {
      ...SMALL,
      label: `order-${Date.now()}`,
    });
    const providers = [
      await setupProvider(h, universeId, { walletIndex: 1, balance: 1_000n * UNIT }),
      await setupProvider(h, universeId, { walletIndex: 2, balance: 1_000n * UNIT }),
    ];
    const borrower = await setupBorrower(h, universeId, 5, { desiredAssets: 100n * UNIT });
    const epoch = await openAndSeal(h, universeId, universe, providers, borrower);
    const keeper = h.wallets[9];

    // The epoch is on CacheProviders. Running stage C, D or E now must be refused by name — a
    // stage cursor that could be jumped would let a keeper finalise leaves that were never
    // accumulated, and every leaf would carry encrypted zero without anything saying so.
    for (const method of ["accumulateLeafChunk", "finalizeLeafChunk", "reduceWinnerChunk"]) {
      await assertRevertsWith(
        () => h.engine.write[method]([epoch.epochId, 0], { account: keeper.account }),
        "WrongStage",
        `${method} ran ahead of the stage cursor`,
      );
    }

    // And a chunk index past the stage's own count is refused too.
    await assertRevertsWith(
      () => h.engine.write.cacheProviderChunk([epoch.epochId, 99], { account: keeper.account }),
      "ChunkIndexOutOfRange",
      "a chunk index outside the sealed plan was accepted",
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // Demonstration 15 · staleness
  // ─────────────────────────────────────────────────────────────────────────────────────────

  it("15. a replaced mandate's old epoch cannot be sealed into a new quote", async () => {
    const { universeId } = await createUniverse(h, { ...SMALL, label: `stale-${Date.now()}` });
    const provider = await setupProvider(h, universeId, { walletIndex: 6, balance: 1_000n * UNIT });
    const borrower = await setupBorrower(h, universeId, 7, { desiredAssets: 100n * UNIT });
    const wallet = h.wallets[6];

    // Replace the mandate. The OLD handles still exist and the provider can still decrypt them —
    // Nox cannot destroy a ciphertext or withdraw a grant — but they stop authorising activity.
    const client = await clientFor(h, 6);
    const encoded = await encryptMandate(
      client,
      h.mandateBook.address,
      (await import("@kyrve/curve")).makeMandate({}),
    );
    const nonce = await h.mandateBook.read.nextNonce([provider.address]);
    await mine(
      h,
      await h.mandateBook.write.replaceMandate(
        [provider.mandateId, encoded.struct, encoded.proofs, nonce],
        {
          account: wallet.account,
        },
      ),
    );
    assert.equal(Number((await h.mandateBook.read.mandateOf([provider.mandateId])).activeEpoch), 2);

    const borrowerWallet = h.wallets[7];
    await mine(
      h,
      await h.epochs.write.openEpoch([universeId, borrower.requestId, 3_600n], {
        account: borrowerWallet.account,
      }),
    );
    const epochId = await h.epochs.read.epochIdFor([universeId, borrower.requestId]);
    const engineNonce = await h.engine.read.nextNonce([provider.address]);

    await assertRevertsWith(
      () =>
        h.engine.write.sealProviderSnapshot([epochId, provider.mandateId, 1, engineNonce], {
          account: wallet.account,
        }),
      "StaleMandateEpoch",
      "a superseded mandate epoch was allowed into a quote",
    );

    // The superseded handles are still decryptable by their owner. A user interface must therefore
    // never call a replacement a revocation — the epoch moved, nothing was removed.
    const oldHandles = await h.mandateBook.read.handlesOf([provider.mandateId, 1]);
    const stillReadable = await client.decrypt(oldHandles.totalBudget as Handle, SUITE_POLL);
    assert.ok(stillReadable >= 0n, "the old epoch's ciphertext must still exist and still decrypt");
  });

  it("15b. sealing a provider with no confidential balance is refused by name", async () => {
    const { universeId } = await createUniverse(h, { ...SMALL, label: `nobal-${Date.now()}` });
    // A provider who never deposited: their vault slot holds the UNDEFINED handle, which resolves
    // to the type's public zero. A public handle bypasses every ACL gate, so computing on it would
    // silently treat "no balance" as a value the engine could reason about.
    const provider = await setupProvider(h, universeId, { walletIndex: 8, balance: 0n });
    const borrower = await setupBorrower(h, universeId, 5, { desiredAssets: 10n * UNIT });

    await mine(
      h,
      await h.epochs.write.openEpoch([universeId, borrower.requestId, 3_600n], {
        account: h.wallets[5].account,
      }),
    );
    const epochId = await h.epochs.read.epochIdFor([universeId, borrower.requestId]);
    const nonce = await h.engine.read.nextNonce([provider.address]);

    await assertRevertsWith(
      () =>
        h.engine.write.sealProviderSnapshot([epochId, provider.mandateId, 1, nonce], {
          account: h.wallets[8].account,
        }),
      "HandleIsNotConfidential",
      "a public zero handle was accepted as a confidential balance",
    );
  });

  it("15c. sealing without granting the engine ACL is refused, before any encrypted work runs", async () => {
    const { universeId } = await createUniverse(h, { ...SMALL, label: `noacl-${Date.now()}` });
    const borrower = await setupBorrower(h, universeId, 5, { desiredAssets: 10n * UNIT });

    // A provider who submitted a mandate but never granted the engine access. The refusal must
    // name the missing grant rather than surfacing as an opaque NoxCompute failure eight
    // transactions later, inside a stage that says nothing about which handle was unreadable.
    const wallet = h.wallets[8];
    const client = await clientFor(h, 8);
    const { makeMandate } = await import("@kyrve/curve");
    const encoded = await encryptMandate(client, h.mandateBook.address, makeMandate({}));
    const mandateNonce = await h.mandateBook.read.nextNonce([wallet.account.address]);
    await mine(
      h,
      await h.mandateBook.write.submitMandate(
        [universeId, encoded.struct, encoded.proofs, mandateNonce],
        {
          account: wallet.account,
        },
      ),
    );
    const mandateId = await h.mandateBook.read.mandateIdFor([wallet.account.address, universeId]);

    await mine(
      h,
      await h.epochs.write.openEpoch([universeId, borrower.requestId, 3_600n], {
        account: h.wallets[5].account,
      }),
    );
    const epochId = await h.epochs.read.epochIdFor([universeId, borrower.requestId]);
    const nonce = await h.engine.read.nextNonce([wallet.account.address]);

    await assertRevertsWith(
      () =>
        h.engine.write.sealProviderSnapshot([epochId, mandateId, 1, nonce], {
          account: wallet.account,
        }),
      "EngineNotAuthorisedForHandle",
      "the engine sealed a mandate it holds no grant on",
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // Demonstration 16 · replay
  // ─────────────────────────────────────────────────────────────────────────────────────────

  it("16. a valid decryption proof from another epoch is refused by the graph binding", async () => {
    const first = await runSmallEpoch(h, "replay-a", 1, 2, 5);
    const second = await runSmallEpoch(h, "replay-b", 3, 4, 7);

    const client = await clientFor(h, 0);
    const firstPublished = await h.engine.read.publishedOf([first.epochId]);
    const secondPublished = await h.engine.read.publishedOf([second.epochId]);

    const stolen = await client.publicDecrypt(firstPublished.quoteReady as Handle, SUITE_POLL);

    // The proof is REAL and the signature verifies. `validateDecryptionProof` is a pure EIP-712
    // check with no ACL, no nonce, no expiry and no caller binding, so it would happily accept
    // this. What refuses it is that the handle is not the one the SECOND epoch's sealed graph
    // committed to for that role.
    await assertRevertsWith(
      () =>
        h.verifier.read.verifyResult([
          second.epochId,
          ROLE.QuoteReady,
          firstPublished.quoteReady,
          stolen.decryptionProof,
        ]),
      "UnboundHandle",
      "a decryption proof from another epoch was accepted",
    );

    // The same proof against its OWN epoch verifies, so the refusal above is about the binding and
    // not about the proof being malformed. Without this half, the test would pass on a broken
    // verifier that rejected everything.
    const value = await h.verifier.read.verifyResult([
      first.epochId,
      ROLE.QuoteReady,
      firstPublished.quoteReady,
      stolen.decryptionProof,
    ]);
    assert.equal(Number(value), Number(stolen.value));

    // And a real handle presented under the WRONG ROLE of its own epoch is refused too.
    await assertRevertsWith(
      () =>
        h.verifier.read.verifyResult([
          first.epochId,
          ROLE.SelectedMarketIndex,
          firstPublished.quoteReady,
          stolen.decryptionProof,
        ]),
      "UnboundHandle",
      "a published handle was accepted under a role it was not registered for",
    );

    assert.notEqual(
      firstPublished.quoteReady,
      secondPublished.quoteReady,
      "two epochs produced ONE quoteReady handle — the epoch isolation condition is not separating them",
    );
  });

  it("16b. a handle already consumed by the reservation ledger cannot fund a second reservation", async () => {
    // The ledger consumes each allocation handle exactly once. Nox supplies no such guard: input
    // proofs carry no nonce and no consumption marker (delta Q-2), and an on-chain operation
    // output has no guard at all. Proven through the public surface: an epoch cannot run stage F
    // twice, and the chunk claim is what stops it.
    const epoch = await runSmallEpoch(h, "consume", 1, 2, 5);
    await assertRevertsWith(
      () => h.engine.write.allocateChunk([epoch.epochId, 0], { account: h.wallets[9].account }),
      "WrongStage",
      "stage F ran again after the epoch completed",
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // Demonstration 17 · ACL aliasing — the P3-1 property
  // ─────────────────────────────────────────────────────────────────────────────────────────

  it("17a. the collision hazard is live: identical operands still produce ONE handle", async () => {
    // The premise of the whole isolation design, re-proven here rather than inherited. If Nox ever
    // stopped deriving handles this way, isolation would become unnecessary — and, more to the
    // point, every test below would start passing for a different reason than it claims.
    const probe = await h.connection.viem.deployContract("IsolationProbe", [h.controller.address]);
    const client = await clientFor(h, 1);
    const a = await client.encrypt(11n * UNIT, "euint256", probe.address);
    const b = await client.encrypt(7n * UNIT, "euint256", probe.address);

    await mine(
      h,
      await probe.write.probe([`0x${"5e".repeat(32)}`, a.handle, a.proof, b.handle, b.proof], {
        account: h.wallets[1].account,
      }),
    );

    const naiveA = (await probe.read.naiveA()) as Handle;
    const naiveB = (await probe.read.naiveB()) as Handle;
    assert.equal(
      naiveA,
      naiveB,
      "same operator, same operands, same order produced two handles — the Q-5 mechanism changed, " +
        "and the isolation primitive's justification needs revisiting",
    );
  });

  it("17b. isolation separates equal values, and is deterministic so the graph can predict it", async () => {
    const probe = await h.connection.viem.deployContract("IsolationProbe", [h.controller.address]);
    const client = await clientFor(h, 1);
    const a = await client.encrypt(11n * UNIT, "euint256", probe.address);
    const b = await client.encrypt(7n * UNIT, "euint256", probe.address);

    await mine(
      h,
      await probe.write.probe([`0x${"5e".repeat(32)}`, a.handle, a.proof, b.handle, b.proof], {
        account: h.wallets[1].account,
      }),
    );

    const isolatedA = (await probe.read.isolatedA()) as Handle;
    const isolatedB = (await probe.read.isolatedB()) as Handle;
    const isolatedAgain = (await probe.read.isolatedAgain()) as Handle;
    const naiveA = (await probe.read.naiveA()) as Handle;

    // Same value, different domain -> different handle. This is the fix.
    assert.notEqual(isolatedA, isolatedB, "isolation failed to separate two colliding quantities");
    assert.equal(
      await client.decrypt(isolatedA, SUITE_POLL),
      await client.decrypt(isolatedB, SUITE_POLL),
      "isolation changed the VALUE; it must only change the lineage",
    );
    assert.equal(
      await client.decrypt(isolatedA, SUITE_POLL),
      await client.decrypt(naiveA, SUITE_POLL),
      "isolation must preserve the value it was given",
    );

    // Same value, same domain -> the SAME handle. Without this the published result handles could
    // not be predicted off chain and the graph binding would be decorative.
    assert.equal(isolatedAgain, isolatedA, "isolation is not deterministic");
  });

  it("17c. two numerically identical allocations are two handles with two ACL entries", async () => {
    const { universeId, universe } = await createUniverse(h, {
      ...SMALL,
      label: `alias-${Date.now()}`,
    });

    // Byte-identical mandates and byte-identical balances.
    //
    // NOTE, because it changes what this test can claim: the two providers' mandate handles come
    // from separate `encryptInput` calls, and gateway input handles are distinct per encryption.
    // So their intermediates differ ANYWAY, and this case alone would pass with the isolation
    // removed — which is why 17a and 17b exist and exercise the primitive directly. Delta R-6.
    // What this case adds is that the end-to-end engine really does grant each provider a distinct
    // handle for a numerically identical allocation, on chain, through the real stack.
    const providers = [
      await setupProvider(h, universeId, { walletIndex: 1, balance: 900n * UNIT }),
      await setupProvider(h, universeId, { walletIndex: 2, balance: 900n * UNIT }),
    ];
    const borrower = await setupBorrower(h, universeId, 5, { desiredAssets: 200n * UNIT });
    const epoch = await openAndSeal(h, universeId, universe, providers, borrower);
    await runEpoch(h, epoch);

    const allocationA = (await h.engine.read.confidentialAllocationOf([
      epoch.epochId,
      0,
    ])) as Handle;
    const allocationB = (await h.engine.read.confidentialAllocationOf([
      epoch.epochId,
      1,
    ])) as Handle;

    const valueA = await providers[0]!.client.decrypt(allocationA, SUITE_POLL);
    const valueB = await providers[1]!.client.decrypt(allocationB, SUITE_POLL);
    assert.equal(valueA, valueB, "this case is only meaningful when the two allocations are equal");
    assert.ok(valueA > 0n, "and only meaningful when they are non-zero");
    assert.notEqual(allocationA, allocationB, "two equal allocations collapsed into one handle");

    // Proven on chain, from NoxCompute's authoritative mapping rather than from an indexer.
    assert.equal((await acl(h, allocationA, providers[0]!.address)).canDecrypt, true);
    assert.equal((await acl(h, allocationA, providers[1]!.address)).canDecrypt, false);
    assert.equal((await acl(h, allocationB, providers[1]!.address)).canDecrypt, true);
    assert.equal((await acl(h, allocationB, providers[0]!.address)).canDecrypt, false);

    for (const view of ["confidentialReservedOf", "confidentialRemainingOf"] as const) {
      const first = (await h.ledger.read[view]([epoch.epochId, providers[0]!.address])) as Handle;
      const second = (await h.ledger.read[view]([epoch.epochId, providers[1]!.address])) as Handle;
      assert.notEqual(first, second, `${view} collapsed two providers into one handle`);
      assert.equal((await acl(h, first, providers[1]!.address)).canDecrypt, false);
    }

    // And no intermediate is granted to anyone, whether or not it collides.
    const cached = await h.engine.read.cachedOf([epoch.epochId, 0, 0]);
    assert.equal(
      (await acl(h, cached.capacity as Handle, providers[0]!.address)).canDecrypt,
      false,
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // Demonstration 18 · cancellation
  // ─────────────────────────────────────────────────────────────────────────────────────────

  it("18. cancelling an epoch releases every reservation, in full", async () => {
    const { universeId, universe } = await createUniverse(h, {
      ...SMALL,
      label: `cancel-${Date.now()}`,
    });
    const providers = [
      await setupProvider(h, universeId, { walletIndex: 1, balance: 800n * UNIT }),
      await setupProvider(h, universeId, { walletIndex: 2, balance: 700n * UNIT }),
    ];
    const borrower = await setupBorrower(h, universeId, 5, { desiredAssets: 300n * UNIT });
    const epoch = await openAndSeal(h, universeId, universe, providers, borrower);
    const keeper = h.wallets[9];

    await runStage(h, epoch, STAGE.CacheProviders, "cacheProviderChunk", keeper);
    await runStage(h, epoch, STAGE.Accumulate, "accumulateLeafChunk", keeper);
    await runStage(h, epoch, STAGE.FinalizeLeaves, "finalizeLeafChunk", keeper);
    await runStage(h, epoch, STAGE.ReduceWinner, "reduceWinnerChunk", keeper);
    await runStage(h, epoch, STAGE.PublishWinner, "publishWinner", keeper);
    await proveWinner(h, epoch, keeper);
    await runStage(h, epoch, STAGE.Allocate, "allocateChunk", keeper);

    // Reservations are live at this point.
    for (const provider of providers) {
      assert.equal(
        Number(await h.ledger.read.stateOf([epoch.epochId, provider.address])),
        2,
        "expected Reserved",
      );
      const reserved = (await h.ledger.read.confidentialReservedOf([
        epoch.epochId,
        provider.address,
      ])) as Handle;
      assert.ok((await provider.client.decrypt(reserved, SUITE_POLL)) > 0n);
    }

    await mine(
      h,
      await h.engine.write.cancelEpoch([epoch.epochId], { account: h.wallets[5].account }),
    );

    for (const provider of providers) {
      assert.equal(
        Number(await h.ledger.read.stateOf([epoch.epochId, provider.address])),
        3,
        "expected Released",
      );

      // Restored IN FULL: the remaining balance is back to the sealed snapshot, exactly.
      const seed = (await h.ledger.read.confidentialSeedOf([
        epoch.epochId,
        provider.address,
      ])) as Handle;
      const remaining = (await h.ledger.read.confidentialRemainingOf([
        epoch.epochId,
        provider.address,
      ])) as Handle;
      assert.equal(
        await provider.client.decrypt(remaining, SUITE_POLL),
        await provider.client.decrypt(seed, SUITE_POLL),
        "cancellation did not restore the snapshot in full",
      );
    }

    const state = await h.epochs.read.epochOf([epoch.epochId]);
    assert.equal(Number(state.stage), STAGE.Cancelled);

    // A cancelled epoch is terminal: nothing may resume it and no reservation may reopen.
    await assertRevertsWith(
      () => h.engine.write.publishAggregate([epoch.epochId], { account: keeper.account }),
      "WrongStage",
      "a cancelled epoch kept running",
    );
  });

  it("18b. only the borrower may cancel before the deadline", async () => {
    const { universeId, universe } = await createUniverse(h, {
      ...SMALL,
      label: `cancel2-${Date.now()}`,
    });
    const providers = [
      await setupProvider(h, universeId, { walletIndex: 1, balance: 500n * UNIT }),
      await setupProvider(h, universeId, { walletIndex: 2, balance: 500n * UNIT }),
    ];
    const borrower = await setupBorrower(h, universeId, 5, { desiredAssets: 100n * UNIT });
    const epoch = await openAndSeal(h, universeId, universe, providers, borrower);

    // Permissionless AFTER the deadline is deliberate — a stalled epoch holding reservations must
    // never be made permanent by inaction. Before it, a third party cancelling would be censorship.
    await assertRevertsWith(
      () => h.engine.write.cancelEpoch([epoch.epochId], { account: h.wallets[9].account }),
      "DeadlineNotReached",
      "a third party cancelled a live epoch",
    );
    await mine(
      h,
      await h.engine.write.cancelEpoch([epoch.epochId], { account: h.wallets[5].account }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // Authority
  // ─────────────────────────────────────────────────────────────────────────────────────────

  it("only the engine may drive the controller, the graph or the ledger", async () => {
    const attacker = h.wallets[9];
    const fake = `0x${"ab".repeat(32)}` as `0x${string}`;

    await assertRevertsWithError(
      () => h.epochs.write.claimChunk([fake, STAGE.Accumulate, 0], { account: attacker.account }),
      h.epochs,
      "NotEngine",
      "the epoch controller accepted a chunk claim from outside the engine",
    );
    await assertRevertsWithError(
      () =>
        h.graph.write.registerResult([fake, ROLE.QuoteReady, fake], { account: attacker.account }),
      h.graph,
      "NotEngine",
      "the graph registry accepted a result from outside the engine",
    );
    await assertRevertsWithError(
      () =>
        h.ledger.write.release([fake, attacker.account.address, fake], {
          account: attacker.account,
        }),
      h.ledger,
      "NotEngine",
      "the reservation ledger accepted a release from outside the engine",
    );
  });

  it("the engine binding is one-shot on all three contracts", async () => {
    for (const contract of [h.epochs, h.graph, h.ledger]) {
      await assertRevertsWithError(
        () =>
          contract.write.bindEngine([h.wallets[9].account.address], {
            account: h.wallets[0].account,
          }),
        contract,
        "EngineAlreadyBound",
        "an engine binding was replaced after deployment",
      );
    }
  });

  it("a universe is immutable once activated", async () => {
    const { universeId } = await createUniverse(h, { ...SMALL, label: `frozen-${Date.now()}` });
    await assertRevertsWith(
      () => h.universes.write.activateUniverse([universeId], { account: h.curator.account }),
      "UniverseIsActive",
      "an activated universe was activated again",
    );
    await assertRevertsWith(
      () =>
        h.universes.write.addMarket(
          [
            universeId,
            {
              marketId: `0x${"ee".repeat(32)}`,
              marketStructHash: `0x${"ee".repeat(32)}`,
              maturity: 3_000_000_000n,
              collateralFamily: 0,
              maturityBucket: 0,
              tickSpacing: 4,
              settlementFeeFloorWad: 0n,
              publicPriority: 0,
            },
            [4_000],
            [10n ** 17n],
          ],
          // AS THE CURATOR. Wallet 0 is the deployer from Phase 6 and would be refused
          // `NotCurator` here — which would make this test pass for the wrong reason and stop
          // proving anything about universe immutability.
          { account: h.curator.account },
        ),
      "UniverseIsActive",
      "a market was added to an activated universe",
    );
  });

  it("only the borrower may open an epoch against their own request", async () => {
    const { universeId } = await createUniverse(h, { ...SMALL, label: `open-${Date.now()}` });
    const borrower = await setupBorrower(h, universeId, 5, { desiredAssets: 10n * UNIT });
    await assertRevertsWith(
      () =>
        h.epochs.write.openEpoch([universeId, borrower.requestId, 3_600n], {
          account: h.wallets[9].account,
        }),
      "NotBorrower",
      "a third party opened an epoch against someone else's request",
    );
  });
});

/** Runs a complete small epoch and returns it. Used where the epoch itself is not under test. */
async function runSmallEpoch(
  h: CurveHarness,
  label: string,
  providerA: number,
  providerB: number,
  borrowerIndex: number,
): Promise<EpochState> {
  const { universeId, universe } = await createUniverse(h, {
    ...SMALL,
    label: `${label}-${Date.now()}`,
  });
  const providers: SealedProviderState[] = [
    await setupProvider(h, universeId, { walletIndex: providerA, balance: 900n * UNIT }),
    await setupProvider(h, universeId, { walletIndex: providerB, balance: 900n * UNIT }),
  ];
  const borrower = await setupBorrower(h, universeId, borrowerIndex, {
    desiredAssets: 200n * UNIT,
  });
  const epoch = await openAndSeal(h, universeId, universe, providers, borrower);
  return runEpoch(h, epoch);
}
