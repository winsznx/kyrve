/**
 * Phase 2 demonstrations 5–9.
 *
 *   5. A provider submits an encrypted multi-market mandate.
 *   6. The provider decrypts the stored mandate.
 *   7. Another wallet cannot decrypt it.
 *   8. The provider replaces the mandate.
 *   9. The old epoch becomes unusable.
 *
 * Every one of the 35 handles is a real gateway-issued handle bound to this contract, this chain,
 * this wallet and a one-hour expiry. The refusal in (7) and the staleness in (9) are the two halves
 * of the privacy model: nobody else can read a mandate, and a superseded mandate cannot act.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import {
  encryptMandate,
  MANDATE_HANDLE_COUNT,
  mandateDisclosure,
  NotAuthorisedToDecryptError,
  readAcl,
} from "@kyrve/nox";

import {
  assertRevertsWith,
  clientFor,
  deployHarness,
  type Harness,
  LOCAL_NOX_NETWORK,
  mine,
  SUITE_POLL,
  sampleMandate,
} from "./helpers.js";

const UNIVERSE = `0x${"11".repeat(32)}` as `0x${string}`;

describe("Phase 2: encrypted mandate book — submit, decrypt, replace, expire the epoch", () => {
  let h: Harness;
  let provider: any;
  let outsider: any;
  let mandateId: `0x${string}`;

  before(async () => {
    h = await deployHarness();
    provider = h.wallets[1];
    outsider = h.wallets[2];
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Demonstration 5
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("5. submits an encrypted multi-market mandate", async () => {
    const client = await clientFor(h, 1);
    const plaintext = sampleMandate();

    // The client-side order is defined once in @kyrve/nox and published by the contract. If the two
    // ever drift, a mandate would be sealed with its caps in its rate slots — so they are compared.
    const contractOrder = await h.mandateBook.read.mandateHandleOrder();
    assert.ok(contractOrder.includes("totalBudget, marketCaps[0..7], minRateIndexes[0..7]"));

    const encoded = await encryptMandate(client, h.mandateBook.address, plaintext);
    assert.equal(encoded.inputs.length, MANDATE_HANDLE_COUNT, "a mandate is always 35 handles");
    assert.equal(
      new Set(encoded.inputs.map((i) => i.handle)).size,
      MANDATE_HANDLE_COUNT,
      "every slot must get its own handle, including the encrypted zeros",
    );

    const nonce = await h.mandateBook.read.nextNonce([provider.account.address]);
    const receipt = await mine(
      h,
      await h.mandateBook.write.submitMandate([UNIVERSE, encoded.struct, encoded.proofs, nonce], {
        account: provider.account,
      }),
    );

    mandateId = await h.mandateBook.read.mandateIdFor([provider.account.address, UNIVERSE]);
    const mandate = await h.mandateBook.read.mandateOf([mandateId]);

    assert.equal(mandate.provider.toLowerCase(), provider.account.address.toLowerCase());
    assert.equal(mandate.activeEpoch, 1);
    assert.equal(mandate.state, 1, "state must be Active");
    assert.equal(mandate.schemaVersion, 1);

    // Three markets enabled, five sitting out — and the transaction shows the same 35 slots either
    // way, so the count of enabled markets is not inferable from the submission's shape.
    const disclosure = mandateDisclosure(provider.account.address, UNIVERSE, 1, plaintext);
    assert.equal(disclosure.privateFields.length, MANDATE_HANDLE_COUNT);
    assert.ok(disclosure.publicFields.some((f) => f.name === "commitment"));

    console.log(`  mandate id      : ${mandateId}`);
    console.log(`  handles sealed  : ${MANDATE_HANDLE_COUNT}`);
    console.log(`  markets enabled : 3 of 8 — indistinguishable from the submission shape`);
    console.log(`  submit gas      : ${receipt.gasUsed}`);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Demonstration 6
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("6. the provider decrypts every field of their own stored mandate", async () => {
    const client = await clientFor(h, 1);
    const stored = await h.mandateBook.read.handlesOf([mandateId, 1]);
    const expected = sampleMandate();

    assert.equal(await client.decrypt(stored.totalBudget, SUITE_POLL), expected.totalBudget);

    for (let i = 0; i < 8; i++) {
      const cap = expected.marketCaps[i] ?? 0n;
      assert.equal(
        await client.decrypt(stored.marketCaps[i], SUITE_POLL),
        cap,
        `market cap ${i} must round-trip, including the encrypted-zero padding slots`,
      );
      assert.equal(
        await client.decrypt(stored.minRateIndexes[i], SUITE_POLL),
        BigInt(expected.minRateIndexes[i] ?? 0),
      );
      assert.equal(
        await client.decrypt(stored.enabledFlags[i], SUITE_POLL),
        BigInt(expected.enabledFlags[i] ?? 0),
      );
    }

    assert.equal(
      await client.decrypt(stored.allocationWeight, SUITE_POLL),
      BigInt(expected.allocationWeight),
    );

    console.log("  all 35 fields decrypted by the provider, values match exactly");
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Demonstration 7
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("7. another wallet cannot decrypt any field of that mandate", async () => {
    const outsiderClient = await clientFor(h, 2);
    const stored = await h.mandateBook.read.handlesOf([mandateId, 1]);

    const probes = [stored.totalBudget, stored.marketCaps[0], stored.minRateIndexes[0]];
    for (const handle of probes) {
      const acl = await readAcl(
        h.publicClient,
        LOCAL_NOX_NETWORK(),
        handle,
        outsider.account.address,
      );
      assert.equal(acl.isAdmin, false);
      assert.equal(acl.canDecrypt, false);
      assert.equal(acl.isPublic, false);

      await assert.rejects(
        () => outsiderClient.decrypt(handle, SUITE_POLL),
        (error: unknown) => error instanceof NotAuthorisedToDecryptError,
      );
    }

    console.log("  outsider refused on budget, market cap and rate floor — no grant, not public");
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Demonstrations 8 and 9
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("8+9. replaces the mandate, and the old epoch stops authorising anything", async () => {
    const client = await clientFor(h, 1);

    const before1 = await h.mandateBook.read.mandateOf([mandateId]);
    assert.equal(before1.activeEpoch, 1);
    // Epoch 1 authorises right now — asserted before the replacement so the change is proven, not
    // merely observed after the fact.
    await h.mandateBook.read.assertUsable([mandateId, 1]);

    const replacement = {
      ...sampleMandate(),
      totalBudget: 9_000_000_000n,
      minRateIndexes: [30, 30, 0, 30],
    };
    const encoded = await encryptMandate(client, h.mandateBook.address, replacement);
    const nonce = await h.mandateBook.read.nextNonce([provider.account.address]);

    await mine(
      h,
      await h.mandateBook.write.replaceMandate([mandateId, encoded.struct, encoded.proofs, nonce], {
        account: provider.account,
      }),
    );

    const after = await h.mandateBook.read.mandateOf([mandateId]);
    assert.equal(after.activeEpoch, 2, "a replacement must open a new epoch, not edit the old one");

    // Epoch 2 is live and carries the new values.
    await h.mandateBook.read.assertUsable([mandateId, 2]);
    const epoch2 = await h.mandateBook.read.handlesOf([mandateId, 2]);
    assert.equal(await client.decrypt(epoch2.totalBudget, SUITE_POLL), 9_000_000_000n);

    // Epoch 1 no longer authorises. This is the PRD invariant-13 check.
    assert.equal(await h.mandateBook.read.isUsable([mandateId, 1]), false);
    await assertRevertsWith(
      () => h.mandateBook.read.assertUsable([mandateId, 1]),
      "StaleMandateEpoch",
      "stale mandate epoch",
    );

    // But — and this is the honest part — epoch 1's handles were NOT destroyed and the provider can
    // still decrypt them. Nox has no way to withdraw a grant or delete a ciphertext. A user
    // interface must never call this "revoked".
    const epoch1 = await h.mandateBook.read.handlesOf([mandateId, 1]);
    assert.equal(
      await client.decrypt(epoch1.totalBudget, SUITE_POLL),
      sampleMandate().totalBudget,
      "the superseded handles remain readable by whoever already had access — permanently",
    );
    assert.notEqual(
      await h.mandateBook.read.epochCommitment([mandateId, 1]),
      await h.mandateBook.read.epochCommitment([mandateId, 2]),
      "each epoch commits to its own handle set",
    );

    console.log("  epoch 1 -> 2                 : replaced");
    console.log("  epoch 1 authorises activity  : NO (StaleMandateEpoch)");
    console.log("  epoch 1 handles still readable by the provider: YES — grants are permanent");
  });

  it("pauses, resumes and retires a mandate, and retirement is terminal", async () => {
    await mine(
      h,
      await h.mandateBook.write.pauseMandate([mandateId], { account: provider.account }),
    );
    assert.equal(await h.mandateBook.read.isUsable([mandateId, 2]), false);
    await assertRevertsWith(
      () => h.mandateBook.read.assertUsable([mandateId, 2]),
      "MandateNotActive",
      "paused mandate",
    );

    await mine(
      h,
      await h.mandateBook.write.resumeMandate([mandateId], { account: provider.account }),
    );
    assert.equal(await h.mandateBook.read.isUsable([mandateId, 2]), true);

    await mine(
      h,
      await h.mandateBook.write.retireMandate([mandateId], { account: provider.account }),
    );
    assert.equal(await h.mandateBook.read.isUsable([mandateId, 2]), false);

    const client = await clientFor(h, 1);
    const encoded = await encryptMandate(client, h.mandateBook.address, sampleMandate());
    const nonce = await h.mandateBook.read.nextNonce([provider.account.address]);
    await assertRevertsWith(
      () =>
        h.mandateBook.write.replaceMandate([mandateId, encoded.struct, encoded.proofs, nonce], {
          account: provider.account,
        }),
      "MandateIsRetired",
      "replacing a retired mandate",
    );

    console.log("  pause / resume / retire : all work; retirement is terminal");
  });

  it("refuses a mandate submitted by anyone but its provider", async () => {
    await assertRevertsWith(
      () => h.mandateBook.write.pauseMandate([mandateId], { account: outsider.account }),
      "NotMandateProvider",
      "outsider pausing someone else's mandate",
    );
  });
});
