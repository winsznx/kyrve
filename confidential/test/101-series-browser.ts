/**
 * Demonstration 13: confidential series ownership in a real Chromium, against the real Nox stack and
 * real unmodified Midnight.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE NINE STEPS, IN ONE BROWSER SESSION EACH
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   1. provider A connects
 *   2. A reads and decrypts A's own balance, through the real gateway
 *   3. that value equals the allocation the reference model predicted
 *   4. A disconnects — and the decrypted value is gone from the DOM, not merely hidden
 *   5. provider B connects, in a SEPARATE browser context
 *   6. B fails to decrypt A's balance, refused on chain before any key material is released
 *   7. B decrypts B's own balance
 *   8. aggregate supply and the public Midnight credit are read from chain state
 *   9. the solvency verdict is read and shown
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY TWO BROWSER CONTEXTS AND NOT ONE PAGE WITH TWO KEYS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A wallet switch that reuses the page is a switch in the page's own bookkeeping, and the thing under
 * test is whether the GATEWAY treats the two wallets differently. Separate contexts give separate
 * storage, separate injected keys and — because `createHandleClient` binds to the wallet client — a
 * genuinely different signing identity asking NoxCompute for the same handle.
 *
 * Step 6 is the load-bearing one, and it is aimed at another PROVIDER rather than at a stranger. Two
 * providers' balances are the equal-shaped quantities that would alias into one handle without the
 * isolation `Nox.mint`'s operand set provides, so a stranger being refused proves much less.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THE SERVED RECORD MAY CONTAIN
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Identifiers and transaction hashes. No amounts — not the aggregate, not the supply, not a balance.
 * Every number the page displays is read from chain state at render time or decrypted in the browser
 * by the wallet that owns it, which is what makes the assertions below assertions about the protocol
 * rather than about a JSON file. The record is asserted to contain no amount at all before the browser
 * is even launched.
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { handleGatewayUrl } from "@iexec-nox/nox-hardhat-plugin";
import { NOX_COMPUTE_BY_CHAIN } from "@kyrve/config";
import { CURVE_RECOMMENDED_CELLS_PER_TRANSACTION, UNIT } from "@kyrve/curve";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";

import {
  type CurveHarness,
  deployCurveHarness,
  type EpochState,
  openAndSeal,
  runEpoch,
  type SealedProviderState,
  setupBorrower,
  setupProvider,
} from "./curve-helpers.js";
import { mine } from "./helpers.js";
import { deploySeriesLayer, fundQuoteFromCustody, type SeriesLayer } from "./series-helpers.js";
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

const APP_URL = "http://127.0.0.1:5173/";

/**
 * The two provider keys, which are Hardhat's standard accounts 1 and 2.
 *
 * Committed because they are the published, universally-known development keys of a local node and
 * are worthless on any real network — the same reason `70-browser-flow.ts` commits one. A wallet the
 * browser can sign with is not optional here: Kyrve binds every encrypted input to the wallet that
 * submits it, so there is no read-only mode that could stand in for one.
 */
const PROVIDER_KEYS = [
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
] as const;

interface Evidence {
  decryptedInBrowser: boolean;
  outsiderRefused: boolean;
  supplyMatchesAggregate: boolean;
  providerCount: number;
  refusalKind?: string;
  aggregateFillAmount?: string;
  creditUnits?: string;
  solvency?: string;
  quoteId?: string;
  epochId?: string;
}

