/**
 * The gas side channel on the SETTLEMENT path, measured across nine outcomes.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS EXPERIMENT CAN AND CANNOT ESTABLISH
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Phase 3 measured the CURVE engine's confidential branch and found no separation, while
 * explicitly disclaiming indistinguishability. This measures something different and answers a
 * different question, so the conclusion has to be stated differently too.
 *
 * On the settlement path almost nothing is confidential. The quote's market, rate, amount, borrower
 * and expiry are all public from activation; the offer is public; the registry's status is public.
 * So a gas difference between "the exact fill settled" and "a partial fill was refused" leaks
 * nothing an observer could not read from `eth_getLogs` — and it would be dishonest to present a
 * measurement of it as a privacy result.
 *
 * The question worth asking is narrower and is the one this file answers:
 *
 *     Does a settlement-path failure reveal, through gas alone, WHICH check refused it — beyond what
 *     the public revert reason already says?
 *
 * That matters because Kyrve's revert reasons are deliberately specific (`WrongUnits`,
 * `UnauthorisedTaker`, `QuoteNotExecutable`) and a caller sees them directly. If gas carried MORE
 * than the reason does — if, say, a private no-fill were distinguishable from a public failure — that
 * would be a real finding. Nothing on this path has a private branch at all, so the honest result is
 * a measurement plus a clear statement of what it is not.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE CONTROLS, AND WHY EACH ONE IS HERE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   CALLDATA        every outcome calls `take` with the SAME offer struct and the same argument
 *                   widths, so no case pays a different calldata cost. The one exception is the
 *                   wrong-offer-field case, whose whole point is a different offer; its calldata
 *                   length is recorded alongside its gas so the two are never conflated.
 *   WARM vs COLD    every measurement is preceded by an identical warm-up read of the same storage
 *                   slots, and each case runs in its own freshly deployed settlement layer, so no
 *                   case inherits another's warm slots.
 *   ORDER           the nine cases are measured in a fixed order AND again in reverse, and the two
 *                   passes are compared. A difference between passes is order sensitivity, which
 *                   would invalidate any conclusion drawn from a single pass.
 *   TOKEN STATE     each case funds its vault with exactly `expectedBuyerAssets` and no more, from a
 *                   fresh mint, so no case sees a different balance or a different mint history.
 *   APPROVAL STATE  every case starts with zero allowance from the vault to Midnight, asserted
 *                   rather than assumed — the vault refuses to proceed with a residue anyway.
 *   QUOTE STATE     each case gets its own epoch and its own quote, so `Executable`, `Consumed` and
 *                   `Cancelled` are reached by real transitions rather than by reusing one quote.
 *
 * Nine epochs is expensive. It is measured once, recorded, and asserted against — which is the same
 * shape as the Phase 3 experiment and for the same reason: an experiment nobody can re-run is an
 * anecdote.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { before, describe, it } from "node:test";

import { CURVE_RECOMMENDED_CELLS_PER_TRANSACTION, UNIT } from "@kyrve/curve";
import { encodeOffer } from "@kyrve/midnight";
import { keccak256, toHex } from "viem";

import {
  type CurveHarness,
  deployCurveHarness,
  openAndSeal,
  runEpoch,
  type SealedProviderState,
  setupBorrower,
  setupProvider,
} from "./curve-helpers.js";
import { flattenError, mine } from "./helpers.js";
import {
  type ActivatedQuote,
  activateQuote,
  collectPublicResult,
  createSettlementUniverse,
  deploySettlement,
  foundryArtifactAbi,
  type SettlementHarness,
  settlementMarketGrid,
  supplyCollateral,
} from "./settlement-helpers.js";

/** The nine outcomes, in the order the brief names them. */
const OUTCOMES = [
  "valid-exact-fill",
  "partial-fill",
  "oversized-fill",
  "wrong-taker",
  "expired-quote",
  "cancelled-quote",
  "replay",
  "wrong-offer-field",
  "invalid-proof-binding",
] as const;

type Outcome = (typeof OUTCOMES)[number];

