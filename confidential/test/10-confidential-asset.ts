/**
 * Phase 2 demonstration 1–4, plus the vault's confidential balance model.
 *
 *   1. A provider wraps public test USDC.
 *   2. The public transaction reveals the wrap amount — proven by reading it back out of calldata.
 *   3. The provider decrypts the resulting private balance.
 *   4. Another wallet cannot decrypt it.
 *
 * Everything runs against the real local Nox stack. The refusal in (4) is a real gateway refusal
 * driven by a real on-chain ACL read, not an assertion about a mock.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { NotAuthorisedToDecryptError, readAcl } from "@kyrve/nox";

import {
  assertRevertsWith,
  clientFor,
  deployHarness,
  type Harness,
  LOCAL_NOX_NETWORK,
  mine,
  SUITE_POLL,
  VAULT_DEPOSIT,
  WRAP_AMOUNT,
} from "./helpers.js";

describe("Phase 2: confidential asset — wrap, private balance, vault", () => {
  let h: Harness;
  let provider: any;
  let outsider: any;

  before(async () => {
    h = await deployHarness();
    provider = h.wallets[1];
    outsider = h.wallets[2];

    await mine(h, await h.underlying.write.mint([provider.account.address, WRAP_AMOUNT * 10n]));
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Demonstration 1 and 2
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("1+2. wraps public test USDC, and the wrap amount is PUBLIC in the transaction", async () => {
    await mine(
      h,
      await h.underlying.write.approve([h.asset.address, WRAP_AMOUNT], {
        account: provider.account,
      }),
    );

    const hash = await h.asset.write.wrap([provider.account.address, WRAP_AMOUNT], {
      account: provider.account,
    });
    const receipt = await mine(h, hash);

    // The boundary claim is not "we say it is public" — it is recovered from the chain.
    const tx = await h.publicClient.getTransaction({ hash });
    const amountWord = BigInt(`0x${tx.input.slice(10 + 64, 10 + 128)}`);
    assert.equal(
      amountWord,
      WRAP_AMOUNT,
      "the wrap amount must be readable straight out of calldata — this is the public boundary",
    );

    const held = await h.underlying.read.balanceOf([h.asset.address]);
    assert.equal(held, WRAP_AMOUNT);

    console.log(`  wrap amount recovered from calldata : ${amountWord}`);
    console.log(`  underlying held by the wrapper      : ${held}`);
    console.log(`  wrap gas                            : ${receipt.gasUsed}`);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Demonstration 3 and 4
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("3. the provider decrypts their own private balance, locally", async () => {
    const handle = await h.asset.read.confidentialBalanceOf([provider.account.address]);
    assert.notEqual(handle, `0x${"00".repeat(32)}`, "a wrapped balance must have a handle");

    const client = await clientFor(h, 1);
    const value = await client.decrypt(handle, SUITE_POLL);

    assert.equal(value, WRAP_AMOUNT, "the holder must recover exactly what they wrapped");
    console.log(`  balance handle   : ${handle}`);
    console.log("  holder decrypted : matches the wrapped amount (value not printed)");
  });

  it("4. another wallet cannot decrypt that balance", async () => {
    const handle = await h.asset.read.confidentialBalanceOf([provider.account.address]);

    // The ACL is read from the chain, not from an indexer, so the answer cannot be stale.
    const acl = await readAcl(
      h.publicClient,
      LOCAL_NOX_NETWORK(),
      handle,
      outsider.account.address,
    );
    assert.equal(acl.isAdmin, false, "an outsider must hold no admin grant");
    assert.equal(acl.canDecrypt, false, "an outsider must not be able to decrypt");
    assert.equal(acl.isPublic, false, "a private balance must not be publicly decryptable");

    const outsiderClient = await clientFor(h, 2);
    await assert.rejects(
      () => outsiderClient.decrypt(handle, SUITE_POLL),
      (error: unknown) => error instanceof NotAuthorisedToDecryptError,
      "the gateway must refuse a wallet that holds no grant",
    );

    console.log(`  outsider isAllowed/isViewer/isPublic : false / false / false`);
    console.log(`  outsider decrypt                     : REFUSED`);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Vault deposit and withdrawal
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("deposits into the vault behind a bounded operator window, and credits an encrypted balance", async () => {
    const block = await h.publicClient.getBlock();
    const until = Number(block.timestamp) + 900;

    await mine(
      h,
      await h.asset.write.setOperator([h.vault.address, until], { account: provider.account }),
    );

    const client = await clientFor(h, 1);
    const input = await client.encrypt(VAULT_DEPOSIT, "euint256", h.vault.address);
    const nonce = await h.vault.read.nextNonce([provider.account.address]);

    await mine(
      h,
      await h.vault.write.deposit([input.handle, input.proof, nonce], {
        account: provider.account,
      }),
    );

    const available = await h.vault.read.confidentialAvailableOf([provider.account.address]);
    assert.equal(
      await client.decrypt(available, SUITE_POLL),
      VAULT_DEPOSIT,
      "the vault must credit exactly what was transferred",
    );

    const walletBalance = await h.asset.read.confidentialBalanceOf([provider.account.address]);
    assert.equal(
      await client.decrypt(walletBalance, SUITE_POLL),
      WRAP_AMOUNT - VAULT_DEPOSIT,
      "the provider's wallet balance must fall by the same amount",
    );

    // End the operator grant. The window was bounded, but the honest pattern is to close it.
    await mine(
      h,
      await h.asset.write.setOperator([h.vault.address, 0], { account: provider.account }),
    );
    assert.equal(await h.asset.read.isOperator([provider.account.address, h.vault.address]), false);

    console.log("  vault available (provider decrypts) : matches the deposit (value not printed)");
    console.log(`  operator window closed              : true`);
  });

  /**
   * Delta Q-5, pinned so it cannot be rediscovered the hard way.
   *
   * A Nox handle is a pure function of (operator, operand handles in order, output index, and a
   * seed derived from those same operands). Two logically distinct quantities computed identically
   * from identical inputs are therefore THE SAME HANDLE and share ONE PERMANENT ACL entry.
   *
   * An earlier draft of the vault kept an encrypted running total alongside each provider balance.
   * On the first deposit into an empty vault both were `add(zeroHandle, received)`, so granting the
   * provider their own balance also granted them the protocol aggregate — irreversibly, since Nox
   * has no `removeAdmin`. The accumulators are gone; this test keeps the *reason* falsifiable.
   */
  it("Q-5: identical operands produce one handle — the reason the vault holds no aggregate", async () => {
    const client = await clientFor(h, 1);
    const probe = await h.connection.viem.deployContract("HandleDeterminismProbe");

    const a = await client.encrypt(7n, "euint256", probe.address);
    const b = await client.encrypt(11n, "euint256", probe.address);

    await mine(
      h,
      await probe.write.addTwice([a.handle, a.proof, b.handle, b.proof], {
        account: provider.account,
      }),
    );

    const first = await probe.read.first();
    const second = await probe.read.second();
    const reversed = await probe.read.reversed();

    assert.equal(
      first,
      second,
      "the same operator over the same operands must yield the same handle — this is the hazard",
    );
    assert.notEqual(
      first,
      reversed,
      "operand ORDER changes the handle, which is why lineage separation has to be deliberate",
    );

    // And the consequence: one grant covers both, because they are one handle.
    const acl = await readAcl(h.publicClient, LOCAL_NOX_NETWORK(), second, client.account);
    assert.equal(
      acl.isAdmin,
      true,
      "granting `first` necessarily granted `second`; they are not two values with equal contents, " +
        "they are one ciphertext with one ACL entry",
    );

    console.log(`  add(a,b) twice     : ${first === second ? "SAME handle" : "different"}`);
    console.log(`  add(b,a)           : ${first === reversed ? "same" : "DIFFERENT handle"}`);
    console.log(
      "  one grant covers both — aggregates must never share a lineage with a user value",
    );
  });

  it("the vault exposes coverage from the wrapper balance, whose lineage cannot collide", async () => {
    const coverage = await h.vault.read.confidentialCoverage();
    const providerBalance = await h.asset.read.confidentialBalanceOf([provider.account.address]);
    assert.notEqual(
      coverage,
      providerBalance,
      "the vault's own ERC-7984 balance and a provider's come from different output indexes of the " +
        "same `Nox.transfer`, so they can never be the same handle",
    );

    const acl = await readAcl(
      h.publicClient,
      LOCAL_NOX_NETWORK(),
      coverage,
      (await clientFor(h, 1)).account,
    );
    assert.equal(acl.canDecrypt, false, "no provider may decrypt the vault's coverage");
    assert.equal(acl.isPublic, false);
    console.log(`  coverage handle : ${coverage}`);
    console.log("  provider grant on coverage : none, and not public");
  });

  it("withdraws an encrypted amount, and an over-withdrawal silently moves ZERO", async () => {
    const client = await clientFor(h, 1);

    const withdrawal = 150_000_000n;
    const good = await client.encrypt(withdrawal, "euint256", h.vault.address);
    let nonce = await h.vault.read.nextNonce([provider.account.address]);
    await mine(
      h,
      await h.vault.write.withdraw([good.handle, good.proof, nonce], {
        account: provider.account,
      }),
    );

    let available = await h.vault.read.confidentialAvailableOf([provider.account.address]);
    assert.equal(await client.decrypt(available, SUITE_POLL), VAULT_DEPOSIT - withdrawal);

    // Now ask for more than is there. This MUST NOT revert: a revert would tell an observer that
    // this provider's balance was below this amount, which is precisely the private fact.
    const tooMuch = await client.encrypt(10n ** 18n, "euint256", h.vault.address);
    nonce = await h.vault.read.nextNonce([provider.account.address]);
    const receipt = await mine(
      h,
      await h.vault.write.withdraw([tooMuch.handle, tooMuch.proof, nonce], {
        account: provider.account,
      }),
    );
    assert.equal(receipt.status, "success", "an over-withdrawal must still succeed publicly");

    available = await h.vault.read.confidentialAvailableOf([provider.account.address]);
    assert.equal(
      await client.decrypt(available, SUITE_POLL),
      VAULT_DEPOSIT - withdrawal,
      "an over-withdrawal must leave the balance untouched",
    );

    console.log("  withdrawal succeeded, balance decreased by exactly the requested amount");
    console.log("  over-withdrawal                   : succeeded publicly, moved encrypted zero");
  });

  it("refuses a replayed input proof, and a reused nonce", async () => {
    const client = await clientFor(h, 1);
    const input = await client.encrypt(1_000n, "euint256", h.vault.address);
    const nonce = await h.vault.read.nextNonce([provider.account.address]);

    await mine(
      h,
      await h.vault.write.withdraw([input.handle, input.proof, nonce], {
        account: provider.account,
      }),
    );

    // NoxCompute itself has no nonce and no consumption marker, so this proof is still valid to it
    // for the rest of its hour. Kyrve is the only thing stopping the replay.
    const nextNonce = await h.vault.read.nextNonce([provider.account.address]);
    await assertRevertsWith(
      () =>
        h.vault.write.withdraw([input.handle, input.proof, nextNonce], {
          account: provider.account,
        }),
      "HandleAlreadyConsumed",
      "replayed input handle",
    );

    const fresh = await client.encrypt(1_000n, "euint256", h.vault.address);
    await assertRevertsWith(
      () =>
        h.vault.write.withdraw([fresh.handle, fresh.proof, nonce], { account: provider.account }),
      "WrongNonce",
      "reused nonce",
    );

    assert.equal(await h.vault.read.isHandleConsumed([input.handle]), true);
    console.log("  replayed handle : REJECTED (HandleAlreadyConsumed)");
    console.log("  reused nonce    : REJECTED (WrongNonce)");
  });
});
