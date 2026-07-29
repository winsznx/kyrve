import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { describe, it, before } from "node:test";
import { nox } from "@iexec-nox/nox-hardhat-plugin";

/**
 * Controlled investigation of Day 0 finding V-24 / THREAT-MODEL T-1.
 *
 * WHY THIS EXISTS. Day 0 measured five "scenarios" and observed four distinct gas values with a
 * 2,974 spread, and concluded a possible gas side channel on confidential failure. That conclusion
 * was reached from an experiment that could not support it: three of the five scenarios —
 * `rate-ineligible`, `cap-constrained` and `market-disabled` — supply IDENTICAL inputs
 * (amount 1000, eligible 0). They are one case wearing three labels. Any difference between them
 * is by construction not predicate-driven, because there is no predicate difference to drive it.
 *
 * The question that actually matters for PRD invariant 1 is narrower and answerable:
 *
 *     Can an observer, from gas alone, distinguish a provider that CONTRIBUTED from one that was
 *     REJECTED — and if so, can they tell WHICH rejection reason applied?
 *
 * This file separates the three effects the original conflated:
 *
 *   A. position / warmth — repeat one identical input N times and measure the spread. Anything
 *      seen here is not a predicate leak; it is the noise floor.
 *   B. predicate — alternate eligible and ineligible at matched positions. If gas tracks the
 *      predicate rather than the position, the leak is real.
 *   C. reason — compare distinct rejection causes (flag-false versus zero-amount) against each
 *      other, which the original never did because it never varied them independently.
 *
 * Nothing here is mocked. Every figure is a real receipt from the local Nox stack.
 */

const OUT = "../../../evidence/phase1/gas-side-channel.json";

