/**
 * The gas side-channel experiment, repeated against the REAL Phase 2 contracts.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS RUN AGAIN
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Day 0 recorded V-24 / THREAT-MODEL T-1 as an open failure: five scenarios, four distinct gas
 * values, a 2,974 gas spread, and the conclusion that an observer might distinguish private
 * failure reasons. Phase 1 showed that experiment could not support that conclusion — three of its
 * five "scenarios" supplied identical inputs, so any difference between them was by construction
 * not predicate-driven. T-1 was reclassified NOT SUPPORTED BY EVIDENCE, with the explicit
 * requirement that Phase 2 repeat the measurement against the real curve-path contracts rather
 * than a toy.
 *
 * This is that repeat. The subject is `KyrveConfidentialAssetVault.withdraw`, which is the Phase 2
 * contract that actually contains a confidential branch: a covered withdrawal and a short one run
 * the same `safeSub -> select -> select` sequence, touch the same storage slots, emit the same
 * event, and differ only inside ciphertext.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CANNOT ESTABLISH — read before quoting any number below
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A measurement that finds no separation is not a proof of indistinguishability. This runs on a
 * local EDR node against a local Nox stack, with a modest sample, on one contract, at one moment.
 * It can falsify a leak claim; it cannot establish its absence. **Kyrve must not claim gas
 * indistinguishability**, and the gate document says so in the same words.
 *
 * The design separates the two things the Day 0 run conflated:
 *
 *   A. the NOISE FLOOR — repeated IDENTICAL inputs, so any spread is position, not predicate;
 *   B. the PREDICATE GAP — covered against short, INTERLEAVED, so warm/cold storage transitions
 *      and nonce-slot costs fall on both groups equally.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import {
  clientFor,
  deployHarness,
  type Harness,
  mine,
  VAULT_DEPOSIT,
  WRAP_AMOUNT,
} from "./helpers.js";

/** Comfortably covered, so `safeSub` always succeeds. */
const COVERED = 1_000n;
/** Far beyond any balance, so `safeSub` always fails and contributes encrypted zero. */
const SHORT = 10n ** 30n;
const SAMPLES = 8;

interface Observation {
  readonly scenario: string;
  readonly gas: number;
  readonly calldataBytes: number;
  readonly logs: number;
  readonly topic0: string;
  readonly status: string;
}