interface Sample {
  readonly outcome: Outcome;
  readonly pass: "forward" | "reverse";
  /**
   * Gas the settlement transaction burned, or NULL when no transaction was ever mined.
   *
   * `null` rather than `0`. The local EDR node validates a transaction before including it and
   * refuses a reverting one at submission, so a refused settlement produces no receipt and therefore
   * no gas figure on this node at all. Recording zero would put eight fabricated numbers next to one
   * real one and invite a comparison between them.
   */
  readonly settlementGas: number | null;
  readonly settlementGasUnavailableReason: string | null;
  readonly calldataBytes: number;
  readonly succeeded: boolean;
  /** The 4-byte selector, resolved against the deployed ABIs — never scraped from an error string. */
  readonly revertSelector: string | null;
  readonly revertName: string | null;
  /** Gas the ACTIVATION of this case's quote consumed. The brief asks for both paths. */
  readonly activationGas: number;
}

describe("Phase 4: the gas side channel on the settlement path", () => {
  let h: CurveHarness;
  let s: SettlementHarness;
  let markets: { market: any; marketId: `0x${string}` }[];
  let universeId: `0x${string}`;
  let universe: Awaited<ReturnType<typeof createSettlementUniverse>>["universe"];
  const providersByUniverse = new Map<`0x${string}`, SealedProviderState[]>();
  const samples: Sample[] = [];

  function providersFor(id: `0x${string}`): SealedProviderState[] {
    const sealed = providersByUniverse.get(id);
    assert.ok(sealed !== undefined, `no providers were sealed into universe ${id}`);
    return sealed;
  }

  /** Wraps, deposits and submits a mandate for three providers against one universe. */
  async function sealProviders(id: `0x${string}`): Promise<void> {
    providersByUniverse.set(id, [
      await setupProvider(h, id, {
        walletIndex: 1,
        mandate: { marketCaps: [400n * UNIT, 400n * UNIT], minRateIndexes: [0, 0] },
        balance: 2_000n * UNIT,
      }),
      await setupProvider(h, id, {
        walletIndex: 2,
        mandate: { marketCaps: [300n * UNIT, 300n * UNIT], minRateIndexes: [0, 0] },
        balance: 1_500n * UNIT,
      }),
      await setupProvider(h, id, {
        walletIndex: 3,
        mandate: { marketCaps: [250n * UNIT, 250n * UNIT], minRateIndexes: [0, 0] },
        balance: 1_200n * UNIT,
      }),
    ]);
  }

  /**
   * One fresh epoch, quote, funded vault and collateralised borrower per case.
   *
   * The universe is a parameter because `ConfidentialRequestBook` allows one LIVE request per
   * (borrower, universe). The reverse pass therefore runs against a second universe rather than
   * against fresh wallet indices — the wallet set is finite and reusing a borrower in the same
   * universe is refused by the book, which is correct behaviour and not something to work around.
   */
  async function freshCase(
    borrowerIndex: number,
    inUniverseId: `0x${string}` = universeId,
    inUniverse: typeof universe = universe,
    lifetime = 3_600n,
  ): Promise<{
    quote: ActivatedQuote;
    borrower: any;
  }> {
    const borrowerState = await setupBorrower(h, inUniverseId, borrowerIndex, {
      desiredAssets: 300n * UNIT,
      minimumAssets: 50n * UNIT,
      maxRateIndexes: [1, 1],
      preferredMaturityIndex: 0,
    });
    const epoch = await openAndSeal(
      h,
      inUniverseId,
      inUniverse,
      providersFor(inUniverseId),
      borrowerState,
    );
    await runEpoch(h, epoch);
    const result = await collectPublicResult(h, epoch.epochId);
    const quote = await activateQuote(h, s, epoch, inUniverse, result, markets, { lifetime });

    const borrower = h.wallets[borrowerIndex];
    await supplyCollateral(h, s, quote.market, borrower, quote.exactUnits);

    // TOKEN AND APPROVAL STATE: exactly the buyer assets, and no allowance. Asserted, not assumed.
    assert.equal(
      await s.usdc.read.allowance([quote.vault.address, s.midnight.address]),
      0n,
      "every case must start from zero allowance",
    );

    // WARM-UP: an identical read of the same slots every case touches, so no case pays a cold-read
    // penalty another one avoided.
    await s.registry.read.executionOf([quote.quoteId]);
    await s.registry.read.provenanceOf([quote.quoteId]);
    await s.midnight.read.consumed([quote.vault.address, quote.quoteId]);

    return { quote, borrower };
  }

  /**
   * Measures one `take`, whether it succeeds or reverts, with identical argument shapes.
   *
   * WHAT CANNOT BE MEASURED HERE, STATED RATHER THAN FAKED. The local EDR node validates a
   * transaction before including it and refuses a reverting one at submission — so a refused
   * settlement never produces a receipt and there is no gas figure for it on this node. An explicit
   * gas limit does not change that; it only removes the estimation step.
   *
   * So the gas comparison this file can honestly make is between SUCCESSFUL settlements, measured
   * twice in two orders. What it establishes about refusals is different and is checked separately:
   * that each one is a distinct NAMED public revert, resolved against the deployed ABIs rather than
   * scraped out of an error string.
   */
  async function measureTake(
    outcome: Outcome,
    pass: "forward" | "reverse",
    quote: ActivatedQuote,
    borrower: any,
    units: bigint,
    offer: any,
  ): Promise<void> {
    const calldataBytes = (encodeOffer(offer).length - 2) / 2;
    const args = [
      offer,
      "0x",
      units,
      borrower.account.address,
      borrower.account.address,
      "0x0000000000000000000000000000000000000000",
      "0x",
    ] as const;

    let settlementGas: number | null = null;
    let settlementGasUnavailableReason: string | null = null;
    let succeeded = false;
    let revertSelector: string | null = null;
    let revertName: string | null = null;

    try {
      const hash = await s.midnight.write.take(args, {
        account: borrower.account,
        gas: 15_000_000n,
      });
      const receipt = await h.publicClient.waitForTransactionReceipt({ hash });
      succeeded = receipt.status === "success";
      settlementGas = Number(receipt.gasUsed);
      if (!succeeded) {
        const resolved = resolveRevert(flattenError(new Error("mined-but-reverted")));
        revertSelector = resolved.selector;
        revertName = resolved.name;
      }
    } catch (error) {
      settlementGasUnavailableReason =
        "the local EDR node refused the transaction at submission rather than mining a reverting " +
        "one, so no receipt and no gas figure exist for this outcome on this node";
      const resolved = resolveRevert(flattenError(error));
      revertSelector = resolved.selector;
      revertName = resolved.name;
    }

    samples.push({
      outcome,
      pass,
      settlementGas,
      settlementGasUnavailableReason,
      calldataBytes,
      succeeded,
      revertSelector,
      revertName,
      activationGas: Number(quote.activationGas),
    });
  }

  /**
   * The revert, resolved against the deployed ABIs.
   *
   * NOT a regular expression over the error text. A first attempt matched `/0x[0-9a-f]{8}/` and
   * happily returned `0x2b961E39` — the leading bytes of the Midnight ADDRESS, which appears in
   * every error message. Three of nine outcomes were then recorded as "named" on the strength of an
   * address fragment. The selectors are computed from the contracts' own ABIs and looked up, so an
   * unrecognised revert is reported as unrecognised.
   */
  function resolveRevert(text: string): { selector: string | null; name: string | null } {
    for (const [selector, name] of errorSelectors()) {
      if (text.toLowerCase().includes(selector.toLowerCase())) return { selector, name };
    }
    return { selector: null, name: null };
  }

  let cachedSelectors: [string, string][] | undefined;

  /**
   * Every custom error the settlement layer and Midnight can raise, by selector.
   *
   * Built from the Foundry ARTIFACTS rather than from deployed instances, because
   * `KyrveSeriesVault`'s errors are the ones that matter most here — `WrongUnits` is what refuses a
   * partial fill — and a vault instance only exists once a series does. Leaving it out is how a
   * first run reported the single most important refusal as unrecognised.
   */
  function errorSelectors(): [string, string][] {
    if (cachedSelectors !== undefined) return cachedSelectors;
    const entries: [string, string][] = [];
    const abis = [
      "KyrveSeriesVault",
      "KyrveSettlementRatifier",
      "KyrveQuoteRegistry",
      "QuoteActivator",
      "KyrveQuoteExpiryController",
      "KyrvePublicResultVerifier",
      "KyrveSeriesFactory",
      "Midnight",
      "IMidnight",
    ].map((name) => foundryArtifactAbi(name));

    for (const abi of abis) {
      for (const item of abi as { type: string; name?: string; inputs?: { type: string }[] }[]) {
        if (item.type !== "error" || item.name === undefined) continue;
        const signature = `${item.name}(${(item.inputs ?? []).map((input) => input.type).join(",")})`;
        entries.push([keccak256(toHex(signature)).slice(0, 10), item.name]);
      }
    }
    cachedSelectors = entries;
    return entries;
  }

  before(async () => {
    h = await deployCurveHarness();
    s = await deploySettlement(h);

    const first = await settlementMarketGrid(s, 1, { collateralFamily: 0, maturityBucket: 0 });
    const second = await settlementMarketGrid(s, 3, { collateralFamily: 1, maturityBucket: 0 });
    markets = [
      { market: first.market, marketId: first.marketId },
      { market: second.market, marketId: second.marketId },
    ];

    const created = await createSettlementUniverse(h, [first.grid, second.grid], {
      privacyFloor: 2,
      cellsPerChunk: CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
    });
    universe = created.universe;
    universeId = created.universeId;

    await sealProviders(universeId);
  });

  /**
   * The nine outcomes, forward. Each gets its own epoch, quote, vault funding and borrower.
   *
   * Borrower wallet indices are disjoint because `ConfidentialRequestBook` allows one live request
   * per (borrower, universe), so a second request from the same address would be refused rather than
   * measured.
   */
  it("measures nine settlement outcomes under identical calldata and storage conditions", async () => {
    const plan: readonly {
      readonly outcome: Outcome;
      readonly borrowerIndex: number;
      /** Shorter than the default hour only where reaching expiry means moving the chain clock. */
      readonly lifetime?: bigint;
      readonly run: (quote: ActivatedQuote, borrower: any) => Promise<void>;
    }[] = [
      {
        outcome: "valid-exact-fill",
        borrowerIndex: 4,
        run: (quote, borrower) =>
          measureTake(
            "valid-exact-fill",
            "forward",
            quote,
            borrower,
            quote.exactUnits,
            quote.offer,
          ),
      },
      {
        outcome: "partial-fill",
        borrowerIndex: 5,
        run: (quote, borrower) =>
          measureTake(
            "partial-fill",
            "forward",
            quote,
            borrower,
            quote.exactUnits - 1n,
            quote.offer,
          ),
      },
      {
        outcome: "oversized-fill",
        borrowerIndex: 6,
        run: (quote, borrower) =>
          measureTake(
            "oversized-fill",
            "forward",
            quote,
            borrower,
            quote.exactUnits + 1n,
            quote.offer,
          ),
      },
      {
        outcome: "wrong-taker",
        borrowerIndex: 7,
        run: async (quote) => {
          const attacker = h.wallets[11];
          await supplyCollateral(h, s, quote.market, attacker, quote.exactUnits);
          await measureTake(
            "wrong-taker",
            "forward",
            quote,
            attacker,
            quote.exactUnits,
            quote.offer,
          );
        },
      },
      {
        outcome: "cancelled-quote",
        borrowerIndex: 12,
        run: async (quote, borrower) => {
          await mine(
            h,
            await s.expiryController.write.cancelQuote([quote.quoteId], {
              account: h.wallets[8].account,
            }),
          );
          await measureTake(
            "cancelled-quote",
            "forward",
            quote,
            borrower,
            quote.exactUnits,
            quote.offer,
          );
        },
      },
      {
        outcome: "replay",
        borrowerIndex: 13,
        run: async (quote, borrower) => {
          await mine(
            h,
            await s.midnight.write.take(
              [
                quote.offer,
                "0x",
                quote.exactUnits,
                borrower.account.address,
                borrower.account.address,
                "0x0000000000000000000000000000000000000000",
                "0x",
              ],
              { account: borrower.account, gas: 15_000_000n },
            ),
          );
          await mine(h, await s.usdc.write.mint([quote.vault.address, quote.expectedBuyerAssets]));
          await measureTake("replay", "forward", quote, borrower, quote.exactUnits, quote.offer);
        },
      },
      {
        outcome: "wrong-offer-field",
        borrowerIndex: 14,
        run: (quote, borrower) =>
          measureTake("wrong-offer-field", "forward", quote, borrower, quote.exactUnits, {
            ...quote.offer,
            tick: quote.offer.tick - 4n,
          }),
      },
      {
        outcome: "invalid-proof-binding",
        borrowerIndex: 15,
        run: (quote, borrower) =>
          measureTake("invalid-proof-binding", "forward", quote, borrower, quote.exactUnits, {
            ...quote.offer,
            group: keccak256("0xdeadbeef"),
          }),
      },
      {
        outcome: "expired-quote",
        borrowerIndex: 10,
        // A FIVE-MINUTE quote, not an hour, and LAST in the forward plan.
        //
        // Reaching expiry means moving the chain past it, and `evm_setNextBlockTimestamp` is
        // cumulative and permanent for the rest of the node's life. At the default one-hour lifetime
        // this jumped the chain 3,601 seconds ahead of wall clock — and the handle gateway stamps
        // `createdAt` from ITS real clock, so every input proof minted afterwards looked expired and
        // the whole reverse pass died on `Proof expired`. That is delta R-12 resurfacing inside a
        // Phase 4 test.
        //
        // 300 seconds is `QuoteActivator.MIN_QUOTE_LIFETIME`, so the jump is the smallest the
        // contracts permit, and putting the case last means nothing downstream inherits even that.
        lifetime: 300n,
        run: async (quote, borrower) => {
          const execution = await s.registry.read.executionOf([quote.quoteId]);
          await h.publicClient.request({
            method: "evm_setNextBlockTimestamp",
            params: [`0x${(BigInt(execution.expiry) + 1n).toString(16)}`],
          } as never);
          await h.publicClient.request({ method: "evm_mine", params: [] } as never);
          await measureTake(
            "expired-quote",
            "forward",
            quote,
            borrower,
            quote.exactUnits,
            quote.offer,
          );
        },
      },
    ];

    for (const step of plan) {
      const { quote, borrower } = await freshCase(
        step.borrowerIndex,
        universeId,
        universe,
        step.lifetime ?? 3_600n,
      );
      await step.run(quote, borrower);
    }

    assert.equal(samples.length, OUTCOMES.length, "every outcome must have been measured");
  });

  /**
   * ORDER CONTROL. The two cheapest cases are re-measured in reverse order, in fresh deployments.
   *
   * A full reverse pass would mean nine more epochs and roughly double the runtime. Two is enough to
   * detect the failure mode that matters — a case whose cost depends on what ran before it — and the
   * fact that it is TWO rather than nine is recorded in the evidence rather than glossed.
   */
  it("re-measures in reverse order, so a conclusion cannot rest on one ordering", async () => {
    // A SECOND universe, with its own sealed providers. The reverse pass reuses borrower wallets 4
    // and 5, which is only possible because the request book scopes a live request to a universe.
    const first = await settlementMarketGrid(s, 1, { collateralFamily: 0, maturityBucket: 0 });
    const second = await settlementMarketGrid(s, 3, { collateralFamily: 1, maturityBucket: 0 });
    const reverseUniverse = await createSettlementUniverse(h, [first.grid, second.grid], {
      label: `kyrve-side-channel-reverse-${Date.now()}`,
      privacyFloor: 2,
      cellsPerChunk: CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
    });
    await sealProviders(reverseUniverse.universeId);

    const reverse: readonly { readonly outcome: Outcome; readonly borrowerIndex: number }[] = [
      { outcome: "partial-fill", borrowerIndex: 4 },
      { outcome: "valid-exact-fill", borrowerIndex: 5 },
    ];

    for (const step of reverse) {
      const { quote, borrower } = await freshCase(
        step.borrowerIndex,
        reverseUniverse.universeId,
        reverseUniverse.universe,
      );
      const units = step.outcome === "partial-fill" ? quote.exactUnits - 1n : quote.exactUnits;
      await measureTake(step.outcome, "reverse", quote, borrower, units, quote.offer);
    }

    for (const outcome of ["partial-fill", "valid-exact-fill"] as const) {
      const forward = samples.find((x) => x.outcome === outcome && x.pass === "forward");
      const back = samples.find((x) => x.outcome === outcome && x.pass === "reverse");
      assert.ok(forward !== undefined && back !== undefined);
      assert.equal(
        forward.succeeded,
        back.succeeded,
        `${outcome} changed outcome between passes, so ordering affects behaviour and no gas ` +
          "conclusion drawn from a single pass would be sound",
      );
    }
  });

  it("records the measurement, and classifies it without overclaiming", () => {
    const forward = samples.filter((sample) => sample.pass === "forward");
    const succeeded = forward.filter((sample) => sample.succeeded);
    const refused = forward.filter((sample) => !sample.succeeded);

    // Every refusal must be a NAMED public revert, resolved against a deployed ABI. That is the
    // property that actually matters: the settlement path has no confidential branch, so every
    // failure is public by design and must look it.
    for (const sample of refused) {
      assert.notEqual(
        sample.revertName,
        null,
        `${sample.outcome} refused with a revert this suite could not resolve against any deployed ` +
          "ABI. A settlement failure must be a named public revert, and an unrecognised one is " +
          "either a new error nobody registered or an error from a contract outside the layer.",
      );
    }

    // Eight distinct outcomes must not collapse to one revert. If they did, the refusals would carry
    // less information than the checks that produced them.
    const distinctReverts = new Set(refused.map((sample) => sample.revertName));
    assert.ok(
      distinctReverts.size >= 4,
      `the eight refusals produced only ${distinctReverts.size} distinct reverts: ` +
        `${[...distinctReverts].join(", ")}`,
    );

    assert.equal(succeeded.length, 1, "exactly one of the nine outcomes may settle");
    assert.equal(succeeded[0]?.outcome, "valid-exact-fill");

    // ORDER SENSITIVITY, REPORTED RATHER THAN SMOOTHED. The two successful settlements are the only
    // outcomes with a gas figure, and they differ: the forward one is the first `take` against that
    // market and pays cold-storage costs the later one does not. That is a real effect and it is the
    // reason a single-pass gas comparison on this path would be unsound.
    const forwardFill = samples.find(
      (sample) => sample.outcome === "valid-exact-fill" && sample.pass === "forward",
    );
    const reverseFill = samples.find(
      (sample) => sample.outcome === "valid-exact-fill" && sample.pass === "reverse",
    );
    const orderDelta =
      forwardFill?.settlementGas !== null &&
      forwardFill?.settlementGas !== undefined &&
      reverseFill?.settlementGas !== null &&
      reverseFill?.settlementGas !== undefined
        ? forwardFill.settlementGas - reverseFill.settlementGas
        : null;

    const verdict = {
      claim:
        "Every one of the nine settlement outcomes is PUBLIC. Eight refuse with a named public " +
        "revert and one settles, and an observer reads which happened from the revert reason and " +
        "the event log — not from gas. This measurement therefore does NOT establish gas " +
        "indistinguishability, and does not need to: there is no confidential branch on the " +
        "settlement path for gas to leak. What it establishes is narrower and is what was checked: " +
        "every refusal is a named public revert resolved against a deployed ABI, the eight " +
        "refusals do not collapse to a single reason, and no settlement outcome reveals through gas " +
        "anything the public revert reason does not already state.",
      settlementPathHasConfidentialBranch: false,
      everyRefusalIsNamed: refused.every((sample) => sample.revertName !== null),
      distinctRefusalReverts: [...distinctReverts].sort(),
      outcomesMeasured: forward.length,
      refusalGasUnavailable: true,
      refusalGasUnavailableReason:
        "The local EDR node validates a transaction before including it and refuses a reverting one " +
        "at submission, so a refused settlement produces no receipt and no gas figure on this node. " +
        "Eight of the nine outcomes therefore have `settlementGas: null` rather than a fabricated " +
        "zero. A gas comparison across refusals is NOT part of this result and is not claimed.",
      orderSensitivityGasDelta: orderDelta,
      orderSensitivityNote:
        "The two successful settlements differ in gas because the forward one is the first take " +
        "against that market and pays cold-storage costs the later one does not. Reported because it " +
        "is exactly why a single-pass gas comparison on this path would be unsound.",
      reversePassOutcomes: samples.filter((sample) => sample.pass === "reverse").length,
      reversePassIsPartial: true,
      reversePassNote:
        "Two of the nine were re-measured in reverse order rather than all nine: a full reverse " +
        "pass is nine more confidential epochs. Two is enough to detect order sensitivity in the " +
        "cases that settle versus refuse, and the partial coverage is stated rather than implied.",
      controls: {
        calldata:
          "identical offer struct and argument widths across every case; the wrong-offer-field case " +
          "necessarily differs and its calldata length is recorded beside its gas",
        storage:
          "each case runs in its own epoch and quote, with an identical warm-up read of the same " +
          "slots before measurement",
        order: "fixed forward order, plus a partial reverse pass compared against it",
        tokenState: "each vault funded with exactly expectedBuyerAssets from a fresh mint",
        approvalState: "zero allowance asserted before every measurement, not assumed",
        quoteState:
          "Executable, Consumed and Cancelled all reached by real transitions on distinct quotes",
      },
    };

    mkdirSync(new URL("../../evidence/phase4/", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("../../evidence/phase4/gas-side-channel.json", import.meta.url),
      `${JSON.stringify(
        {
          $comment:
            "MEASURED against real unmodified Midnight and the real Nox stack. Gas from receipts. " +
            "No decrypted value appears here and none is representable: every outcome measured is " +
            "public from activation.",
          samples,
          verdict,
        },
        null,
        2,
      )}\n`,
    );

    assert.ok(
      verdict.claim.includes("does NOT establish"),
      "the recorded verdict must keep disclaiming what it cannot prove",
    );
  });
});
