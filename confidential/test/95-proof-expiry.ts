/**
 * Phase 2 demonstration 13c — an expired input proof is refused.
 *
 * WHY THIS TEST LIVES ALONE, IN THE FILE THAT SORTS LAST.
 *
 * Proving expiry means moving the chain past `createdAt + proofExpirationDuration`, and
 * `evm_increaseTime` is CUMULATIVE AND PERMANENT for the rest of the node's life. Every proof
 * minted afterwards carries a real wall-clock `createdAt` while `block.timestamp` sits an hour in
 * the future, so NoxCompute rejects all of them as expired — including proofs in completely
 * unrelated suites.
 *
 * That is exactly what happened when this case sat among its siblings: it passed, and then quietly
 * broke every suite that ran after it. Reverting a snapshot instead would rewind blocks the Nox
 * ingestor has already consumed, which is a different kind of unreliability. Isolating the time
 * jump at the end of the run is the honest answer, and this comment is why nobody should move it.
 */

import { describe, it } from "node:test";

import { encryptMandate } from "@kyrve/nox";

import {
  assertRevertsWith,
  clientFor,
  deployHarness,
  type Harness,
  sampleMandate,
} from "./helpers.js";

const UNIVERSE = `0x${"77".repeat(32)}` as `0x${string}`;

describe("Phase 2: an expired input proof is refused (runs last — it moves chain time)", () => {
  it("13c. rejects an expired proof — NoxCompute, at 3600 seconds", async () => {
    const h: Harness = await deployHarness();
    const provider = h.wallets[1];
    const book = await h.connection.viem.deployContract("EncryptedMandateBook", [
      h.controller.address,
    ]);
    const client = await clientFor(h, 1);
    const encoded = await encryptMandate(client, book.address, sampleMandate());

    // The proof binds `createdAt` and NoxCompute checks `createdAt + proofExpirationDuration`.
    // Advancing the chain past that window is the only way to test it honestly.
    await h.publicClient.request({ method: "evm_increaseTime" as any, params: [3601] as any });
    await h.publicClient.request({ method: "evm_mine" as any, params: [] as any });

    const nonce = await book.read.nextNonce([provider.account.address]);
    await assertRevertsWith(
      () =>
        book.write.submitMandate([UNIVERSE, encoded.struct, encoded.proofs, nonce], {
          account: provider.account,
        }),
      "Proof expired",
      "expired proof",
    );
    console.log("  13c expired proof   : REJECTED (NoxCompute, 'Proof expired')");
  });
});
