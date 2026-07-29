/**
 * The local node must execute the SAME EVM the artifacts were compiled for.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE THIRD WAY THE LOCAL NODE DIFFERED FROM PRODUCTION
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Phase 3 recorded two: it allows unlimited contract size (R-10) and its clock outruns wall clock
 * (R-12). Phase 4 found a third, and this file is the check that finds it again.
 *
 * The Nox Hardhat plugin configures its node as `chainType: "op"`, whose latest EDR hardfork is
 * Isthmus. Kyrve's Foundry contracts and the vendored Midnight core compile at
 * `evm_version = "osaka"` — because Ethereum Sepolia is on Osaka and one artifact has to deploy to
 * both. Osaka adds CLZ (EIP-7939, opcode 0x1e), and solc emits it.
 *
 * On the OP node CLZ is INVALID. Nothing about that is visible early: contracts deploy, every
 * constructor runs, every view returns, a whole confidential epoch completes. Then one execution
 * path deep inside `Midnight.take` reaches it and the transaction dies with `invalid opcode` — no
 * revert reason, no selector, no named cause. That is how Phase 4 met it.
 *
 * `hardfork: "osaka"` on an L1 chain type fixes it, and this test is what keeps it fixed. It runs
 * early, before anything expensive, so a misconfigured node fails in seconds rather than twenty
 * minutes into a settlement suite. Recorded as delta S-1.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deployCurveHarness } from "./curve-helpers.js";
import { deployFoundry } from "./settlement-helpers.js";

/**
 * EIP-7825, introduced in Osaka: no single transaction may specify more than 2^24 gas, whatever the
 * block gas limit is. Measured here rather than cited, because this number decides whether Kyrve's
 * launch-scale epoch is executable at all — see delta S-2.
 */
const OSAKA_TRANSACTION_GAS_CAP = 16_777_216n;

describe("Phase 4: the local chain executes Osaka, like Sepolia", () => {
  it("S-1. CLZ is a real opcode here, not an invalid one", async () => {
    const h = await deployCurveHarness();
    const probe = await deployFoundry(h, "KyrveOsakaProbe", []);

    assert.equal(await probe.read.chainId(), 31337n, "the local chain id");

    // `clz(0)` is defined as 256, `clz(1)` as 255. A pre-Osaka EVM reverts here rather than
    // answering, so a wrong answer is not the failure mode — no answer is.
    assert.equal(await probe.read.clz([1n]), 255n);
    assert.equal(await probe.read.clz([0n]), 256n);
    assert.equal(await probe.read.clz([1n << 255n]), 0n);

    assert.equal(
      await probe.read.verifyOsaka(),
      true,
      "the node must execute Osaka, or `Midnight.take` dies with a bare `invalid opcode`",
    );
  });

  /**
   * S-2. The limit that decides whether the launch universe is executable at all.
   *
   * Osaka caps a single transaction at 2^24 gas regardless of the block gas limit, which on this
   * node is 60,000,000. Phase 3 sized its stage widths against a 24,000,000 "transaction gas
   * ceiling" measured on a pre-Osaka local node, and recorded a peak stage transaction of
   * 20,300,000 — both ABOVE this cap. So the 16 x 128 launch epoch cannot execute on Ethereum
   * Sepolia as currently configured. `pnpm verify:gas-cap` says so with the numbers.
   *
   * Measured, not cited, and asserted on both sides of the boundary: exactly the cap is accepted,
   * one gas more is refused.
   */
  it("S-2. a single transaction may not exceed 2^24 gas, whatever the block limit is", async () => {
    const h = await deployCurveHarness();
    const block = await h.publicClient.getBlock();
    assert.ok(
      block.gasLimit > OSAKA_TRANSACTION_GAS_CAP,
      "the block limit must exceed the transaction cap, or this proves nothing about the cap",
    );

    const accepted = await h.wallets[0].sendTransaction({
      to: h.wallets[1].account.address,
      value: 1n,
      gas: OSAKA_TRANSACTION_GAS_CAP,
      account: h.wallets[0].account,
    });
    const receipt = await h.publicClient.waitForTransactionReceipt({ hash: accepted });
    assert.equal(receipt.status, "success", "exactly the cap is accepted");

    let refused = "";
    try {
      await h.wallets[0].sendTransaction({
        to: h.wallets[1].account.address,
        value: 1n,
        gas: OSAKA_TRANSACTION_GAS_CAP + 1n,
        account: h.wallets[0].account,
      });
    } catch (error) {
      refused = (error as Error).message;
    }
    assert.ok(refused.length > 0, "one gas above the cap must be refused");
  });
});
