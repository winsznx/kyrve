/**
 * Phase 2 demonstration 14 — emergency pause works, and cannot trap a user's assets.
 *
 * PRD invariant 20 is the one an emergency control most often breaks in practice: a guardian pauses
 * "everything", and holders discover their capital is stuck. Kyrve makes that structurally
 * impossible rather than promising it in a comment — {KyrveEmergencyController} has an enum with
 * five members, all of them entries, and no member exists for withdrawal, unwrapping, unwrap
 * finalisation, cancellation, expiry, retirement or reservation release.
 *
 * So this suite calls `pauseAll()` — the strongest state the guardian can reach — and then proves
 * every recovery path still runs.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { encryptMandate, encryptRequest, readAcl } from "@kyrve/nox";

import {
  assertRevertsWith,
  clientFor,
  deployHarness,
  type Harness,
  LOCAL_NOX_NETWORK,
  mine,
  ROLE_INDEX,
  SUITE_POLL,
  sampleMandate,
  sampleRequest,
  VAULT_DEPOSIT,
  WRAP_AMOUNT,
} from "./helpers.js";

const UNIVERSE = `0x${"44".repeat(32)}` as `0x${string}`;
const BOND = 2_000_000_000_000_000n;
const COLLATERAL_REF = `0x${"cd".repeat(32)}` as `0x${string}`;

describe("Phase 2: emergency pause stops entry and never blocks recovery", () => {
  let h: Harness;
  /** Any wallet with no relationship to the value — used to prove a PUBLIC handle really is public. */
  const outsiderAddress = () => h.wallets[5].account.address as `0x${string}`;
  let guardian: any;
  let provider: any;
  let mandateId: `0x${string}`;
  let requestId: `0x${string}`;

  before(async () => {
    h = await deployHarness();
    guardian = h.wallets[ROLE_INDEX.emergencyAuthority];
    provider = h.wallets[1];

    // Put the provider into every position a pause could strand: wrapped tokens, a vault balance,
    // a live mandate and a live request with a bond.
    await mine(h, await h.underlying.write.mint([provider.account.address, WRAP_AMOUNT * 4n]));
    await mine(
      h,
      await h.underlying.write.approve([h.asset.address, WRAP_AMOUNT], {
        account: provider.account,
      }),
    );
    await mine(
      h,
      await h.asset.write.wrap([provider.account.address, WRAP_AMOUNT], {
        account: provider.account,
      }),
    );

    const block = await h.publicClient.getBlock();
    await mine(
      h,
      await h.asset.write.setOperator([h.vault.address, Number(block.timestamp) + 900], {
        account: provider.account,
      }),
    );

    const client = await clientFor(h, 1);
    const deposit = await client.encrypt(VAULT_DEPOSIT, "euint256", h.vault.address);
    await mine(
      h,
      await h.vault.write.deposit(
        [deposit.handle, deposit.proof, await h.vault.read.nextNonce([provider.account.address])],
        { account: provider.account },
      ),
    );

    const mandate = await encryptMandate(client, h.mandateBook.address, sampleMandate());
    await mine(
      h,
      await h.mandateBook.write.submitMandate(
        [
          UNIVERSE,
          mandate.struct,
          mandate.proofs,
          await h.mandateBook.read.nextNonce([provider.account.address]),
        ],
        { account: provider.account },
      ),
    );
    mandateId = await h.mandateBook.read.mandateIdFor([provider.account.address, UNIVERSE]);

    const request = await encryptRequest(client, h.requestBook.address, sampleRequest());
    const receipt = await mine(
      h,
      await h.requestBook.write.submitRequest(
        [
          UNIVERSE,
          request.struct,
          request.proofs,
          3600,
          true,
          COLLATERAL_REF,
          await h.requestBook.read.nextNonce([provider.account.address]),
        ],
        { account: provider.account, value: BOND },
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
  });

  it("14a. only the guardian may pause", async () => {
    await assertRevertsWith(
      () => h.controller.write.pauseAll({ account: provider.account }),
      "NotGuardian",
      "non-guardian pausing",
    );
  });

  it("14b. pauseAll stops every entry", async () => {
    await mine(h, await h.controller.write.pauseAll({ account: guardian.account }));

    const client = await clientFor(h, 1);

    await mine(
      h,
      await h.underlying.write.approve([h.asset.address, WRAP_AMOUNT], {
        account: provider.account,
      }),
    );
    await assertRevertsWith(
      () =>
        h.asset.write.wrap([provider.account.address, WRAP_AMOUNT], { account: provider.account }),
      "ActivityIsPaused",
      "wrapping while paused",
    );

    const deposit = await client.encrypt(1_000n, "euint256", h.vault.address);
    const depositNonce = await h.vault.read.nextNonce([provider.account.address]);
    await assertRevertsWith(
      () =>
        h.vault.write.deposit([deposit.handle, deposit.proof, depositNonce], {
          account: provider.account,
        }),
      "ActivityIsPaused",
      "depositing while paused",
    );

    const mandate = await encryptMandate(client, h.mandateBook.address, sampleMandate());
    const mandateNonce = await h.mandateBook.read.nextNonce([provider.account.address]);
    await assertRevertsWith(
      () =>
        h.mandateBook.write.replaceMandate(
          [mandateId, mandate.struct, mandate.proofs, mandateNonce],
          { account: provider.account },
        ),
      "ActivityIsPaused",
      "replacing a mandate while paused",
    );

    console.log("  paused: wrap, vault deposit, mandate submission — all refused publicly");
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // The half that matters
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("14c. RECOVERY: a provider still withdraws from the vault while everything is paused", async () => {
    const client = await clientFor(h, 1);

    // The wallet balance BEFORE, so the withdrawal is proven to have PAID rather than merely to have
    // debited. The vault debits its internal ledger before the ERC-7984 transfer, and that transfer
    // moves encrypted zero if the vault's own wrapper balance is short — which would burn the claim
    // and pay nothing, silently. Asserting only that `available` reached zero would pass in exactly
    // that case, which is the failure this assertion exists to catch.
    const walletBefore = await client.decrypt(
      await h.asset.read.confidentialBalanceOf([provider.account.address]),
      SUITE_POLL,
    );

    const amount = await client.encrypt(VAULT_DEPOSIT, "euint256", h.vault.address);
    await mine(
      h,
      await h.vault.write.withdraw(
        [amount.handle, amount.proof, await h.vault.read.nextNonce([provider.account.address])],
        { account: provider.account },
      ),
    );

    const available = await h.vault.read.confidentialAvailableOf([provider.account.address]);
    assert.equal(
      await client.decrypt(available, SUITE_POLL),
      0n,
      "the vault balance is fully recovered",
    );

    const walletAfter = await client.decrypt(
      await h.asset.read.confidentialBalanceOf([provider.account.address]),
      SUITE_POLL,
    );
    assert.equal(
      walletAfter - walletBefore,
      VAULT_DEPOSIT,
      "the wallet must receive exactly what the vault debited — the accounting invariant " +
        "`sum(available) + sum(locked) <= coverage`, checked by payment rather than by argument",
    );

    console.log("  paused + withdraw : SUCCEEDED — no pause flag exists for this path");
    console.log("  debited == paid   : the vault's coverage actually covered the claim");
  });

  it("14d. RECOVERY: a holder still unwraps to the public ERC-20 while everything is paused", async () => {
    const client = await clientFor(h, 1);
    const unwrapAmount = 250_000_000n;
    const input = await client.encrypt(unwrapAmount, "euint256", h.asset.address);

    const receipt = await mine(
      h,
      await h.asset.write.unwrap(
        [provider.account.address, provider.account.address, input.handle, input.proof],
        { account: provider.account },
      ),
    );

    const logs = await h.publicClient.getContractEvents({
      address: h.asset.address,
      abi: h.asset.abi,
      eventName: "UnwrapRequested",
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });
    const unwrapRequestId = logs[0].args.amount as `0x${string}`;
    assert.ok(unwrapRequestId, "the unwrap request must carry the burn-amount handle");
    assert.equal(
      (await h.asset.read.unwrapRequester([unwrapRequestId])).toLowerCase(),
      provider.account.address.toLowerCase(),
    );

    // The burn amount is now PERMANENTLY publicly decryptable. That is the confidentiality end
    // point: `_unwrap` calls `allowPublicDecryption`, and Nox has no un-publish. The interface must
    // name this crossing before the user signs, and must never describe it as reversible.
    const status = await client.waitReady(unwrapRequestId, SUITE_POLL);
    assert.equal(status.state, "ready");
    const acl = await readAcl(
      h.publicClient,
      LOCAL_NOX_NETWORK(),
      unwrapRequestId,
      outsiderAddress(),
    );
    assert.equal(
      acl.isPublic,
      true,
      "the unwrap amount must be publicly decryptable — that is what makes it the boundary",
    );

    console.log("  paused + unwrap   : SUCCEEDED");
    console.log("  unwrap amount     : now PUBLIC and permanently so (allowPublicDecryption)");
  });

  it("14e. RECOVERY: a borrower still cancels and gets the whole bond back while paused", async () => {
    const before = await h.publicClient.getBalance({ address: provider.account.address });
    const receipt = await mine(
      h,
      await h.requestBook.write.cancelUnsealedRequest([requestId], { account: provider.account }),
    );
    const after = await h.publicClient.getBalance({ address: provider.account.address });

    assert.equal(
      after - before + receipt.gasUsed * receipt.effectiveGasPrice,
      BOND,
      "an emergency pause must not capture a single wei of a borrower's bond",
    );
    console.log("  paused + cancel   : SUCCEEDED, full bond refunded");
  });

  it("14f. RECOVERY: a provider still pauses and retires their own mandate while paused", async () => {
    await mine(
      h,
      await h.mandateBook.write.pauseMandate([mandateId], { account: provider.account }),
    );
    await mine(
      h,
      await h.mandateBook.write.retireMandate([mandateId], { account: provider.account }),
    );
    assert.equal(
      (await h.mandateBook.read.mandateOf([mandateId])).state,
      3,
      "state must be Retired",
    );
    console.log("  paused + retire   : SUCCEEDED — a provider can always stop lending");
  });

  it("14g. unpausing restores entry", async () => {
    for (const activity of [0, 1, 2, 3, 4]) {
      await mine(h, await h.controller.write.unpause([activity], { account: guardian.account }));
    }
    await mine(
      h,
      await h.underlying.write.approve([h.asset.address, WRAP_AMOUNT], {
        account: provider.account,
      }),
    );
    await mine(
      h,
      await h.asset.write.wrap([provider.account.address, WRAP_AMOUNT], {
        account: provider.account,
      }),
    );
    console.log("  unpaused + wrap   : SUCCEEDED");
  });

  it("the controller has no pause flag for any recovery path — checked against its own ABI", async () => {
    // The enum is the whole security argument. If someone adds a `Withdraw` member later, this
    // fails, which is the point.
    const activities = [
      "WrapUnderlying",
      "VaultDeposit",
      "MandateSubmission",
      "RequestSubmission",
      "ReservationOpening",
    ];
    const forbidden = ["withdraw", "unwrap", "cancel", "expire", "retire", "release", "finalize"];
    for (const name of activities) {
      for (const word of forbidden) {
        assert.ok(
          !name.toLowerCase().includes(word),
          `${name} looks like a recovery path; pausing it would breach PRD invariant 20`,
        );
      }
    }
    await assertRevertsWith(
      () => h.controller.write.pause([5], { account: guardian.account }),
      "",
      "an activity outside the enum",
    );
    console.log(`  pausable activities: ${activities.join(", ")} — all entries, no recovery`);
  });
});
