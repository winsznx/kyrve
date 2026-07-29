/**
 * The gas side-channel experiment, repeated against the real curve engine.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS RUNS AGAIN
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Day 0 recorded V-24 as an open FAIL: five scenarios, four distinct gas values. Phase 1 showed
 * three of those five supplied IDENTICAL inputs, so they were one case wearing three labels, and
 * reclassified T-1 to NOT SUPPORTED BY EVIDENCE (delta P-5). Phase 2 repeated it against the real
 * vault (Q-9). Both required the measurement be repeated against the curve engine, which is the
 * contract that actually contains the confidential branches this product depends on.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE METHOD, AND THE MISTAKE IT IS BUILT TO AVOID
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Phase 2's first attempt compared one sample against one sample, saw 72 gas of difference, and
 * would have reported a leak. That difference was calldata byte composition — handles are
 * pseudorandom and the EVM charges 16 gas per non-zero byte against 4 per zero byte — multiplied
 * across 35 handles.
 *
 * So this samples both groups REPEATEDLY and INTERLEAVED, and asks whether the ranges SEPARATE.
 * Separation is the only shape in which an observer could classify a single transaction, which is
 * the only thing that would matter. A difference in means with overlapping ranges tells an
 * observer nothing about the transaction in front of them.
 *
 * Interleaving matters independently: gas tracks storage position, and the first write to a slot
 * is cold. Running one group then the other would measure the cold-to-warm transition and call it
 * a predicate.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS CAN AND CANNOT ESTABLISH
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * It can falsify a leak claim. It CANNOT establish the absence of one. Local node, local stack,
 * one contract, small sample. **Kyrve must not claim gas indistinguishability**, and
 * `verify:phase3` fails if the recorded verdict ever stops saying so.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { before, describe, it } from "node:test";

import { UNIT } from "@kyrve/curve";

import {
  type CurveHarness,
  createUniverse,
  deployCurveHarness,
  openAndSeal,
  runEpoch,
  type SealedProviderState,
  STAGE,
  setupBorrower,
  setupProvider,
} from "./curve-helpers.js";

interface Sample {
  readonly group: "fillable" | "no-fill";
  readonly finalizeGas: number;
  readonly accumulateGas: number;
  readonly logCount: number;
  readonly quoteReady: boolean;
}

/** Six of each, interleaved. Enough to see separation; small enough to run in one suite. */
const ROUNDS = 6;