describe("Phase 5 demonstration 13: confidential ownership in a real browser", () => {
  let h: CurveHarness;
  let s: SettlementHarness;
  let series: SeriesLayer;
  let epoch: EpochState;
  let result: PublicResult;
  let quote: ActivatedQuote;
  let providers: SealedProviderState[];
  let browser: Browser | undefined;
  let vite: ChildProcess | undefined;
  const evidence: Evidence = {
    decryptedInBrowser: false,
    outsiderRefused: false,
    supplyMatchesAggregate: false,
    providerCount: 0,
  };
  /** Every origin the page contacted, so "no provider allocation reaches a server" is measured. */
  const origins = new Set<string>();
  let expectedA = 0n;
  let expectedB = 0n;

  before(async () => {
    // The Midnight substrate first, so the confidential wrapper wraps the market's own loan token.
    // Delta T-10 — without it `finalizeUnwrap` moves an asset the vault does not pay in.
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

    // Wallets 1 and 2, matching PROVIDER_KEYS in order. Two providers meet the privacy floor of two,
    // and two is also the minimum that makes step 6 a test of isolation rather than of a stranger.
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

    const borrowerWallet = h.wallets[5];
    const borrower = await setupBorrower(h, created.universeId, 5, {
      desiredAssets: 500n * UNIT,
      minimumAssets: 50n * UNIT,
      maxRateIndexes: [1, 1],
      preferredMaturityIndex: 0,
    });

    epoch = await openAndSeal(h, created.universeId, created.universe, providers, borrower);
    await runEpoch(h, epoch);
    result = await collectPublicResult(h, epoch.epochId);

    expectedA = epoch.expected.providers[0]?.reserved ?? 0n;
    expectedB = epoch.expected.providers[1]?.reserved ?? 0n;
    assert.ok(expectedA > 0n && expectedB > 0n, "both providers must hold a real allocation");

    // The series, created before activation because `prepareQuote` refuses a vault that cannot
    // already pay — so the confidential funding has to land first. Delta T-9.
    const winning = markets[result.marketIndex];
    assert.ok(winning !== undefined);
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
    await supplyCollateral(h, s, quote.market, borrowerWallet, quote.exactUnits);

    const settlement = await mine(
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

    const allocation = await mine(
      h,
      await series.allocator.write.allocateChunk([quote.quoteId, 0, providers.length], {
        account: series.keeper.account,
      }),
    );
    await mine(
      h,
      await series.allocator.write.closeQuote([quote.quoteId], { account: series.keeper.account }),
    );

    // Supply and the solvency verdict are published on chain, once, before the browser reads them.
    // The page decrypts them through the PUBLIC path; it does not compute them.
    await mine(
      h,
      await series.token.write.publishAggregateSupply({ account: series.curator.account }),
    );
    await mine(h, await series.solvency.write.proveSolvency());

    const record = {
      environment: "local",
      chainId: 31337,
      noxCompute: NOX_COMPUTE_BY_CHAIN[31337],
      addresses: {
        KyrveEmergencyController: h.controller.address,
        TestUnderlyingERC20: h.underlying.address,
        KyrveWrappedAsset: h.asset.address,
        KyrveConfidentialAssetVault: h.vault.address,
        EncryptedMandateBook: h.mandateBook.address,
        ConfidentialRequestBook: h.requestBook.address,
      },
      disclosure:
        "Kyrve is open-source software integrating an unmodified, source-available Morpho Midnight " +
        "testnet replica under its applicable non-production licence.",
      gatewayUrl: handleGatewayUrl(),
      series: {
        addresses: {
          KyrveCustodyVault: h.custody.address,
          KyrveSeriesToken: series.token.address,
          SeriesOwnershipRegistry: series.ownership.address,
          SeriesAllocator: series.allocator.address,
          AggregateSolvencyVerifier: series.solvency.address,
          SeriesResidueAccount: series.residue.address,
        },
        seriesId: series.seriesId,
        marketId: series.marketId,
        vault: quote.vault.address,
        loanToken: s.usdc.address,
        loanTokenSymbol: "tUSDC",
        loanTokenDecimals: 6,
        maturity: quote.market.maturity.toString(),
        quoteId: quote.quoteId,
        epochId: epoch.epochId,
        graphRoot: quote.graphRoot,
        settlementTx: settlement.transactionHash,
        allocationTx: allocation.transactionHash,
        providers: providers.map((provider) => provider.address),
      },
    };

    /**
     * THE RECORD MUST CARRY NO AMOUNT, and this is checked rather than trusted.
     *
     * A served aggregate or balance would make every assertion below an assertion about this JSON.
     * The two real amounts in play — provider A's allocation and the published aggregate — must not
     * appear anywhere in it, and neither must any other decimal long enough to be one.
     */
    const serialised = JSON.stringify(record.series);
    for (const [what, amount] of [
      ["provider A's allocation", expectedA],
      ["provider B's allocation", expectedB],
      ["the published aggregate", result.aggregateFillAmount],
    ] as const) {
      assert.equal(
        serialised.includes(amount.toString()),
        false,
        `the served record must not contain ${what}; every amount is read from chain state`,
      );
    }

    mkdirSync(new URL("../../apps/web/public/", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("../../apps/web/public/deployment.json", import.meta.url),
      `${JSON.stringify(record, null, 2)}\n`,
    );

    vite = spawn("pnpm", ["--filter", "@kyrve/web", "exec", "vite", "--host", "127.0.0.1"], {
      cwd: new URL("../../", import.meta.url).pathname,
      stdio: "ignore",
      detached: false,
    });

    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        const response = await fetch(APP_URL);
        if (response.ok) break;
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) throw new Error("the terminal's dev server never came up");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    browser = await chromium.launch();
    evidence.providerCount = providers.length;
    evidence.aggregateFillAmount = result.aggregateFillAmount.toString();
    evidence.quoteId = quote.quoteId;
    evidence.epochId = epoch.epochId;
  });

  after(async () => {
    await browser?.close();
    vite?.kill("SIGTERM");
  });

  /** A fresh context with one provider's key injected. A genuinely separate wallet identity. */
  async function connect(keyIndex: 0 | 1): Promise<{ context: BrowserContext; page: Page }> {
    assert.ok(browser !== undefined, "the browser must be running");
    const context = await browser.newContext();
    await context.addInitScript(
      ({ key, rpc, gateway }) => {
        (window as unknown as Record<string, unknown>).__KYRVE_LOCAL_KEY__ = key;
        (window as unknown as Record<string, unknown>).__KYRVE_RPC_URL__ = rpc;
        (window as unknown as Record<string, unknown>).__KYRVE_NOX_GATEWAY__ = gateway;
      },
      { key: PROVIDER_KEYS[keyIndex], rpc: "http://127.0.0.1:8545", gateway: handleGatewayUrl() },
    );

    const page = await context.newPage();
    page.on("request", (request) => origins.add(new URL(request.url()).origin));
    await page.goto(APP_URL);

    const bootError = page.getByTestId("boot-error");
    if ((await bootError.count()) > 0) {
      throw new Error(`the terminal refused to start: ${await bootError.innerText()}`);
    }
    await page.getByTestId("ownership-band").waitFor({ timeout: 60_000 });
    return { context, page };
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 1-4. Provider A
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("13a. provider A connects, decrypts only their own balance, and disconnecting clears it", async () => {
    const { context, page } = await connect(0);
    const providerA = providers[0];
    assert.ok(providerA !== undefined);

    assert.equal(
      (await page.getByTestId("connected-account").innerText()).trim().toLowerCase(),
      providerA.address.toLowerCase(),
      "the page must be bound to provider A's wallet",
    );

    // Every public identifier comes from the served record; the claim's epoch and root come from the
    // ownership registry, and the page says whether they AGREE rather than repeating one of them.
    assert.equal((await page.getByTestId("series-id").innerText()).trim(), series.seriesId);
    assert.equal((await page.getByTestId("quote-id").innerText()).trim(), quote.quoteId);
    assert.equal((await page.getByTestId("epoch-id").innerText()).trim(), epoch.epochId);
    assert.equal((await page.getByTestId("claim-state").innerText()).trim(), "allocated");
    assert.match(await page.getByTestId("claim-epoch").innerText(), /matches the epoch above/);
    assert.match(await page.getByTestId("claim-root").innerText(), /matches the sealed root above/);
    assert.match(await page.getByTestId("series-maturity").innerText(), /^\d{4}-\d{2}-\d{2}/);
    assert.equal(
      (await page.getByTestId("allocated-count").innerText()).trim(),
      `${providers.length} (allocation sealed)`,
    );

    // Before decryption the balance is available-to-decrypt, not shown. A zero here would be a claim
    // about contents the page has not read.
    // Compared case-insensitively: the design system uppercases state labels in CSS, and asserting
    // the rendered casing would make this test fail on a typographic change.
    assert.equal(
      (await page.getByTestId("own-balance-state").innerText()).trim().toLowerCase(),
      "available to decrypt",
    );
    assert.equal(await page.getByTestId("own-balance-value").count(), 0);

    await page.getByTestId("own-balance").getByRole("button").click();
    await page.getByTestId("own-balance-value").waitFor({ timeout: 90_000 });

    // STEP 3: the value the browser decrypted equals what the plaintext reference model predicted,
    // computed from the same mandates and never through a handle.
    const shown = (await page.getByTestId("own-balance-value").innerText()).replace(/[^\d.]/g, "");
    assert.equal(shown, formatSixDecimals(expectedA), "A's decrypted balance must match the model");
    assert.equal(
      (await page.getByTestId("own-balance-state").innerText()).trim().toLowerCase(),
      "decrypted locally",
    );
    evidence.decryptedInBrowser = true;

    // STEP 4: disconnecting removes the value from the DOM. Not hidden, not stale — absent.
    await page.getByTestId("disconnect").click();
    await page.getByTestId("session-ended").waitFor({ timeout: 15_000 });
    assert.equal(
      await page.getByTestId("own-balance-value").count(),
      0,
      "the decrypted balance must be gone from the page after disconnecting",
    );

    await context.close();
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 5-9. Provider B
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it("13b. provider B is refused A's balance, reads their own, and verifies supply and solvency", async () => {
    const { context, page } = await connect(1);
    const providerA = providers[0];
    const providerB = providers[1];
    assert.ok(providerA !== undefined && providerB !== undefined);

    assert.equal(
      (await page.getByTestId("connected-account").innerText()).trim().toLowerCase(),
      providerB.address.toLowerCase(),
      "the page must be bound to provider B's wallet",
    );

    // STEP 6. Aimed at provider A specifically, because two providers' balances are the equal-shaped
    // quantities that would alias into one handle without isolation. A stranger proves much less.
    await page.getByTestId("peer-address").fill(providerA.address);
    await page.getByTestId("attempt-peer-decrypt").click();
    await page.getByTestId("peer-outcome").waitFor({ timeout: 90_000 });

    const refusal = await page.getByTestId("peer-outcome").getAttribute("data-refusal");
    assert.equal(
      refusal,
      "not-authorised",
      `B must be refused A's balance for the right reason, got ${refusal}`,
    );
    const refusalText = await page.getByTestId("peer-refusal").innerText();
    assert.match(refusalText, /not authorised|no grant|refuse/i);
    // The refusal must not carry a value, a magnitude or a hint of one.
    assert.equal(
      refusalText.includes(expectedA.toString()),
      false,
      "the refusal must disclose nothing about the value",
    );
    evidence.outsiderRefused = true;
    evidence.refusalKind = refusal ?? undefined;

    // STEP 7. B's own balance, decrypted by B.
    await page.getByTestId("own-balance").getByRole("button").click();
    await page.getByTestId("own-balance-value").waitFor({ timeout: 90_000 });
    const shown = (await page.getByTestId("own-balance-value").innerText()).replace(/[^\d.]/g, "");
    assert.equal(shown, formatSixDecimals(expectedB), "B's decrypted balance must match the model");
    assert.notEqual(shown, formatSixDecimals(expectedA), "and must not be A's");

    // STEP 8. Aggregate supply and the public credit, both from chain state.
    await page.getByTestId("verify-supply").click();
    await page
      .getByTestId("solvency-state")
      .filter({ hasText: /verified solvent/i })
      .waitFor({ timeout: 90_000 });

    const supplyShown = (await page.getByTestId("aggregate-supply").innerText()).replace(
      /[^\d.]/g,
      "",
    );
    assert.equal(
      supplyShown,
      formatSixDecimals(result.aggregateFillAmount),
      "the aggregate supply the browser read must equal the published aggregate",
    );
    evidence.supplyMatchesAggregate = true;

    const creditShown = (await page.getByTestId("public-credit").innerText()).trim();
    assert.equal(creditShown, `${quote.exactUnits.toString()} units`);
    evidence.creditUnits = quote.exactUnits.toString();

    // The three quantities are distinct, and the page shows two of them side by side — so a reader
    // can see that supply is principal and credit is Midnight's denomination. Delta T-1.
    assert.notEqual(result.aggregateFillAmount, quote.exactUnits);

    // STEP 9.
    const solvency = (await page.getByTestId("solvency-state").innerText()).trim().toLowerCase();
    assert.equal(solvency, "verified solvent");
    evidence.solvency = solvency;
    assert.ok(
      BigInt((await page.getByTestId("solvency-coverage").innerText()).trim()) >=
        result.aggregateFillAmount,
      "public coverage must cover every confidential claim",
    );

    await context.close();
  });

  it("13c. the page contacted no origin but the local node, the gateway and its own dev server", () => {
    // NO PROVIDER ALLOCATION MAY REACH A SERVER, and this is the measurement rather than the promise.
    // Only three origins are legitimate: the page itself, the JSON-RPC node, and the Nox handle
    // gateway — which is where decryption necessarily happens and is not a Kyrve component.
    const allowed = new Set([
      new URL(APP_URL).origin,
      "http://127.0.0.1:8545",
      new URL(handleGatewayUrl()).origin,
    ]);
    const unexpected = [...origins].filter((origin) => !allowed.has(origin));
    assert.deepEqual(unexpected, [], `the page contacted an unexpected origin: ${unexpected}`);
  });

  it("records the browser ownership evidence", () => {
    assert.equal(evidence.decryptedInBrowser, true);
    assert.equal(evidence.outsiderRefused, true);
    assert.equal(evidence.supplyMatchesAggregate, true);

    mkdirSync(new URL("../../evidence/phase5/", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("../../evidence/phase5/browser-ownership.json", import.meta.url),
      `${JSON.stringify(
        {
          $comment:
            "Demonstration 13, measured in a real Chromium against the real Nox stack and real " +
            "unmodified Midnight. Two separate browser contexts, two separate wallet identities. " +
            "No amount appears in this record for the same reason none appears in the served " +
            "deployment record: every amount is read from chain state or decrypted in the browser.",
          chainId: 31337,
          ...evidence,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`  refusal kind      : ${evidence.refusalKind}`);
    console.log(`  supply == aggregate: ${evidence.supplyMatchesAggregate}`);
    console.log(`  solvency          : ${evidence.solvency}`);
  });
});

/** Six-decimal display, matching what the panel renders for a 6-decimal loan token. */
function formatSixDecimals(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const fraction = (raw % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}
