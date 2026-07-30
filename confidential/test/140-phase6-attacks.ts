/**
 * Phase 6 attack suite, against the REAL Nox stack and REAL unmodified Midnight.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS SUITE IS FOR, AND WHAT IT DELIBERATELY DOES NOT REPEAT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The demonstration suites (110, 120, 130) already prove that each feature works and that its
 * headline defences hold: a capsule cannot be read by the wrong recipient, a seller cannot offer
 * more than they hold, a roll cannot net twice. Repeating those here would inflate the count without
 * raising the confidence.
 *
 * This suite attacks the four things nothing else covers, each chosen because it is a failure mode
 * that would look completely normal from the outside:
 *
 *    A1  ROLE CONFUSION — every privileged entry point, tried by every role that does not hold it.
 *        Six wrong roles per entry point, not one attacker. A registry that declares seven distinct
 *        holders proves nothing if `matchOrders` happens to accept the curator.
 *
 *    A2  RESIDUE REDIRECTION — the beneficiary is `immutable`, so the attack is not "call the
 *        setter", it is "prove no setter exists and no path reaches one". That is an assertion about
 *        the compiled ABI, not about a call.
 *
 *    A3  EQUAL-HANDLE ACL ALIASING — the load-bearing Nox property. A handle is deterministic in its
 *        operands, so two logically distinct quantities computed identically are ONE handle with ONE
 *        permanent ACL entry. A grant to one recipient would then be a grant to the other.
 *
 *    A4  HOSTILE TRANSIENT RECIPIENT — `Nox.allowTransient` carries full persistent-grant power, so
 *        any contract handed a transient handle can permanently publish it. The books restrict
 *        recipients to reviewed Kyrve contracts; this proves that restriction is real rather than
 *        documented.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY REENTRANCY IS TESTED AS A RECIPIENT RESTRICTION AND NOT AS A HOSTILE CALLBACK
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The classic reentrancy fixture hands a hostile contract a token callback. There is no such
 * callback here: `KyrveSeriesToken` is ERC-7984 over Nox, its transfers move handles rather than
 * calling recipients, and the only contracts a book will hand a handle to are the two it was
 * constructed with. The reachable attack is therefore not "re-enter during a transfer" but "become
 * a contract the book will talk to at all", and A4 is that attack.
 *
 * Every refusal below asserts the error BY NAME. Delta U-10 exists because a bare `try/catch` in the
 * Sepolia roll driver reported a defence that had never fired.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE PAIRED NEGATIVE, EXECUTED RATHER THAN ASSERTED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Delta R-6 records that the OBVIOUS test for handle aliasing passes with the defence removed, so a
 * green A3 means nothing until it has been shown it can go red. Replacing the isolation domain in
 * `KyrveSeriesToken.issueOwnershipCapsule` —
 *
 *     uint256(keccak256(abi.encode(msg.sender, recipient, sequence)))
 *  -> uint256(keccak256(abi.encode(msg.sender)))
 *
 * — and re-running gives:
 *
 *     1) A3. two capsules over the same balance, to different recipients, are DIFFERENT handles
 *        AssertionError: TWO CAPSULES OVER THE SAME BALANCE COLLAPSED TO ONE HANDLE.
 *        Compared values have no visual difference.
 *
 * Byte-identical handles, exactly as the Nox determinism property predicts. A1 carries its own
 * guard — the keeper must reach PAST the access check and fail on `UnknownOrder`, so the six
 * refusals cannot be satisfied by a function that reverts for everybody. A2 asserts over the
 * compiled ABI and A4 asserts both the allowed and the refused answers, so neither passes vacuously.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { CURVE_RECOMMENDED_CELLS_PER_TRANSACTION, UNIT } from "@kyrve/curve";
import type { Handle } from "@kyrve/nox";

import {
  assertRevertsWithError,
  type CurveHarness,
  deployCurveHarness,
  type EpochState,
  openAndSeal,
  runEpoch,
  type SealedProviderState,
  setupBorrower,
  setupProvider,
} from "./curve-helpers.js";
import { clientFor, mine, ROLE_INDEX, SUITE_POLL } from "./helpers.js";
import { type CrossBook, deployCrossBook } from "./market-helpers.js";
import {
  allocateSeries,
  deploySeriesLayer,
  fundQuoteFromCustody,
  type SeriesLayer,
} from "./series-helpers.js";
import {
  activateQuote,
  collectPublicResult,
  createSettlementUniverse,
  deploySettlement,
  type SettlementHarness,
  settlementMarketGrid,
  supplyCollateral,
} from "./settlement-helpers.js";

const WAD = 10n ** 18n;
const ZERO_HANDLE = `0x${"00".repeat(32)}` as Handle;

/**
 * Every role that is NOT the keeper, by wallet index. A role-confusion test that tries one attacker
 * proves the function has an access check; trying every other declared holder proves the check names
 * the RIGHT role. Those are different claims and only the second one is interesting.
 */
