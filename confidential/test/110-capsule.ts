/**
 * Phase 6 demonstrations 1-7: Kyrve Capsule, against the REAL Nox stack and REAL unmodified Midnight.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE PROPERTY UNDER TEST IS A NEGATIVE, SO MOST OF THIS FILE IS REFUSALS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A capsule that discloses the right value to the right auditor is easy and proves almost nothing.
 * What has to be true is that it discloses NOTHING ELSE — not the provider's live balance, not a
 * later balance, not another provider's identical balance, and not anything to a wallet the capsule
 * was not addressed to. Every one of those is a real gateway refusal here, not an assertion about
 * what the code intends.
 *
 *    1. a provider owns a confidential series balance
 *    2. the provider freezes it into a capsule for the auditor
 *    3. the auditor decrypts the frozen snapshot, and it equals the reference model
 *    4. the auditor CANNOT decrypt the provider's live balance
 *    5. a third wallet CANNOT decrypt the capsule
 *    6. the capsule's origin and scope verify publicly, from chain state alone
 *    7. expired, substituted, replayed and cross-recipient capsule proofs all fail
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * DEMONSTRATION 4 IS THE ONE THAT WOULD BE EASY TO FAKE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * "The auditor cannot read the live balance" is trivially true at the instant of issuance if the
 * snapshot and the balance happen to be the same handle — the auditor would simply be reading the
 * live balance and calling it a snapshot, and every assertion about values would still pass.
 *
 * So the test does two things the obvious version does not. It asserts the two HANDLES differ, and
 * then it MOVES the provider's balance and re-reads: the capsule must still decrypt to the old value
 * and the live balance must still be refused. A snapshot that tracked the live balance would fail
 * the first; a snapshot that was secretly the live handle would fail both.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { before, describe, it } from "node:test";

import { CURVE_RECOMMENDED_CELLS_PER_TRANSACTION, UNIT } from "@kyrve/curve";
import type { Handle } from "@kyrve/nox";

import {
  acl,
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
import { clientFor, flattenError, mine, ROLE_INDEX, SUITE_POLL } from "./helpers.js";
import {
  allocateSeries,
  deploySeriesLayer,
  fundQuoteFromCustody,
  readSeriesBalance,
  type SeriesLayer,
} from "./series-helpers.js";
import {
  type ActivatedQuote,
  activateQuote,
  collectPublicResult,
  createSettlementUniverse,
  deploySettlement,
  type PublicResult,
  type SettlementHarness,
  settlementMarketGrid,
  supplyCollateral,
} from "./settlement-helpers.js";

const ZERO_HANDLE = `0x${"00".repeat(32)}` as Handle;

/** `KyrveCapsuleVault.Scope`, in enum order. */
const SCOPE = {
  ProviderSeriesOwnership: 0,
  AggregateSeriesSupply: 1,
  PublicMidnightCredit: 2,
  SolvencyState: 3,
  SettledQuoteSummary: 4,
  DeclaredResidue: 5,
  AllocationProvenance: 6,
} as const;

const CLAIM_STATE = { None: 0, Allocated: 1, Unwound: 2 } as const;