describe("Phase 1: gas side-channel investigation (V-24 / T-1)", () => {
  let connection: any;
  let publicClient: any;
  const report: Record<string, unknown> = {};

  before(async () => {
    // `nox.connect()` from the plugin, NOT `network.connect()` from Hardhat: the plugin's
    // connection is the one with NoxCompute etched and the gateway wired. Hardhat's own
    // connection produces a chain where every encrypted operation reverts.
    connection = await nox.connect();
    publicClient = await connection.viem.getPublicClient();
  });

  async function contribute(
    contract: any,
    slot: bigint,
    amount: bigint,
    eligible: bigint,
  ): Promise<{ gas: number; calldataBytes: number }> {
    const a = await nox.encryptInput(amount, "uint256", contract.address);
    const e = await nox.encryptInput(eligible, "uint16", contract.address);
    const hash = await contract.write.contribute([slot, a.handle, a.handleProof, e.handle, e.handleProof]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const tx = await publicClient.getTransaction({ hash });
    return { gas: Number(receipt.gasUsed), calldataBytes: (tx.input.length - 2) / 2 };
  }

  function stats(values: number[]) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min, max, spread: max - min, distinct: new Set(values).size, values };
  }

  /**
   * A. Noise floor. One identical input, repeated. Any spread here is position or warmth and
   *    cannot be predicate-driven, because the predicate never changes.
   */
  it("A: measures the noise floor across repeated IDENTICAL inputs", async () => {
    const c = await connection.viem.deployContract("NoxIndistinguishable");
    await publicClient.waitForTransactionReceipt({ hash: await c.write.seedTotal() });

    const gas: number[] = [];
    const calldata: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await contribute(c, BigInt(i), 1_000n, 0n);
      gas.push(r.gas);
      calldata.push(r.calldataBytes);
    }

    const s = stats(gas);
    console.log(`\n  A. identical input x6 : ${gas.join(", ")}`);
    console.log(`     spread ${s.spread} gas across ${s.distinct} distinct value(s)`);
    console.log(`     calldata bytes: ${[...new Set(calldata)].join(", ")}`);

    report["noiseFloor"] = { ...s, calldataBytes: [...new Set(calldata)] };
    assert.ok(gas.length === 6);
  });

  /**
   * B. The question that matters. Eligible and ineligible interleaved, so position cannot be
   *    confounded with predicate: if gas tracked position, the two groups would overlap.
   */
  it("B: separates predicate from position by interleaving", async () => {
    const c = await connection.viem.deployContract("NoxIndistinguishable");
    await publicClient.waitForTransactionReceipt({ hash: await c.write.seedTotal() });

    const eligible: number[] = [];
    const rejected: number[] = [];

    // Interleaved: E, R, E, R, E, R. Position advances for both groups equally.
    for (let i = 0; i < 6; i++) {
      const isEligible = i % 2 === 0;
      const r = await contribute(c, BigInt(i), 1_000n, isEligible ? 1n : 0n);
      (isEligible ? eligible : rejected).push(r.gas);
    }

    const e = stats(eligible);
    const r = stats(rejected);
    const separated = Math.min(...rejected) > Math.max(...eligible) || Math.min(...eligible) > Math.max(...rejected);

    console.log(`\n  B. eligible  : ${eligible.join(", ")}  (spread ${e.spread})`);
    console.log(`     rejected  : ${rejected.join(", ")}  (spread ${r.spread})`);
    console.log(`     groups fully separated by gas: ${separated}`);

    report["predicate"] = {
      eligible: e,
      rejected: r,
      fullySeparated: separated,
      gapBetweenGroups: separated ? Math.abs(Math.min(...rejected) - Math.max(...eligible)) : 0,
    };
  });

  /**
   * C. Reason distinguishability. Two genuinely DIFFERENT rejection causes, which the Day 0
   *    experiment never varied independently: the eligibility flag being false, versus the amount
   *    being zero. If these are identical, the reason does not leak even if the outcome does.
   */
  it("C: compares distinct rejection reasons against each other", async () => {
    const c = await connection.viem.deployContract("NoxIndistinguishable");
    await publicClient.waitForTransactionReceipt({ hash: await c.write.seedTotal() });

    const flagFalse: number[] = [];
    const zeroAmount: number[] = [];

    for (let i = 0; i < 6; i++) {
      const useFlag = i % 2 === 0;
      const r = useFlag
        ? await contribute(c, BigInt(i), 1_000n, 0n) // rejected by the eligibility flag
        : await contribute(c, BigInt(i), 0n, 1n); // rejected by having nothing to contribute
      (useFlag ? flagFalse : zeroAmount).push(r.gas);
    }

    const f = stats(flagFalse);
    const z = stats(zeroAmount);
    const reasonSeparated =
      Math.min(...flagFalse) > Math.max(...zeroAmount) || Math.min(...zeroAmount) > Math.max(...flagFalse);

    console.log(`\n  C. flag-false : ${flagFalse.join(", ")}  (spread ${f.spread})`);
    console.log(`     zero-amount: ${zeroAmount.join(", ")}  (spread ${z.spread})`);
    console.log(`     rejection REASON separable by gas: ${reasonSeparated}`);

    report["reason"] = { flagFalse: f, zeroAmount: z, reasonSeparable: reasonSeparated };
  });

  it("records the verdict", async () => {
    const noise = report["noiseFloor"] as { spread: number };
    const predicate = report["predicate"] as { fullySeparated: boolean; gapBetweenGroups: number };
    const reason = report["reason"] as { reasonSeparable: boolean };

    // The leak is real only if the predicate gap exceeds the noise floor. A gap smaller than the
    // spread seen on identical inputs cannot be attributed to the predicate.
    const outcomeLeaks = predicate.fullySeparated && predicate.gapBetweenGroups > noise.spread;

    const verdict = outcomeLeaks
      ? reason.reasonSeparable
        ? "OUTCOME AND REASON BOTH LEAK"
        : "OUTCOME LEAKS, REASON DOES NOT"
      : "NO LEAK ABOVE THE NOISE FLOOR";

    report["verdict"] = verdict;
    report["noiseFloorSpread"] = noise.spread;
    report["predicateGap"] = predicate.gapBetweenGroups;
    report["$comment"] =
      "Controlled investigation of Day 0 V-24 / T-1. Day 0's five scenarios included three with " +
      "identical inputs, so its four distinct gas values could not distinguish predicate effects " +
      "from position effects. This separates them.";

    console.log("\n  === VERDICT ===");
    console.log(`  noise floor (identical inputs) : ${noise.spread} gas`);
    console.log(`  predicate gap (eligible vs not): ${predicate.gapBetweenGroups} gas`);
    console.log(`  rejection reason separable     : ${reason.reasonSeparable}`);
    console.log(`  verdict                        : ${verdict}`);

    writeFileSync(new URL(OUT, import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  });
});