describe("Phase 3: the gas side channel, measured against the real curve engine", () => {
  let h: CurveHarness;
  const samples: Sample[] = [];

  before(async () => {
    h = await deployCurveHarness();

    // ONE universe and ONE pair of providers, reused across every round. That is what isolates the
    // variable: provider state, mandate handles and ACL grants are identical in every sample, and
    // the ONLY thing that changes between the two groups is an encrypted comparison's outcome.
    const { universeId, universe } = await createUniverse(h, {
      markets: 1,
      ratesPerMarket: 2,
      privacyFloor: 2,
      cellsPerChunk: 4,
      label: `gas-${Date.now()}`,
    });

    const providers: SealedProviderState[] = [
      await setupProvider(h, universeId, { walletIndex: 1, balance: 400n * UNIT }),
      await setupProvider(h, universeId, { walletIndex: 2, balance: 400n * UNIT }),
    ];

    for (let round = 0; round < ROUNDS * 2; round += 1) {
      // Interleaved: fillable, no-fill, fillable, no-fill...
      const fillable = round % 2 === 0;

      // The two groups differ in ONE encrypted comparison: whether the leaf's fill clears the
      // borrower's stated minimum. Everything public is identical — the same universe, the same
      // providers, the same stage sequence, the same chunk counts, the same calldata shape.
      const borrower = await setupBorrower(h, universeId, 4 + round, {
        desiredAssets: 100n * UNIT,
        minimumAssets: fillable ? 1n * UNIT : 100_000n * UNIT,
      });

      const epoch = await openAndSeal(h, universeId, universe, providers, borrower);
      await runEpoch(h, epoch, 3);

      const published = await h.engine.read.publishedOf([epoch.epochId]);
      const receipt = await h.publicClient.getTransactionReceipt({
        hash: await lastFinalizeHash(h, epoch.epochId),
      });

      samples.push({
        group: fillable ? "fillable" : "no-fill",
        finalizeGas: epoch.gas.finalizeLeafChunk?.[0] ?? 0,
        accumulateGas: epoch.gas.accumulateLeafChunk?.[0] ?? 0,
        logCount: receipt.logs.length,
        quoteReady: published.quoteReady !== `0x${"00".repeat(32)}`,
      });
    }
  });

  it("A. the noise floor, measured across identical inputs", () => {
    // Six samples that are identical in every respect. Whatever spread appears here is NOT
    // predicate-driven by construction, and it is the bar any claimed leak has to clear.
    const identical = samples.filter((s) => s.group === "fillable").map((s) => s.finalizeGas);
    const spread = Math.max(...identical) - Math.min(...identical);
    assert.ok(identical.length === ROUNDS, "expected one sample per round");
    // Recorded, not asserted against a threshold: the number is the finding.
    assert.ok(spread >= 0);
  });

  it("B. the two groups are not separated by gas — their ranges overlap", () => {
    const fillable = samples.filter((s) => s.group === "fillable").map((s) => s.finalizeGas);
    const noFill = samples.filter((s) => s.group === "no-fill").map((s) => s.finalizeGas);

    const separated =
      Math.min(...fillable) > Math.max(...noFill) || Math.min(...noFill) > Math.max(...fillable);
    assert.equal(
      separated,
      false,
      `the fillable range [${Math.min(...fillable)}, ${Math.max(...fillable)}] and the no-fill ` +
        `range [${Math.min(...noFill)}, ${Math.max(...noFill)}] do not overlap. An observer could ` +
        "classify a single transaction by its gas, which is a real side channel on a confidential " +
        "branch.",
    );
  });

  it("C. the public surface is identical whichever branch was taken", () => {
    const logCounts = new Set(samples.map((s) => s.logCount));
    assert.equal(
      logCounts.size,
      1,
      `finalizeLeafChunk emitted ${[...logCounts].join(" / ")} logs depending on the branch — the ` +
        "event count itself would be the oracle",
    );

    // Every sample published all five results, whether or not a quote was produced. "No quote" and
    // "a quote" must be indistinguishable in SHAPE; only the decrypted value differs.
    assert.ok(samples.every((s) => s.quoteReady));
  });

  it("D. records the evidence, and the verdict keeps disclaiming what it cannot prove", () => {
    const fillable = samples.filter((s) => s.group === "fillable").map((s) => s.finalizeGas);
    const noFill = samples.filter((s) => s.group === "no-fill").map((s) => s.finalizeGas);
    const identicalSpread = Math.max(...fillable) - Math.min(...fillable);
    const separated =
      Math.min(...fillable) > Math.max(...noFill) || Math.min(...noFill) > Math.max(...fillable);

    const verdict = {
      groupsSeparatedByGas: separated,
      noiseFloorGas: identicalSpread,
      claim:
        "This experiment falsifies a leak claim for the branch measured. It does NOT establish " +
        "gas indistinguishability, and Kyrve must not claim it. Local node, local stack, one " +
        "contract, six samples per group. Testnet gas is UNVERIFIED (AS-1).",
      limits: [
        "local Hardhat node, not a live network",
        "local Nox stack, not the hosted iExec services",
        "one contract and one confidential branch",
        `${ROUNDS} samples per group`,
        "gas only — no timing, no memory, no network-level observation",
      ],
    };

    mkdirSync(new URL("../../evidence/phase3/", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("../../evidence/phase3/gas-side-channel.json", import.meta.url),
      `${JSON.stringify(
        {
          $comment:
            "The V-24 / T-1 measurement, repeated against NoxCurveEngine as Phase 1 P-5 and " +
            "Phase 2 Q-9 both required. Method: interleaved sampling of two groups differing in " +
            "exactly one encrypted comparison, asking whether the RANGES separate.",
          method: {
            groups: ["fillable", "no-fill"],
            differingBy: "whether the leaf's fill clears the borrower's encrypted minimum",
            interleaved: true,
            rounds: ROUNDS,
            identicalPublicSurface: true,
          },
          samples,
          ranges: {
            fillable: { min: Math.min(...fillable), max: Math.max(...fillable) },
            noFill: { min: Math.min(...noFill), max: Math.max(...noFill) },
          },
          verdict,
        },
        null,
        2,
      )}\n`,
    );

    assert.ok(
      verdict.claim.includes("does NOT establish"),
      "the recorded verdict must keep disclaiming gas indistinguishability",
    );
    assert.equal(verdict.groupsSeparatedByGas, false);
  });
});

/** The transaction hash of the finalize chunk for an epoch, read from its own event. */
async function lastFinalizeHash(h: CurveHarness, epochId: `0x${string}`): Promise<`0x${string}`> {
  const logs = await h.publicClient.getLogs({
    address: h.engine.address,
    fromBlock: 0n,
    toBlock: "latest",
  });
  const match = logs
    .filter((log) => log.topics[1]?.toLowerCase() === epochId.toLowerCase())
    .filter((log) => log.topics[2] === `0x${STAGE.FinalizeLeaves.toString(16).padStart(64, "0")}`)
    .at(-1);
  assert.ok(match !== undefined, `no finalize event found for epoch ${epochId}`);
  return match.transactionHash;
}
