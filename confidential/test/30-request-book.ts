/**
 * Phase 2 demonstrations 10–12, plus the bond lifecycle.
 *
 *   10. A borrower submits an encrypted request.
 *   11. The borrower decrypts the request.
 *   12. Another wallet cannot decrypt it.
 *
 * The asymmetry matters here. A request has real public fields — the bond is ETH and its value is
 * visible, the expiry has to be agreed by every verifier, the collateral is a public Midnight
 * position. What stays encrypted is the part that would let a provider quote exactly at the
 * borrower's limit: desired size, minimum size, and every maximum rate index.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import {
  encryptRequest,
  NotAuthorisedToDecryptError,
  REQUEST_HANDLE_COUNT,
  readAcl,
  requestDisclosure,
} from "@kyrve/nox";

import {
  assertRevertsWith,
  clientFor,
  deployHarness,
  type Harness,
  LOCAL_NOX_NETWORK,
  mine,
  SUITE_POLL,
  sampleRequest,
} from "./helpers.js";

const UNIVERSE = `0x${"22".repeat(32)}` as `0x${string}`;
const BOND = 2_000_000_000_000_000n; // 0.002 ETH, above the public minimum
const LIFETIME = 3600;
const COLLATERAL_REF = `0x${"ab".repeat(32)}` as `0x${string}`;

describe("Phase 2: confidential request book — submit, decrypt, bond, cancel, expire", () => {
  let h: Harness;
  let borrower: any;
  let outsider: any;
  let requestId: `0x${string}`;

  before(async () => {
    h = await deployHarness();
    borrower = h.wallets[1];
    outsider = h.wallets[2];
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Demonstration 10
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("10. submits an encrypted borrower request with a public bond", async () => {
    const client = await clientFor(h, 1);
    const plaintext = sampleRequest();

    const contractOrder = await h.requestBook.read.requestHandleOrder();
    assert.ok(contractOrder.includes("desiredAssets, minimumAssets, maxRateIndexes[0..7]"));

    const encoded = await encryptRequest(client, h.requestBook.address, plaintext);
    assert.equal(encoded.inputs.length, REQUEST_HANDLE_COUNT, "a request is always 19 handles");

    const nonce = await h.requestBook.read.nextNonce([borrower.account.address]);
    const receipt = await mine(
      h,
      await h.requestBook.write.submitRequest(
        [UNIVERSE, encoded.struct, encoded.proofs, LIFETIME, true, COLLATERAL_REF, nonce],
        { account: borrower.account, value: BOND },
      ),
    );

    const logs = await h.publicClient.getContractEvents({
      address: h.requestBook.address,
      abi: h.requestBook.abi,
      eventName: "RequestSubmitted",
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });
    requestId = logs[0].args.requestId;

    const request = await h.requestBook.read.requestOf([requestId]);
    assert.equal(request.borrower.toLowerCase(), borrower.account.address.toLowerCase());
    assert.equal(request.bondWei, BOND);
    assert.equal(request.exactFillRequired, true);
    assert.equal(request.state, 1, "state must be Submitted");
    assert.equal(
      await h.requestBook.read.liveRequest([borrower.account.address, UNIVERSE]),
      requestId,
    );

    // The disclosure preview is derived from the same field lists the encoder uses, so a field
    // cannot be encrypted in one place and described as public in the other.
    const disclosure = requestDisclosure(
      borrower.account.address,
      UNIVERSE,
      BOND,
      Number(request.expiresAt),
      plaintext,
    );
    assert.equal(disclosure.privateFields.length, REQUEST_HANDLE_COUNT);
    assert.ok(disclosure.publicFields.some((f) => f.name === "bond"));
    assert.ok(!disclosure.publicFields.some((f) => f.name.includes("maxRateIndexes")));

    console.log(`  request id  : ${requestId}`);
    console.log(`  bond (public): ${BOND} wei`);
    console.log(`  private fields: ${disclosure.privateFields.length}`);
    console.log(`  submit gas  : ${receipt.gasUsed}`);
  });

  it("refuses a second live request for the same borrower and universe", async () => {
    const client = await clientFor(h, 1);
    const encoded = await encryptRequest(client, h.requestBook.address, sampleRequest());
    const nonce = await h.requestBook.read.nextNonce([borrower.account.address]);
    await assertRevertsWith(
      () =>
        h.requestBook.write.submitRequest(
          [UNIVERSE, encoded.struct, encoded.proofs, LIFETIME, true, COLLATERAL_REF, nonce],
          { account: borrower.account, value: BOND },
        ),
      "RequestAlreadyLive",
      "second live request",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Demonstration 11
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("11. the borrower decrypts their own request", async () => {
    const client = await clientFor(h, 1);
    const stored = await h.requestBook.read.handlesOf([requestId]);
    const expected = sampleRequest();

    assert.equal(await client.decrypt(stored.desiredAssets, SUITE_POLL), expected.desiredAssets);
    assert.equal(await client.decrypt(stored.minimumAssets, SUITE_POLL), expected.minimumAssets);
    assert.equal(
      await client.decrypt(stored.preferredMaturityIndex, SUITE_POLL),
      BigInt(expected.preferredMaturityIndex),
    );
    for (let i = 0; i < 8; i++) {
      assert.equal(
        await client.decrypt(stored.maxRateIndexes[i], SUITE_POLL),
        BigInt(expected.maxRateIndexes[i] ?? 0),
      );
    }

    console.log("  borrower decrypted desired, minimum, maturity and all 8 rate limits");
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Demonstration 12
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("12. another wallet cannot decrypt the borrower's price limit", async () => {
    const outsiderClient = await clientFor(h, 2);
    const stored = await h.requestBook.read.handlesOf([requestId]);

    for (const handle of [stored.desiredAssets, stored.maxRateIndexes[0]]) {
      const acl = await readAcl(
        h.publicClient,
        LOCAL_NOX_NETWORK(),
        handle,
        outsider.account.address,
      );
      assert.equal(acl.canDecrypt, false);
      assert.equal(acl.isPublic, false);
      await assert.rejects(
        () => outsiderClient.decrypt(handle, SUITE_POLL),
        (error: unknown) => error instanceof NotAuthorisedToDecryptError,
      );
    }

    console.log("  outsider refused on desired size and rate limit — the probing defence holds");
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Bond lifecycle
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("tops up the bond, then refunds it in full on cancellation", async () => {
    const topUp = 500_000_000_000_000n;
    await mine(
      h,
      await h.requestBook.write.topUpBond([requestId], {
        account: borrower.account,
        value: topUp,
      }),
    );
    let request = await h.requestBook.read.requestOf([requestId]);
    assert.equal(request.bondWei, BOND + topUp);

    const before = await h.publicClient.getBalance({ address: borrower.account.address });
    const receipt = await mine(
      h,
      await h.requestBook.write.cancelUnsealedRequest([requestId], { account: borrower.account }),
    );
    const after = await h.publicClient.getBalance({ address: borrower.account.address });

    const gasCost = receipt.gasUsed * receipt.effectiveGasPrice;
    assert.equal(
      after - before + gasCost,
      BOND + topUp,
      "cancellation must return the whole bond; there is no path that pays it anywhere else",
    );

    request = await h.requestBook.read.requestOf([requestId]);
    assert.equal(request.state, 2, "state must be Cancelled");
    assert.equal(request.bondWei, 0n);
    assert.equal(
      await h.requestBook.read.liveRequest([borrower.account.address, UNIVERSE]),
      `0x${"00".repeat(32)}`,
      "cancelling must free the borrower to submit again",
    );

    // The contract must hold nothing after a full refund.
    assert.equal(await h.publicClient.getBalance({ address: h.requestBook.address }), 0n);

    console.log(`  bond ${BOND} + ${topUp} refunded in full on cancel`);
  });

  it("expires a stale request permissionlessly, and pays the borrower not the caller", async () => {
    const client = await clientFor(h, 1);
    const encoded = await encryptRequest(client, h.requestBook.address, sampleRequest());
    const nonce = await h.requestBook.read.nextNonce([borrower.account.address]);
    const receipt = await mine(
      h,
      await h.requestBook.write.submitRequest(
        [UNIVERSE, encoded.struct, encoded.proofs, 300, false, COLLATERAL_REF, nonce],
        { account: borrower.account, value: BOND },
      ),
    );
    const logs = await h.publicClient.getContractEvents({
      address: h.requestBook.address,
      abi: h.requestBook.abi,
      eventName: "RequestSubmitted",
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });
    const staleId = logs[0].args.requestId;

    await assertRevertsWith(
      () => h.requestBook.write.expireRequest([staleId], { account: outsider.account }),
      "RequestNotYetExpired",
      "expiring before the deadline",
    );

    await h.publicClient.request({ method: "evm_increaseTime" as any, params: [400] as any });
    await h.publicClient.request({ method: "evm_mine" as any, params: [] as any });

    const borrowerBefore = await h.publicClient.getBalance({ address: borrower.account.address });
    // A third party calls it. The refund still goes to the borrower — no bond can be captured by
    // whoever happens to clear the queue.
    await mine(
      h,
      await h.requestBook.write.expireRequest([staleId], { account: outsider.account }),
    );
    const borrowerAfter = await h.publicClient.getBalance({ address: borrower.account.address });

    assert.equal(
      borrowerAfter - borrowerBefore,
      BOND,
      "the borrower receives the bond, not the caller",
    );
    assert.equal((await h.requestBook.read.requestOf([staleId])).state, 3, "state must be Expired");

    console.log("  expiry is permissionless, and the bond always returns to the borrower");
  });

  it("refuses a bond below the public minimum and a lifetime outside the bounds", async () => {
    const client = await clientFor(h, 1);
    const encoded = await encryptRequest(client, h.requestBook.address, sampleRequest());
    const nonce = await h.requestBook.read.nextNonce([borrower.account.address]);

    await assertRevertsWith(
      () =>
        h.requestBook.write.submitRequest(
          [UNIVERSE, encoded.struct, encoded.proofs, LIFETIME, true, COLLATERAL_REF, nonce],
          { account: borrower.account, value: 1n },
        ),
      "BondTooSmall",
      "bond below the minimum",
    );

    await assertRevertsWith(
      () =>
        h.requestBook.write.submitRequest(
          [UNIVERSE, encoded.struct, encoded.proofs, 30, true, COLLATERAL_REF, nonce],
          { account: borrower.account, value: BOND },
        ),
      "LifetimeOutOfRange",
      "lifetime below the minimum",
    );
  });
});