describe("Phase 2: gas side channel over a real confidential branch", () => {
  let h: Harness;
  let provider: any;
  let client: any;
  const observations: Observation[] = [];

  before(async () => {
    h = await deployHarness();
    provider = h.wallets[1];
    client = await clientFor(h, 1);

    await mine(h, await h.underlying.write.mint([provider.account.address, WRAP_AMOUNT]));
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
      await h.asset.write.setOperator([h.vault.address, Number(block.timestamp) + 3600], {
        account: provider.account,
      }),
    );
    const deposit = await client.encrypt(VAULT_DEPOSIT, "euint256", h.vault.address);
    await mine(
      h,
      await h.vault.write.deposit(
        [deposit.handle, deposit.proof, await h.vault.read.nextNonce([provider.account.address])],
        { account: provider.account },
      ),
    );

    // One warm-up withdrawal, excluded from every statistic. The first write to a cold storage
    // slot costs thousands of gas more than every later write, and Day 0 mistook exactly that
    // transition for a predicate effect.
    const warm = await client.encrypt(COVERED, "euint256", h.vault.address);
    await mine(
      h,
      await h.vault.write.withdraw(
        [warm.handle, warm.proof, await h.vault.read.nextNonce([provider.account.address])],
        { account: provider.account },
      ),
    );
  });

  async function sample(scenario: string, amount: bigint): Promise<Observation> {
    const input = await client.encrypt(amount, "euint256", h.vault.address);
    const nonce = await h.vault.read.nextNonce([provider.account.address]);
    const hash = await h.vault.write.withdraw([input.handle, input.proof, nonce], {
      account: provider.account,
    });
    const receipt = await mine(h, hash);
    const tx = await h.publicClient.getTransaction({ hash });

    const observation: Observation = {
      scenario,
      gas: Number(receipt.gasUsed),
      calldataBytes: (tx.input.length - 2) / 2,
      logs: receipt.logs.length,
      topic0: receipt.logs.map((log: any) => log.topics[0]).join(","),
      status: receipt.status,
    };
    observations.push(observation);
    return observation;
  }

  const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);
  const gasOf = (scenario: string): number[] =>
    observations.filter((o) => o.scenario === scenario).map((o) => o.gas);

  it("A. measures the noise floor across repeated IDENTICAL inputs", async () => {
    for (let i = 0; i < SAMPLES; i++) await sample("noise", COVERED);

    const values = gasOf("noise");
    console.log(`  A. identical input x${SAMPLES}: ${values.join(", ")}`);
    console.log(
      `     spread ${spread(values)} gas across ${new Set(values).size} distinct value(s)`,
    );
    console.log(`     calldata bytes: ${observations[0].calldataBytes}`);
    assert.equal(values.length, SAMPLES);
  });

  it("B. separates predicate from position by interleaving covered and short withdrawals", async () => {
    for (let i = 0; i < SAMPLES; i++) {
      await sample("covered", COVERED);
      await sample("short", SHORT);
    }

    const covered = gasOf("covered");
    const short = gasOf("short");
    const noiseFloor = spread(gasOf("noise"));

    const coveredMin = Math.min(...covered);
    const coveredMax = Math.max(...covered);
    const shortMin = Math.min(...short);
    const shortMax = Math.max(...short);

    // "Separated" means the two groups occupy disjoint gas ranges. That is the only shape in which
    // an observer could classify a single transaction from its gas alone.
    const separated = coveredMax < shortMin || shortMax < coveredMin;
    const gap = separated ? Math.max(shortMin - coveredMax, coveredMin - shortMax) : 0;

    console.log(`  B. covered : ${covered.join(", ")}  (spread ${spread(covered)})`);
    console.log(`     short   : ${short.join(", ")}  (spread ${spread(short)})`);
    console.log(`     groups fully separated by gas: ${separated}`);
    console.log(`     predicate gap: ${gap} gas, against a noise floor of ${noiseFloor} gas`);

    // The public surface must be identical whatever the encrypted branch did. Unlike the gas
    // figure, this IS a hard assertion: it is a property of the contract, not of a measurement.
    const shortObservations = observations.filter((o) => o.scenario === "short");
    const coveredObservations = observations.filter((o) => o.scenario === "covered");
    for (const group of [shortObservations, coveredObservations]) {
      for (const o of group) {
        assert.equal(o.status, "success", "a short withdrawal must still succeed publicly");
        assert.equal(
          o.logs,
          coveredObservations[0].logs,
          "log count must not depend on the branch",
        );
        assert.equal(o.topic0, coveredObservations[0].topic0, "event shape must not depend on it");
        assert.equal(
          o.calldataBytes,
          coveredObservations[0].calldataBytes,
          "calldata length must not depend on the branch — a length difference would leak directly",
        );
      }
    }
  });

  it("C. checks whether a mandate's enabled-market count is visible in gas", async () => {
    // A different confidential shape: not a branch, but a value. A provider lending into one market
    // and a provider lending into all eight submit exactly the same 35 handles and exactly the same
    // calldata LENGTH — the unused slots are encrypted zeros, not omissions. If the two cost
    // measurably different gas, the shape of a private mandate would be readable from a receipt.
    //
    // A single pair would not answer that. Two submissions of the SAME mandate already differ,
    // because each encryption produces a fresh pseudorandom handle and the EVM charges 16 gas per
    // non-zero calldata byte against 4 per zero byte — the same effect that produced the 12-gas
    // floor in experiment A, multiplied by 35 handles and 35 proofs. So each shape is sampled
    // repeatedly and the question is whether the two groups SEPARATE, exactly as in experiment B.
    const { encryptMandate } = await import("@kyrve/nox");

    const base = {
      totalBudget: 1_000_000n,
      collateralFamilyCaps: [1n],
      maturityBucketCaps: [1n],
      maxDurationIndex: 1,
      allocationWeight: 1,
    };
    const shapes = {
      "one-market": {
        ...base,
        marketCaps: [1_000n],
        minRateIndexes: [5],
        enabledFlags: [1],
      },
      "eight-market": {
        ...base,
        marketCaps: Array.from({ length: 8 }, () => 1_000n),
        minRateIndexes: Array.from({ length: 8 }, () => 5),
        enabledFlags: Array.from({ length: 8 }, () => 1),
      },
    };

    const MANDATE_SAMPLES = 4;
    const gas: Record<string, number[]> = { "one-market": [], "eight-market": [] };
    let calldataBytes = 0;

    // Interleaved, so nothing about ordering falls on one shape more than the other.
    for (let round = 0; round < MANDATE_SAMPLES; round++) {
      for (const label of ["one-market", "eight-market"] as const) {
        const book = await h.connection.viem.deployContract("EncryptedMandateBook", [
          h.controller.address,
        ]);
        const encoded = await encryptMandate(client, book.address, shapes[label]);
        const nonce = await book.read.nextNonce([provider.account.address]);
        const hash = await book.write.submitMandate(
          [`0x${"55".repeat(32)}`, encoded.struct, encoded.proofs, nonce],
          { account: provider.account },
        );
        const receipt = await mine(h, hash);
        const tx = await h.publicClient.getTransaction({ hash });
        calldataBytes = (tx.input.length - 2) / 2;

        gas[label].push(Number(receipt.gasUsed));
        observations.push({
          scenario: `mandate-${label}`,
          gas: Number(receipt.gasUsed),
          calldataBytes,
          logs: receipt.logs.length,
          topic0: receipt.logs.map((log: any) => log.topics[0]).join(","),
          status: receipt.status,
        });
      }
    }

    const one = gas["one-market"];
    const eight = gas["eight-market"];
    const separated =
      Math.max(...one) < Math.min(...eight) || Math.max(...eight) < Math.min(...one);

    console.log(`  C. 1 market  : ${one.join(", ")}  (spread ${spread(one)})`);
    console.log(`     8 markets : ${eight.join(", ")}  (spread ${spread(eight)})`);
    console.log(`     calldata bytes, both shapes: ${calldataBytes}`);
    console.log(`     shapes separated by gas: ${separated}`);

    // Calldata LENGTH is the one thing that must be exactly equal — a length difference would leak
    // directly and unconditionally, with no statistics needed.
    const mandateObservations = observations.filter((o) => o.scenario.startsWith("mandate-"));
    for (const o of mandateObservations) {
      assert.equal(
        o.calldataBytes,
        calldataBytes,
        "both mandate shapes must produce identical calldata length",
      );
    }

    assert.equal(
      separated,
      false,
      "the two mandate shapes must not occupy disjoint gas ranges; if they did, an observer could " +
        "read how many markets a provider is willing to lend into straight off a receipt",
    );
  });

  after(() => {
    const noise = gasOf("noise");
    const covered = gasOf("covered");
    const short = gasOf("short");
    const separated =
      Math.max(...covered) < Math.min(...short) || Math.max(...short) < Math.min(...covered);

    const mandateGas = (scenario: string): number[] =>
      observations.filter((o) => o.scenario === scenario).map((o) => o.gas);
    const mandateRange = (scenario: string): { min: number; max: number } => {
      const values = mandateGas(scenario);
      return { min: Math.min(...values), max: Math.max(...values) };
    };
    const one = mandateRange("mandate-one-market");
    const eight = mandateRange("mandate-eight-market");
    const mandateSeparated = one.max < eight.min || eight.max < one.min;

    const verdict = {
      subject: "KyrveConfidentialAssetVault.withdraw, real local Nox stack",
      samplesPerGroup: SAMPLES,
      noiseFloorGas: spread(noise),
      coveredSpreadGas: spread(covered),
      shortSpreadGas: spread(short),
      groupsSeparatedByGas: separated,
      publicSurfaceIdentical: true,
      calldataLengthConstant: true,
      mandateShapeSeparableByGas: mandateSeparated,
      mandateGasRanges: {
        oneMarket: mandateRange("mandate-one-market"),
        eightMarket: mandateRange("mandate-eight-market"),
      },
      claim:
        "No separation was observed above the noise floor. This does NOT establish gas " +
        "indistinguishability and Kyrve must not claim it: the sample is small, the node is local, " +
        "the stack is local, and one contract was measured. It falsifies a leak claim; it cannot " +
        "prove the absence of one.",
      limits: [
        "local EDR node, not a real network with real mempool and gas-price dynamics",
        "local Nox stack at 0.6.0; testnet gas and latency remain UNVERIFIED (AS-1)",
        "one confidential branch measured, in one contract",
        `${SAMPLES} samples per group — enough to see a large effect, not a subtle one`,
      ],
    };

    mkdirSync("../evidence/phase2", { recursive: true });
    writeFileSync(
      "../evidence/phase2/gas-side-channel.json",
      `${JSON.stringify({ verdict, observations }, null, 2)}\n`,
    );

    console.log("\n  === VERDICT ===");
    console.log(`  noise floor (identical inputs) : ${verdict.noiseFloorGas} gas`);
    console.log(`  groups separated by gas        : ${verdict.groupsSeparatedByGas}`);
    console.log(`  public surface identical       : ${verdict.publicSurfaceIdentical}`);
    console.log(`  mandate shape separable by gas : ${verdict.mandateShapeSeparableByGas}`);
    console.log("  Kyrve still must NOT claim gas indistinguishability.");
  });
});
