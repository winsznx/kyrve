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
});
