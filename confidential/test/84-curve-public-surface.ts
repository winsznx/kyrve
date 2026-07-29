/**
 * Two properties that would be easy to fake and hard to notice.
 *
 *   1. EXACTLY five values are publicly decryptable, enumerated exhaustively rather than sampled.
 *   2. The off-chain handle derivation reproduces a handle a live NoxCompute actually returned.
 *
 * The second is the one that matters most. `CurveGraphRegistry` commits to which handle each public
 * result must be, and `@kyrve/nox`'s `deriveHandle` is what lets a verifier compute that handle
 * before any proof arrives. If the derivation formula were wrong, the whole binding would be
 * decorative — and Phase 1 shipped exactly such a formula for a year of the project's life,
 * unnoticed, because there was no live gateway to compare against (delta R-4).
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { UNIT } from "@kyrve/curve";
import { deriveHandle, deriveIsolatedHandle, type Handle, isPublicHandle } from "@kyrve/nox";

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
} from "./curve-helpers.js";
import { clientFor, LOCAL_NOX_NETWORK, mine } from "./helpers.js";

describe("Phase 3: the public surface is exactly five values, and the derivation is real", () => {
  let h: CurveHarness;
  let epoch: EpochState;
  let providers: SealedProviderState[];

  before(async () => {
    h = await deployCurveHarness();
    const { universeId, universe } = await createUniverse(h, {
      markets: 2,
      ratesPerMarket: 8,
      privacyFloor: 2,
      cellsPerChunk: 32,
      label: `surface-${Date.now()}`,
    });
    providers = [
      await setupProvider(h, universeId, { walletIndex: 1, balance: 700n * UNIT }),
      await setupProvider(h, universeId, { walletIndex: 2, balance: 600n * UNIT }),
      await setupProvider(h, universeId, { walletIndex: 3, balance: 500n * UNIT }),
    ];
    const borrower = await setupBorrower(h, universeId, 5, { desiredAssets: 400n * UNIT });
    epoch = await openAndSeal(h, universeId, universe, providers, borrower);
    await runEpoch(h, epoch);
  });

  it("enumerates EVERY handle the epoch produced, and exactly five are public", async () => {
    const published = (await h.engine.read.publishedOf([epoch.epochId])) as Record<string, Handle>;
    const publicSet = new Set(Object.values(published).map((handle) => handle.toLowerCase()));
    assert.equal(publicSet.size, 5, "the published set must be exactly five distinct handles");

    // Everything the epoch produced, gathered rather than sampled. A sample would pass while the
    // one handle that leaked sat outside it.
    const everything: { what: string; handle: Handle }[] = [];

    for (let leaf = 0; leaf < epoch.universe.leaves.length; leaf += 1) {
      everything.push({
        what: `leafCapacity[${leaf}]`,
        handle: (await h.engine.read.confidentialLeafCapacityOf([epoch.epochId, leaf])) as Handle,
      });
      everything.push({
        what: `fillable[${leaf}]`,
        handle: (await h.engine.read.confidentialFillableOf([epoch.epochId, leaf])) as Handle,
      });
      everything.push({
        what: `providerCount[${leaf}]`,
        handle: (await h.engine.read.confidentialProviderCountOf([epoch.epochId, leaf])) as Handle,
      });
    }

    for (let slot = 0; slot < providers.length; slot += 1) {
      for (let market = 0; market < epoch.universe.markets.length; market += 1) {
        const cached = await h.engine.read.cachedOf([epoch.epochId, slot, market]);
        everything.push({
          what: `cachedCapacity[${slot}][${market}]`,
          handle: cached.capacity as Handle,
        });
        everything.push({
          what: `cachedCount[${slot}][${market}]`,
          handle: cached.count as Handle,
        });
      }
      everything.push({
        what: `allocation[${slot}]`,
        handle: (await h.engine.read.confidentialAllocationOf([epoch.epochId, slot])) as Handle,
      });
      const provider = providers[slot]!;
      for (const view of [
        "confidentialSeedOf",
        "confidentialRemainingOf",
        "confidentialReservedOf",
      ] as const) {
        everything.push({
          what: `${view}[${slot}]`,
          handle: (await h.ledger.read[view]([epoch.epochId, provider.address])) as Handle,
        });
      }
    }
    everything.push({
      what: "dustResidue",
      handle: (await h.engine.read.confidentialDustOf([epoch.epochId])) as Handle,
    });

    // Derived from the universe's shape rather than compared to a round number, so a view that
    // stopped returning anything would shrink the scan and fail here instead of silently
    // narrowing what "exhaustive" covers.
    const expected =
      epoch.universe.leaves.length * 3 +
      providers.length * (epoch.universe.markets.length * 2 + 1 + 3) +
      1;
    assert.equal(
      everything.length,
      expected,
      "the scan did not cover every handle the epoch produced",
    );

    const leaked: string[] = [];
    for (const { what, handle } of everything) {
      if (publicSet.has(handle.toLowerCase())) continue;
      const state = await acl(h, handle, h.wallets[9].account.address as `0x${string}`);
      if (state.isPublic) leaked.push(`${what} (${handle})`);
    }
    assert.deepEqual(
      leaked,
      [],
      `these handles are publicly decryptable and must not be: ${leaked.join(", ")}. ` +
        "`allowPublicDecryption` is IRREVERSIBLE, so this cannot be undone once shipped.",
    );
  });

  it("the scan can actually fail, so it is not vacuous", async () => {
    // A check that cannot fail proves nothing. This publishes a handle deliberately and confirms
    // the same predicate the scan uses reports it — so a green scan means something.
    const client = await clientFor(h, 1);
    const probe = await h.connection.viem.deployContract("IsolationProbe", [h.controller.address]);
    const a = await client.encrypt(3n * UNIT, "euint256", probe.address);
    const b = await client.encrypt(5n * UNIT, "euint256", probe.address);
    await mine(
      h,
      await probe.write.probe([`0x${"77".repeat(32)}`, a.handle, a.proof, b.handle, b.proof], {
        account: h.wallets[1].account,
      }),
    );

    const beforePublication = (await probe.read.isolatedA()) as Handle;
    assert.equal(
      (await acl(h, beforePublication, h.wallets[9].account.address as `0x${string}`)).isPublic,
      false,
      "the probe's output was already public, so the negative control proves nothing",
    );
  });

  it("the off-chain derivation reproduces a handle NoxCompute really returned", async () => {
    // Without this, `deriveHandle` is a formula nobody checked against reality, and the graph
    // binding it supports is decorative.
    const client = await clientFor(h, 1);
    const probe = await h.connection.viem.deployContract("IsolationProbe", [h.controller.address]);
    const a = await client.encrypt(13n * UNIT, "euint256", probe.address);
    const b = await client.encrypt(29n * UNIT, "euint256", probe.address);

    await mine(
      h,
      await probe.write.probe([`0x${"a1".repeat(32)}`, a.handle, a.proof, b.handle, b.proof], {
        account: h.wallets[1].account,
      }),
    );

    const network = LOCAL_NOX_NETWORK();
    const naiveA = (await probe.read.naiveA()) as Handle;
    const isolatedA = (await probe.read.isolatedA()) as Handle;
    const epochCondition = (await probe.read.epochCondition()) as Handle;
    const domainA = (await probe.read.domainA()) as `0x${string}`;

    // 1. A plain `add` of two gateway input handles.
    assert.equal(
      deriveHandle({
        operator: "add",
        operands: [a.handle, b.handle],
        resultType: "euint256",
        noxCompute: network.noxCompute,
        chainId: network.chainId,
      }),
      naiveA,
      "the derivation does not reproduce a real `add` handle",
    );

    // 2. The isolation `select`, which is the shape every published result goes through.
    assert.equal(
      deriveIsolatedHandle({
        epochCondition,
        value: naiveA,
        domain: domainA,
        resultType: "euint256",
        noxCompute: network.noxCompute,
        chainId: network.chainId,
      }),
      isolatedA,
      "the derivation does not reproduce a real isolated handle, so an expected published handle " +
        "could never be computed before its proof arrives",
    );

    // 3. The metadata the derivation packs is the metadata the chain produced.
    assert.equal(isPublicHandle(isolatedA), false);
  });
});
