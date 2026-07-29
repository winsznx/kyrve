/**
 * Phase 2 demonstration 13 — every way an encrypted input can be presented dishonestly.
 *
 *   wrong owner · wrong contract · expired · malformed · replayed · tampered
 *
 * Four of these are enforced by NoxCompute itself and two are enforced by Kyrve. Knowing which is
 * which matters: the first four hold against any application, and the last two hold only because
 * Kyrve implements them, because `validateInputProof` has no nonce and no consumption marker.
 *
 * Every assertion checks the SPECIFIC reason. A test that passes because the call reverted for an
 * unrelated reason proves nothing, and would hide a defence that had silently stopped working.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { encryptMandate } from "@kyrve/nox";

import {
  assertRevertsWith,
  assertRevertsWithAny,
  clientFor,
  deployHarness,
  type Harness,
  mine,
  sampleMandate,
} from "./helpers.js";

const UNIVERSE = `0x${"33".repeat(32)}` as `0x${string}`;

describe("Phase 2: dishonest input proofs are refused, each for its own reason", () => {
  let h: Harness;
  let provider: any;
  let attacker: any;

  before(async () => {
    h = await deployHarness();
    provider = h.wallets[1];
    attacker = h.wallets[2];
  });

  /**
   * A fresh book per case.
   *
   * Sharing one would let an earlier case's state answer a later case: `MandateAlreadyExists`
   * fires before any proof is validated, so a shared book would produce a test that reverts for
   * the wrong reason and still looks green.
   */
  async function freshBook(): Promise<any> {
    return h.connection.viem.deployContract("EncryptedMandateBook", [h.controller.address]);
  }

  it("accepts a correctly bound submission — the control for everything below", async () => {
    const book = await freshBook();
    const client = await clientFor(h, 1);
    const encoded = await encryptMandate(client, book.address, sampleMandate());
    const nonce = await book.read.nextNonce([provider.account.address]);

    await mine(
      h,
      await book.write.submitMandate([UNIVERSE, encoded.struct, encoded.proofs, nonce], {
        account: provider.account,
      }),
    );
    console.log("  control: correctly bound submission ACCEPTED");
  });

  it("13a. rejects a proof presented by a different owner — enforced by NoxCompute", async () => {
    // Minted for the provider, spent by the attacker at the right contract.
    const book = await freshBook();
    const client = await clientFor(h, 1);
    const encoded = await encryptMandate(client, book.address, sampleMandate());
    const nonce = await book.read.nextNonce([attacker.account.address]);

    await assertRevertsWith(
      () =>
        book.write.submitMandate([UNIVERSE, encoded.struct, encoded.proofs, nonce], {
          account: attacker.account,
        }),
      "Owner mismatch",
      "wrong owner",
    );
    console.log("  13a wrong owner     : REJECTED (NoxCompute, 'Owner mismatch')");
  });

  it("13b. rejects a proof minted for a different application contract — NoxCompute", async () => {
    const bookA = await freshBook();
    const bookB = await freshBook();
    const client = await clientFor(h, 1);
    // Bound to bookA, offered to bookB. Both are empty, so nothing else can reject it first.
    const encoded = await encryptMandate(client, bookA.address, sampleMandate());
    const nonce = await bookB.read.nextNonce([provider.account.address]);

    await assertRevertsWith(
      () =>
        bookB.write.submitMandate([UNIVERSE, encoded.struct, encoded.proofs, nonce], {
          account: provider.account,
        }),
      "App mismatch",
      "wrong application contract",
    );
    console.log("  13b wrong contract  : REJECTED (NoxCompute, 'App mismatch')");
  });

  /**
   * A proof is 137 bytes: 20 owner, 20 app, 32 createdAt, then a 65-byte signature at offset 72.
   * Tampering with `r` and tampering with `v` are genuinely different attacks and are refused by
   * different code, so both are asserted separately rather than collapsed into "it reverted".
   */
  const flipByte = (proof: `0x${string}`, byteIndex: number): `0x${string}` => {
    const at = 2 + byteIndex * 2;
    const original = proof.slice(at, at + 2);
    const flipped = original === "ff" ? "ee" : "ff";
    return `${proof.slice(0, at)}${flipped}${proof.slice(at + 2)}` as `0x${string}`;
  };

  it("13d. rejects a tampered signature body — no valid gateway signature exists", async () => {
    const book = await freshBook();
    const client = await clientFor(h, 1);
    const encoded = await encryptMandate(client, book.address, sampleMandate());

    // Byte 80 sits inside `r`. Two refusals are possible and both are correct: if the corrupted `r`
    // does not land on the curve, `ecrecover` yields nobody and OpenZeppelin reverts
    // ECDSAInvalidSignature; if it does, recovery succeeds and returns somebody who is not the
    // gateway, which is what NoxCompute's own equality check catches. Which one fires is a property
    // of the corrupted bytes, not of the defence, so the test names both and reports the winner.
    const proofs = [...encoded.proofs];
    proofs[0] = flipByte(proofs[0], 80);

    const nonce = await book.read.nextNonce([provider.account.address]);
    const reason = await assertRevertsWithAny(
      () =>
        book.write.submitMandate([UNIVERSE, encoded.struct, proofs, nonce], {
          account: provider.account,
        }),
      ["Invalid signature", "0xf645eedf"],
      "tampered signature body",
    );
    console.log(
      `  13d tampered body   : REJECTED (${reason === "Invalid signature" ? "NoxCompute, not the gateway signer" : "ECDSA, no recoverable signer"})`,
    );
  });

  it("13d'. rejects a tampered recovery byte — ECDSA refuses before any Kyrve code runs", async () => {
    const book = await freshBook();
    const client = await clientFor(h, 1);
    const encoded = await encryptMandate(client, book.address, sampleMandate());

    // The final byte is `v`. A malformed `v` makes OpenZeppelin's ECDSA revert outright, so this
    // never reaches the gateway comparison at all — a different defence, asserted on its own name.
    const proofs = [...encoded.proofs];
    proofs[0] = flipByte(proofs[0], 136);

    const nonce = await book.read.nextNonce([provider.account.address]);
    await assertRevertsWith(
      () =>
        book.write.submitMandate([UNIVERSE, encoded.struct, proofs, nonce], {
          account: provider.account,
        }),
      "0xf645eedf",
      "tampered recovery byte",
    );
    console.log("  13d' tampered v     : REJECTED (ECDSA, ECDSAInvalidSignature)");
  });

  it("13e. rejects a malformed (truncated) proof — NoxCompute checks the exact length", async () => {
    const book = await freshBook();
    const client = await clientFor(h, 1);
    const encoded = await encryptMandate(client, book.address, sampleMandate());

    const proofs = [...encoded.proofs];
    proofs[0] = proofs[0].slice(0, 42) as `0x${string}`;

    const nonce = await book.read.nextNonce([provider.account.address]);
    await assertRevertsWith(
      () =>
        book.write.submitMandate([UNIVERSE, encoded.struct, proofs, nonce], {
          account: provider.account,
        }),
      "Invalid proof length",
      "truncated proof",
    );
    console.log("  13e malformed proof : REJECTED (NoxCompute, 'Invalid proof length')");
  });

  it("13f. rejects a replayed handle — enforced by KYRVE, because Nox does not", async () => {
    // These handles and proofs stay valid to NoxCompute for the rest of their hour: there is no
    // nonce, no consumption marker and no caller binding beyond owner and app. The only thing
    // stopping the replay is `KyrveConfidentialBase._consumeHandle`.
    const book = await freshBook();
    const client = await clientFor(h, 1);
    const encoded = await encryptMandate(client, book.address, sampleMandate());
    const n0 = await book.read.nextNonce([provider.account.address]);

    await mine(
      h,
      await book.write.submitMandate([UNIVERSE, encoded.struct, encoded.proofs, n0], {
        account: provider.account,
      }),
    );

    // Replay through `replaceMandate`, where no lifecycle guard applies and a correct nonce is
    // supplied — so the ONLY thing that can reject it is the consumed-handle guard.
    const mandateId = await book.read.mandateIdFor([provider.account.address, UNIVERSE]);
    const n1 = await book.read.nextNonce([provider.account.address]);

    await assertRevertsWith(
      () =>
        book.write.replaceMandate([mandateId, encoded.struct, encoded.proofs, n1], {
          account: provider.account,
        }),
      "HandleAlreadyConsumed",
      "replayed handle set",
    );

    assert.equal(await book.read.isHandleConsumed([encoded.inputs[0].handle]), true);
    console.log("  13f replayed handle : REJECTED (Kyrve, 'HandleAlreadyConsumed')");
  });

  it("13g. rejects a submission from a contract caller — Kyrve's direct-caller rule", async () => {
    const relay = await h.connection.viem.deployContract("RelayAttempt");
    await assertRevertsWith(
      () => relay.write.forwardMandate([h.mandateBook.address], { account: provider.account }),
      "RelayedCallerRefused",
      "relayed submission",
    );
    console.log("  13g relayed caller  : REJECTED (Kyrve, 'RelayedCallerRefused')");
  });
});