describe("Phase 6 demonstrations 1-7: frozen selective disclosure", () => {
  let h: CurveHarness;
  let s: SettlementHarness;
  let series: SeriesLayer;
  let providers: SealedProviderState[];
  let epoch: EpochState;
  let result: PublicResult;
  let quote: ActivatedQuote;

  /** The declared auditor. Wallet 12 — not the deployer, keeper, operator, curator or guardian. */
  let auditor: `0x${string}`;
  let auditorIndex: number;
  /** A wallet holding no role and no grant. Every cross-recipient refusal is measured against it. */
  let outsider: `0x${string}`;
  let outsiderIndex: number;

  let subject: SealedProviderState;
  let capsuleId: `0x${string}`;
  let snapshotHandle: Handle;
  let liveBalanceHandleAtIssuance: Handle;
  let referenceBalance = 0n;

  const gas: Record<string, string> = {};

  before(async () => {
    h = await deployCurveHarness({ substrate: true });
    s = await deploySettlement(h);

    auditorIndex = ROLE_INDEX.auditor;
    auditor = h.wallets[auditorIndex].account.address as `0x${string}`;
    outsiderIndex = 6;
    outsider = h.wallets[outsiderIndex].account.address as `0x${string}`;

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

    /**
     * TWO PROVIDERS WITH IDENTICAL MANDATES AND IDENTICAL BALANCES.
     *
     * Not incidental. A Nox handle is deterministic in its operands, so two numerically identical
     * allocations disclosed to the same auditor are exactly the case where an unisolated capsule
     * would produce ONE handle with ONE permanent ACL entry — and provider 1 would hold a grant on
     * provider 2's disclosure. Delta R-6 established that the obvious test for this passes with the
     * defence removed, so the assertion is on the HANDLES rather than on the values.
     */
    providers = [
      await setupProvider(h, created.universeId, {
        walletIndex: 1,
        mandate: { marketCaps: [300n * UNIT, 300n * UNIT], minRateIndexes: [0, 0] },
        balance: 1_500n * UNIT,
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
    result = await collectPublicResult(h, epoch.epochId);

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

    quote = await activateQuote(h, s, epoch, created.universe, result, markets, { fund: false });

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

    subject = providers[0] as SealedProviderState;
    referenceBalance = await readSeriesBalance(h, series, subject.walletIndex, subject.address);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 1. the position a capsule will describe
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("1. a provider owns a confidential series balance, and only they can read it", async () => {
    assert.ok(referenceBalance > 0n, "the subject must actually hold a claim");

    // `reserved`, not `allocation`: the lock took what custody could pay, and comparing the wrong
    // one would agree on this fixture and disagree on a short provider.
    const expected = epoch.expected.providers[0]?.reserved;
    assert.ok(expected !== undefined, "the reference model must have allocated to this provider");
    assert.equal(
      referenceBalance,
      expected,
      "the confidential balance must equal the plaintext reference model, exactly",
    );

    liveBalanceHandleAtIssuance = (await series.token.read.confidentialBalanceOf([
      subject.address,
    ])) as Handle;
    const live = await acl(h, liveBalanceHandleAtIssuance, auditor);
    assert.equal(live.canDecrypt, false, "the auditor must hold nothing before any capsule exists");
    assert.equal(live.isPublic, false, "a live balance is never public");
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 2. issuance
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("2. the provider freezes it into a capsule addressed to the auditor", async () => {
    const expiry = BigInt((await h.publicClient.getBlock()).timestamp) + 7n * 24n * 3600n;
    const nonce = (await series.token.read.nextNonce([subject.address])) as bigint;

    const receipt = await mine(
      h,
      await series.token.write.issueOwnershipCapsule([auditor, quote.quoteId, expiry, nonce], {
        account: h.wallets[subject.walletIndex].account,
      }),
    );
    gas["issueOwnershipCapsule"] = String(receipt.gasUsed);

    const ids = (await series.capsules.read.capsulesFor([auditor])) as `0x${string}`[];
    assert.equal(ids.length, 1, "exactly one capsule was issued to the auditor");
    capsuleId = ids[0] as `0x${string}`;

    const capsule = await series.capsules.read.capsuleOf([capsuleId]);
    snapshotHandle = capsule.snapshotHandle as Handle;

    assert.equal(capsule.issued, true);
    assert.equal(Number(capsule.scope), SCOPE.ProviderSeriesOwnership);
    assert.equal((capsule.subject as string).toLowerCase(), subject.address.toLowerCase());
    assert.equal((capsule.recipient as string).toLowerCase(), auditor.toLowerCase());
    assert.equal(capsule.quoteId, quote.quoteId);
    assert.notEqual(snapshotHandle, ZERO_HANDLE, "the capsule must carry a real handle");

    /**
     * THE STRUCTURAL CLAIM, ASSERTED ON HANDLES RATHER THAN ON VALUES.
     *
     * The snapshot's VALUE equals the live balance right now, so a value comparison cannot
     * distinguish "a frozen copy" from "the live handle handed over". The handles must differ, and
     * they do because the snapshot is a `select` output isolated under a capsule-scoped domain.
     */
    assert.notEqual(
      snapshotHandle,
      liveBalanceHandleAtIssuance,
      "the capsule must not be the live balance handle wearing a different name",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 3. the auditor reads exactly what they were given
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("3. the auditor decrypts the frozen snapshot, and it equals the reference model", async () => {
    const client = await clientFor(h, auditorIndex);
    const value = await client.decrypt(snapshotHandle, SUITE_POLL);
    assert.equal(value, referenceBalance, "the capsule discloses the subject's claim, exactly");

    const granted = await acl(h, snapshotHandle, auditor);
    assert.equal(granted.canDecrypt, true, "the auditor holds a grant on the snapshot");
    assert.equal(
      granted.isPublic,
      false,
      "and the snapshot is NOT public — a capsule is a grant to one address, never a publication",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 4. and nothing else
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("4. the auditor cannot decrypt the provider's live balance, before or after it moves", async () => {
    const client = await clientFor(h, auditorIndex);

    await assert.rejects(
      () => client.decrypt(liveBalanceHandleAtIssuance, SUITE_POLL),
      (error: unknown) => {
        // Matched the way the Phase 5 suite matches it. `instanceof NotAuthorisedToDecryptError`
        // was tried first and is wrong here: the suite and `@kyrve/nox` resolve the module through
        // different specifiers, so the class identities differ and a correctly refused decryption
        // fails the check.
        const text = flattenError(error);
        assert.ok(
          /holds no grant|not\s*authoris|not\s*authoriz|forbidden|unauthor/i.test(text),
          `the refusal must be an authorisation refusal, got: ${text}`,
        );
        assert.ok(
          !text.includes(String(referenceBalance)),
          "a refusal must never carry the magnitude it refused",
        );
        return true;
      },
      "the auditor must be refused the live balance handle",
    );

    /**
     * NOW MOVE THE BALANCE, AND RE-READ BOTH.
     *
     * This is what makes demonstration 4 mean something. The subject transfers part of their claim,
     * so `_balances[subject]` becomes a NEW handle. A capsule that tracked the live balance would
     * now decrypt to the reduced amount; a capsule that was secretly the live handle would decrypt
     * to it too. It must decrypt to the ORIGINAL.
     */
    const moved = referenceBalance / 4n;
    assert.ok(moved > 0n, "the fixture must be large enough to move a quarter of it");

    const subjectClient = await clientFor(h, subject.walletIndex);
    const encrypted = await subjectClient.encrypt(
      moved,
      "euint256",
      series.token.address as `0x${string}`,
    );
    await mine(
      h,
      await series.token.write.confidentialTransfer([outsider, encrypted.handle, encrypted.proof], {
        account: h.wallets[subject.walletIndex].account,
      }),
    );

    const liveAfter = (await series.token.read.confidentialBalanceOf([subject.address])) as Handle;
    assert.notEqual(
      liveAfter,
      liveBalanceHandleAtIssuance,
      "a real transfer must rewrite the balance handle — otherwise this test proves nothing",
    );

    const stillFrozen = await client.decrypt(snapshotHandle, SUITE_POLL);
    assert.equal(
      stillFrozen,
      referenceBalance,
      "the capsule is frozen: it still reads the balance as it stood at the snapshot block",
    );

    const subjectNow = await readSeriesBalance(h, series, subject.walletIndex, subject.address);
    assert.equal(subjectNow, referenceBalance - moved, "and the live balance really did move");

    await assert.rejects(
      () => client.decrypt(liveAfter, SUITE_POLL),
      "the auditor must hold nothing on the balance handle the transfer produced",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 5. cross-recipient
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("5. a wallet the capsule was not addressed to cannot decrypt it", async () => {
    const client = await clientFor(h, outsiderIndex);
    await assert.rejects(
      () => client.decrypt(snapshotHandle, SUITE_POLL),
      (error: unknown) => {
        assert.ok(
          !flattenError(error).includes(String(referenceBalance)),
          "a refusal must never carry the magnitude it refused",
        );
        return true;
      },
      "the gateway must refuse a wallet holding no grant on the snapshot",
    );

    const state = await acl(h, snapshotHandle, outsider);
    assert.equal(state.canDecrypt, false, "and the ACL says so independently of the gateway");

    // The contract refuses the same wallet for a different reason, and both refusals matter: the
    // gateway protects the value, the capsule protects the CLAIM that the value belongs to it.
    await assertRevertsWithError(
      () => series.capsules.read.requireRecipient([capsuleId, outsider]),
      series.capsules,
      "WrongRecipient",
      "an outsider presenting someone else's capsule",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 6. public verification
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("6. the capsule's origin and scope verify publicly, from chain state alone", async () => {
    const deploymentId = (await s.registry.read.DEPLOYMENT_ID()) as `0x${string}`;

    await series.capsules.read.requireOrigin([
      capsuleId,
      BigInt(await h.publicClient.getChainId()),
      deploymentId,
      series.seriesId,
    ]);
    await series.capsules.read.requireValid([capsuleId]);
    await series.capsules.read.requireRecipient([capsuleId, auditor]);
    await series.capsules.read.requireHandle([capsuleId, snapshotHandle]);
    await series.capsules.read.requireDecryptable([capsuleId, auditor, snapshotHandle]);

    // The provenance the capsule asserts is checkable against the registry that wrote it, and the
    // capsule could not have been issued without it — `recordOwnershipCapsule` reverts
    // `NoClaimForSubject` for a quote the subject holds no claim on.
    const claim = await series.ownership.read.claimOf([quote.quoteId, subject.address]);
    assert.equal(Number(claim.state), CLAIM_STATE.Allocated);

    const digest = (await series.capsules.read.originDigest([capsuleId])) as `0x${string}`;
    assert.notEqual(digest, `0x${"00".repeat(32)}`, "a capsule commits to a reproducible digest");

    // A capsule from another deployment cannot authenticate here, even on the same chain against
    // the same series and the same Midnight market.
    const chainId = BigInt(await h.publicClient.getChainId());
    await assertRevertsWithError(
      () =>
        series.capsules.read.requireOrigin([
          capsuleId,
          chainId,
          `0x${"ab".repeat(32)}`,
          series.seriesId,
        ]),
      series.capsules,
      "WrongOriginForCapsule",
      "a capsule presented under another deployment id",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 7. the refusals
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("7a. a substituted handle is refused, even when the proof behind it is valid", async () => {
    /**
     * THE SUBSTITUTION THIS EXISTS FOR. The second provider's own snapshot is a REAL handle with a
     * REAL gateway proof — everything about it is valid except which capsule it belongs to. A
     * verifier that accepted "a valid proof exists for this value" would accept it.
     */
    const other = providers[1] as SealedProviderState;
    const expiry = BigInt((await h.publicClient.getBlock()).timestamp) + 7n * 24n * 3600n;
    const otherNonce = (await series.token.read.nextNonce([other.address])) as bigint;
    await mine(
      h,
      await series.token.write.issueOwnershipCapsule([auditor, quote.quoteId, expiry, otherNonce], {
        account: h.wallets[other.walletIndex].account,
      }),
    );

    const ids = (await series.capsules.read.capsulesFor([auditor])) as `0x${string}`[];
    assert.equal(ids.length, 2, "the auditor now holds two capsules");
    const otherCapsuleId = ids[1] as `0x${string}`;
    const otherHandle = (await series.capsules.read.capsuleOf([otherCapsuleId]))
      .snapshotHandle as Handle;

    /**
     * TWO IDENTICAL ALLOCATIONS, TWO HANDLES. Both providers held the same balance and disclosed to
     * the same auditor, so an unisolated capsule would have produced one handle here — and one
     * provider would hold a permanent grant on the other's disclosure. Invariant 9.
     */
    assert.notEqual(
      otherHandle,
      snapshotHandle,
      "two numerically identical capsules to the same recipient must remain two handles",
    );

    await assertRevertsWithError(
      () => series.capsules.read.requireHandle([capsuleId, otherHandle]),
      series.capsules,
      "WrongHandleForCapsule",
      "another capsule's real handle presented against this capsule",
    );
    await assertRevertsWithError(
      () => series.capsules.read.requireDecryptable([capsuleId, auditor, otherHandle]),
      series.capsules,
      "WrongHandleForCapsule",
      "a substituted handle in the combined check",
    );
  });

  it("7b. a replayed issuance is refused, by nonce and by capsule id", async () => {
    const expiry = BigInt((await h.publicClient.getBlock()).timestamp) + 7n * 24n * 3600n;
    const stale = ((await series.token.read.nextNonce([subject.address])) as bigint) - 1n;

    await assertRevertsWithError(
      () =>
        series.token.write.issueOwnershipCapsule([auditor, quote.quoteId, expiry, stale], {
          account: h.wallets[subject.walletIndex].account,
        }),
      series.token,
      "WrongNonce",
      "a replayed capsule issuance",
    );

    // The vault refuses an id it has already sealed, independently of the token's nonce. Two
    // defences, because the nonce is the token's and the id is the record's.
    await assertRevertsWithError(
      () =>
        series.capsules.write.recordOwnershipCapsule(
          [subject.address, auditor, quote.quoteId, expiry, snapshotHandle, 0n],
          { account: h.wallets[subject.walletIndex].account },
        ),
      series.capsules,
      "NotToken",
      "anyone but the series token recording a capsule",
    );
  });

  it("7c. an expiry outside the bound is refused, and an expired capsule stops asserting", async () => {
    const now = BigInt((await h.publicClient.getBlock()).timestamp);
    const nonce = (await series.token.read.nextNonce([subject.address])) as bigint;

    await assertRevertsWithError(
      () =>
        series.token.write.issueOwnershipCapsule([auditor, quote.quoteId, now - 1n, nonce], {
          account: h.wallets[subject.walletIndex].account,
        }),
      series.capsules,
      "ExpiryInThePast",
      "a capsule issued already expired",
    );

    await assertRevertsWithError(
      () =>
        series.token.write.issueOwnershipCapsule(
          [auditor, quote.quoteId, now + 400n * 24n * 3600n, nonce],
          { account: h.wallets[subject.walletIndex].account },
        ),
      series.capsules,
      "ExpiryTooFar",
      "a capsule asserting for longer than ninety days",
    );

    /**
     * A SHORT CAPSULE, THEN TIME PASSES.
     *
     * And then the honest part: the capsule stops ASSERTING and the recipient can still decrypt it.
     * `Nox.allow` is permanent and there is no `removeViewer`. A test that only checked
     * `requireValid` reverting would leave a reader believing expiry revoked something.
     */
    const shortNonce = (await series.token.read.nextNonce([subject.address])) as bigint;
    await mine(
      h,
      await series.token.write.issueOwnershipCapsule(
        [outsider, quote.quoteId, now + 120n, shortNonce],
        { account: h.wallets[subject.walletIndex].account },
      ),
    );
    const outsiderIds = (await series.capsules.read.capsulesFor([outsider])) as `0x${string}`[];
    const shortId = outsiderIds[outsiderIds.length - 1] as `0x${string}`;
    const shortHandle = (await series.capsules.read.capsuleOf([shortId])).snapshotHandle as Handle;

    assert.equal(await series.capsules.read.assertsValidAt([shortId, now]), true);

    await h.publicClient.request({ method: "evm_increaseTime" as never, params: [300] as never });
    await h.publicClient.request({ method: "evm_mine" as never, params: [] as never });

    await assertRevertsWithError(
      () => series.capsules.read.requireValid([shortId]),
      series.capsules,
      "CapsuleExpired",
      "an expired capsule still asserting its scope",
    );

    const stillReadable = await (await clientFor(h, outsiderIndex)).decrypt(
      shortHandle,
      SUITE_POLL,
    );
    assert.ok(
      stillReadable >= 0n,
      "EXPIRY IS NOT REVOCATION: the recipient can still decrypt the snapshot, and the UI must " +
        "say 'live access ended', never 'access revoked'",
    );
  });

  it("7d. a public-scope capsule is curator-only, and freezes facts it read rather than facts it was told", async () => {
    const now = BigInt((await h.publicClient.getBlock()).timestamp);

    await assertRevertsWithError(
      () =>
        series.capsules.write.issuePublicCapsule(
          [SCOPE.SolvencyState, auditor, quote.quoteId, now + 3600n],
          { account: h.wallets[outsiderIndex].account },
        ),
      series.capsules,
      "NotCurator",
      "an outsider issuing a public capsule",
    );

    await assertRevertsWithError(
      () =>
        series.capsules.write.issuePublicCapsule(
          [SCOPE.ProviderSeriesOwnership, auditor, quote.quoteId, now + 3600n],
          { account: series.curator.account },
        ),
      series.capsules,
      "ScopeRequiresAHandle",
      "an ownership capsule issued through the public door",
    );

    const before = await series.solvency.read.publicCoverage();
    const receipt = await mine(
      h,
      await series.capsules.write.issuePublicCapsule(
        [SCOPE.SolvencyState, auditor, quote.quoteId, now + 3600n],
        { account: series.curator.account },
      ),
    );
    gas["issuePublicCapsule"] = String(receipt.gasUsed);

    const ids = (await series.capsules.read.capsulesFor([auditor])) as `0x${string}`[];
    const publicId = ids[ids.length - 1] as `0x${string}`;
    const facts = await series.capsules.read.factsOf([publicId]);

    assert.equal(facts.publicCoverage, before[4], "the frozen coverage is the coverage it read");
    assert.equal(facts.midnightCredit, before[0], "and the credit term, unaltered");
    assert.equal(
      facts.aggregateFillAmount,
      result.aggregateFillAmount,
      "the frozen aggregate is the epoch's published aggregate, not the units and not the assets",
    );

    // A scope carrying no handle must say so rather than compare against zero and pass.
    await assertRevertsWithError(
      () => series.capsules.read.requireHandle([publicId, snapshotHandle]),
      series.capsules,
      "ScopeCarriesNoHandle",
      "a handle presented against a public-scope capsule",
    );
  });

  it("records the capsule gas, for the Sepolia budget", () => {
    mkdirSync(new URL("../../evidence/phase6/", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("../../evidence/phase6/capsule-gas.json", import.meta.url),
      `${JSON.stringify(gas, null, 2)}\n`,
    );
    assert.ok(Object.keys(gas).length >= 2, "both issuance doors must have been measured");
  });
});