const NOT_THE_KEEPER = [
  ["deployer", ROLE_INDEX.deployer],
  ["curator", ROLE_INDEX.curator],
  ["operator", ROLE_INDEX.operator],
  ["emergencyAuthority", ROLE_INDEX.emergencyAuthority],
  ["residueBeneficiary", ROLE_INDEX.residueBeneficiary],
  ["auditor", ROLE_INDEX.auditor],
] as const;

const NOT_THE_CURATOR = [
  ["deployer", ROLE_INDEX.deployer],
  ["keeper", ROLE_INDEX.keeper],
  ["operator", ROLE_INDEX.operator],
  ["emergencyAuthority", ROLE_INDEX.emergencyAuthority],
  ["residueBeneficiary", ROLE_INDEX.residueBeneficiary],
  ["auditor", ROLE_INDEX.auditor],
] as const;

describe("Phase 6 attacks: role confusion, residue redirection, handle aliasing, hostile recipients", () => {
  let h: CurveHarness;
  let s: SettlementHarness;
  let series: SeriesLayer;
  let cross: CrossBook;
  let quoteId: `0x${string}`;
  let providers: SealedProviderState[];
  let epoch: EpochState;
  let subject: SealedProviderState;

  /**
   * An expiry derived from BLOCK time, not wall clock. The Nox node's clock outruns wall clock
   * (delta R-12), so `Date.now() + 3600` can already be in the past for the chain.
   */
  function capsuleExpiry(): bigint {
    return blockNow + 3600n;
  }
  let blockNow = 0n;

  before(async () => {
    h = await deployCurveHarness({ substrate: true });
    s = await deploySettlement(h);

    const first = await settlementMarketGrid(s, 1, { collateralFamily: 0, maturityBucket: 0 });
    const second = await settlementMarketGrid(s, 3, { collateralFamily: 1, maturityBucket: 0 });
    const markets = [
      { market: first.market, marketId: first.marketId },
      { market: second.market, marketId: second.marketId },
    ];
    const created = await createSettlementUniverse(h, [first.grid, second.grid], {
      privacyFloor: 2,
      cellsPerChunk: CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
    });

    providers = [
      await setupProvider(h, created.universeId, {
        walletIndex: 1,
        mandate: { marketCaps: [400n * UNIT, 400n * UNIT], minRateIndexes: [0, 0] },
        balance: 2_000n * UNIT,
      }),
      await setupProvider(h, created.universeId, {
        walletIndex: 2,
        mandate: { marketCaps: [300n * UNIT, 300n * UNIT], minRateIndexes: [0, 0] },
        balance: 1_500n * UNIT,
      }),
    ];
    const borrower = await setupBorrower(h, created.universeId, 5, {
      desiredAssets: 400n * UNIT,
      minimumAssets: 50n * UNIT,
      maxRateIndexes: [1, 1],
      preferredMaturityIndex: 0,
    });

    epoch = await openAndSeal(h, created.universeId, created.universe, providers, borrower);
    await runEpoch(h, epoch);
    const result = await collectPublicResult(h, epoch.epochId);

    const winning = markets[result.marketIndex];
    assert.ok(winning !== undefined, "the published market index must name a deployed market");
    const seriesId = (await s.factory.read.seriesIdFor([winning.marketId])) as `0x${string}`;
    await mine(
      h,
      await s.factory.write.createSeries([winning.marketId, s.usdc.address, s.operator], {
        account: s.curator.account,
      }),
    );
    const vaultAddress = (await s.factory.read.vaultOf([seriesId])) as `0x${string}`;

    series = await deploySeriesLayer(h, s, {
      seriesId,
      marketId: winning.marketId,
      vaultAddress,
      loanToken: s.usdc.address as `0x${string}`,
    });
    await fundQuoteFromCustody(h, series, epoch.epochId, providers.length);

    const quote = await activateQuote(h, s, epoch, created.universe, result, markets, {
      fund: false,
    });
    const borrowerWallet = h.wallets[5];
    await supplyCollateral(h, s, quote.market, borrowerWallet, quote.exactUnits);
    await mine(
      h,
      await s.midnight.write.take(
        [
          quote.offer,
          "0x",
          quote.exactUnits,
          borrowerWallet.account.address,
          borrowerWallet.account.address,
          "0x0000000000000000000000000000000000000000",
          "0x",
        ],
        { account: borrowerWallet.account, gas: 15_000_000n },
      ),
    );
    await allocateSeries(h, series, quote.quoteId, providers.length);

    quoteId = quote.quoteId;
    cross = await deployCrossBook(h, s, series, { priceWad: WAD, feeBps: 25 });
    subject = providers[0] as SealedProviderState;
    blockNow = (await h.publicClient.getBlock()).timestamp;
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // A1 · ROLE CONFUSION
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("A1a. every role that is not the keeper is refused the Cross match, by name", async () => {
    // `matchOrders` is the single most valuable function in the Cross book: it decides who receives
    // whose escrow. Six declared role holders try it. A test with one attacker would pass even if
    // the modifier checked CURATOR by mistake.
    for (const [name, index] of NOT_THE_KEEPER) {
      await assertRevertsWithError(
        () =>
          cross.book.write.matchOrders([ZERO_HANDLE, ZERO_HANDLE], {
            account: h.wallets[index].account,
          }),
        cross.book,
        "NotKeeper",
        `the ${name} must not be able to match Cross orders`,
      );
    }

    // And the keeper reaches PAST the access check — it fails on the order, not on the caller.
    // Without this the six refusals above would also pass against a function that reverts for
    // everyone, which is a different contract from the one being claimed.
    await assertRevertsWithError(
      () =>
        cross.book.write.matchOrders([ZERO_HANDLE, ZERO_HANDLE], {
          account: h.wallets[ROLE_INDEX.keeper].account,
        }),
      cross.book,
      "UnknownOrder",
      "the keeper must get past the access check and fail on the order instead",
    );
  });

  it("A1b. every role that is not the curator is refused a public capsule, by name", async () => {
    for (const [name, index] of NOT_THE_CURATOR) {
      await assertRevertsWithError(
        () =>
          series.capsules.write.issuePublicCapsule(
            [3, h.wallets[ROLE_INDEX.auditor].account.address, quoteId, capsuleExpiry()],
            { account: h.wallets[index].account },
          ),
        series.capsules,
        "NotCurator",
        `the ${name} must not be able to issue a public capsule`,
      );
    }
  });

  it("A1c. no wallet at all can forge an ownership capsule — only the token may record one", async () => {
    // `recordOwnershipCapsule` is not role-gated, it is CONTRACT-gated: the series token is the only
    // caller that has read a balance handle honestly. A role-gated version would let whichever role
    // held it mint a capsule asserting any handle at all.
    for (const [name, index] of [...NOT_THE_CURATOR, ["curator", ROLE_INDEX.curator]] as const) {
      await assertRevertsWithError(
        () =>
          series.capsules.write.recordOwnershipCapsule(
            [
              h.wallets[index].account.address,
              h.wallets[ROLE_INDEX.auditor].account.address,
              quoteId,
              capsuleExpiry(),
              ZERO_HANDLE,
              0n,
            ],
            { account: h.wallets[index].account },
          ),
        series.capsules,
        "NotToken",
        `the ${name} must not be able to record an ownership capsule directly`,
      );
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // A2 · RESIDUE REDIRECTION
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("A2. no role can redirect the residue, because the ABI exposes nothing that could", async () => {
    // The brief asks that no role be able to silently redirect provider value. For an `immutable`
    // destination that is not a runtime question — a call to a setter that does not exist reverts
    // for the boring reason that the selector is unknown, which proves nothing about intent.
    //
    // The real assertion is over the compiled ABI: no function mutates the beneficiary, and the one
    // that reads it returns the address the deployment declared.
    const declared = h.wallets[ROLE_INDEX.residueBeneficiary].account.address.toLowerCase();
    const onChain = ((await cross.book.read.FEE_BENEFICIARY()) as string).toLowerCase();
    assert.equal(
      onChain,
      declared,
      "the fee beneficiary on chain must be the address the deployment declared",
    );

    const mutators = (cross.book.abi as { type: string; name?: string; stateMutability?: string }[])
      .filter(
        (item) =>
          item.type === "function" &&
          item.stateMutability !== "view" &&
          item.stateMutability !== "pure",
      )
      .map((item) => item.name ?? "")
      .filter((name) => /benefic|residue|recipient|treasur|fee/i.test(name));
    assert.deepEqual(
      mutators,
      [],
      `the Cross book exposes state-changing functions that could redirect value: ${mutators.join(", ")}. ` +
        "A residue destination that any role can move is not an immutable destination.",
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // A3 · EQUAL-HANDLE ACL ALIASING
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("A3. two capsules over the same balance, to different recipients, are DIFFERENT handles", async () => {
    // THE ATTACK. A Nox handle is deterministic in its operands, so two logically distinct
    // quantities computed identically from identical inputs collapse to ONE handle with ONE
    // permanent ACL entry. If `issueOwnershipCapsule` snapshotted a balance the obvious way, the
    // second auditor's capsule would BE the first auditor's capsule — and granting it to the second
    // would retroactively hand the first a permanent grant it was never issued.
    //
    // `_isolateOwn` mixes the recipient and the issuance sequence into the derivation, so the two
    // snapshots carry the same VALUE and different HANDLES. That is the whole defence, and the only
    // way to see it fail is to compare the handles.
    const auditorA = h.wallets[ROLE_INDEX.auditor].account.address as `0x${string}`;
    const auditorB = h.wallets[6].account.address as `0x${string}`;
    assert.notEqual(
      auditorA.toLowerCase(),
      auditorB.toLowerCase(),
      "the two recipients must differ",
    );

    const holder = h.wallets[subject.walletIndex];
    const expiry = capsuleExpiry();

    const issue = async (recipient: `0x${string}`): Promise<Handle> => {
      const nonce = (await series.token.read.nextNonce([holder.account.address])) as bigint;
      await mine(
        h,
        await series.token.write.issueOwnershipCapsule([recipient, quoteId, expiry, nonce], {
          account: holder.account,
        }),
      );
      const ids = (await series.capsules.read.capsulesFor([recipient])) as `0x${string}`[];
      const capsuleId = ids[ids.length - 1] as `0x${string}`;
      const record = (await series.capsules.read.capsuleOf([capsuleId])) as Record<string, unknown>;
      return record["snapshotHandle"] as Handle;
    };

    const handleA = await issue(auditorA);
    const handleB = await issue(auditorB);

    assert.notEqual(
      handleA,
      handleB,
      "TWO CAPSULES OVER THE SAME BALANCE COLLAPSED TO ONE HANDLE. A Nox ACL entry is per handle " +
        "and permanent, so the grant issued to the second recipient is also a grant to the first — " +
        "a viewer who was never issued a capsule can decrypt one, forever, and there is no " +
        "removeViewer. Isolation must mix the recipient into the derivation.",
    );

    // Same value, different handles. Both recipients read the same balance and neither can read the
    // other's handle — the value being equal is exactly why the handles must not be.
    const readAs = async (index: number, handle: Handle): Promise<bigint> =>
      (await clientFor(h, index)).decrypt(handle, SUITE_POLL);
    const valueA = await readAs(ROLE_INDEX.auditor, handleA);
    const valueB = await readAs(6, handleB);
    assert.equal(valueA, valueB, "both snapshots must carry the same balance");

    await assert.rejects(
      () => readAs(6, handleA),
      /holds no grant|not\s*authoris|not\s*authoriz|denied|forbidden/i,
      "the second recipient must not be able to decrypt the FIRST recipient's capsule handle",
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // A4 · HOSTILE TRANSIENT RECIPIENT
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("A4. only reviewed Kyrve contracts are transient-handle recipients, and the set is closed", async () => {
    // Transient access carries FULL persistent-grant power: any contract handed a transient handle
    // can call `allowPublicDecryption` on it and publish it irreversibly. So the books must never
    // hand a handle to an address chosen by a caller, and `isReviewedTransientRecipient` is the
    // gate. This asserts the gate answers only for the two tokens it was constructed with — an
    // arbitrary contract, an EOA and the zero address are all refused.
    const allowed = [series.token.address, h.asset.address].map((a) => a.toLowerCase());
    for (const candidate of allowed) {
      assert.equal(
        await cross.book.read.isReviewedTransientRecipient([candidate]),
        true,
        `${candidate} is a constructor-pinned token and must be a reviewed recipient`,
      );
    }

    const hostile = [
      h.wallets[6].account.address,
      cross.book.address,
      series.capsules.address,
      series.vault.address,
      "0x0000000000000000000000000000000000000000",
      "0x000000000000000000000000000000000000dEaD",
    ];
    for (const candidate of hostile) {
      if (allowed.includes(candidate.toLowerCase())) continue;
      assert.equal(
        await cross.book.read.isReviewedTransientRecipient([candidate]),
        false,
        `${candidate} must NOT be a reviewed transient recipient. Anything handed a transient ` +
          "handle can publish it permanently, and there is no way to un-publish.",
      );
    }
  });
});
