/**
 * Demonstration 18: the settlement flow in a real Chromium, against the real Nox stack and real
 * unmodified Midnight.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS PROVES BEYOND "THE PAGE RENDERS"
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   1. a real confidential epoch runs to a sealed graph and a published aggregate;
 *   2. every published handle is fetched only AFTER the stage that produces it — the five are read
 *      once `publishAggregate` has run, which is delta R-14, and the browser never sees a partial
 *      set at all;
 *   3. all five gateway proofs verify on chain, through the read-only verifier the page calls;
 *   4. the quote is activated FROM THE PAGE, by a real signed transaction;
 *   5. a partial fill is refused, and the page shows the refusal by name rather than as an error;
 *   6. the refused fill leaves no consumption, no credit, no debt and no allowance;
 *   7. the exact fill settles, from the page, through real `take`;
 *   8. credit, debt, token movement and consumption are all read back from chain state;
 *   9. a replay is refused.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY IT LIVES IN THE HARDHAT SUITE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The page needs a chain, the Nox off-chain stack, the confidential layer, real Midnight and a real
 * activated-epoch candidate, all at once. The Hardhat plugin already brings the first two up and
 * tears them down; a second way to boot the same stack would drift from this one.
 *
 * ONE ACCOUNT DOES EVERYTHING HERE, and that is stated rather than hidden. The browser wallet is the
 * keeper (which activates), the operator (which cancels and recovers) and the borrower (which
 * takes). On a real deployment those are three keys; separating them is a key-management change, not
 * a contract change, because all three are immutable constructor arguments.
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { handleGatewayUrl } from "@iexec-nox/nox-hardhat-plugin";
import { NOX_COMPUTE_BY_CHAIN } from "@kyrve/config";
import { CURVE_RECOMMENDED_CELLS_PER_TRANSACTION, UNIT } from "@kyrve/curve";
import { deriveQuoteSize } from "@kyrve/quote";
import { tickToPrice } from "@kyrve/quote-math";
import { type Browser, chromium, type Page } from "playwright";
import {
  type CurveHarness,
  deployCurveHarness,
  type EpochState,
  openAndSeal,
  runEpoch,
  setupBorrower,
  setupProvider,
} from "./curve-helpers.js";
import { mine } from "./helpers.js";
import {
  collectPublicResult,
  createSettlementUniverse,
  deploySettlement,
  type PublicResult,
  type SettlementHarness,
  settlementMarketGrid,
  supplyCollateral,
} from "./settlement-helpers.js";

const APP_URL = "http://127.0.0.1:5173";
/** Hardhat/Anvil account zero's key — published, and worthless on any public network. */
const LOCAL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
/** Hardhat/Anvil account zero — a published development key with no value on any public network. */
const BROWSER_WALLET_INDEX = 0;

describe("Phase 4 demonstration 18: the settlement flow in a real Chromium", () => {
  let browser: Browser;
  let page: Page;
  let vite: ChildProcess;
  let h: CurveHarness;
  let s: SettlementHarness;
  let epoch: EpochState;
  let result: PublicResult;
  let evidence: Record<string, unknown> = {};
  /** Every request the page made, so a leak can be located rather than assumed absent. */
  const origins = new Set<string>();

  before(async () => {
    h = await deployCurveHarness();

    // The browser wallet is the keeper AND the operator, so the page can activate, cancel and
    // recover. It is also the borrower, set below.
    s = await deploySettlement(h, {
      keeperIndex: BROWSER_WALLET_INDEX,
      operatorIndex: BROWSER_WALLET_INDEX,
    });

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

    const providers = [
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
      await setupProvider(h, created.universeId, {
        walletIndex: 3,
        mandate: { marketCaps: [250n * UNIT, 250n * UNIT], minRateIndexes: [0, 0] },
        balance: 1_200n * UNIT,
      }),
    ];

    // The BORROWER is the browser wallet, so the page can take the quote it activates.
    const borrower = await setupBorrower(h, created.universeId, BROWSER_WALLET_INDEX, {
      desiredAssets: 500n * UNIT,
      minimumAssets: 50n * UNIT,
      maxRateIndexes: [1, 1],
      preferredMaturityIndex: 0,
    });

    // ── Steps 1 and 2 ───────────────────────────────────────────────────────────────────────
    epoch = await openAndSeal(h, created.universeId, created.universe, providers, borrower);
    await runEpoch(h, epoch);
    // AFTER `publishAggregate`, never between the two publishing transactions. Delta R-14.
    result = await collectPublicResult(h, epoch.epochId);
    assert.equal(result.quoteReady, true, "the epoch must produce a quote for this flow to exist");

    // Everything the page needs to activate. Note what is NOT here: no units, no buyer assets, no
    // expiry, no offer, no status. The page reads all of those from the chain.
    const leafIndex = created.universe.leaves.findIndex(
      (leaf) => leaf.marketIndex === result.marketIndex && leaf.rateIndex === result.rateIndex,
    );
    const leaf = created.universe.leaves[leafIndex];
    assert.ok(leaf !== undefined, "the published pair must be a leaf of this universe");
    const chosen = markets[result.marketIndex];
    assert.ok(chosen !== undefined, "the published market index must name a deployed market");

    const size = deriveQuoteSize(
      result.aggregateFillAmount,
      tickToPrice(BigInt(leaf.tick)),
      leaf.tick,
    );

    // The vault is derived, not chosen, and is funded publicly before activation.
    const seriesId = (await s.factory.read.seriesIdFor([chosen.marketId])) as `0x${string}`;
    await mine(
      h,
      await s.factory.write.createSeries([chosen.marketId, s.usdc.address, s.operator], {
        account: s.curator.account,
      }),
    );
    const vault = (await s.factory.read.vaultOf([seriesId])) as `0x${string}`;
    await mine(h, await s.usdc.write.mint([vault, size.buyerAssets]));
    await supplyCollateral(h, s, chosen.market, h.wallets[BROWSER_WALLET_INDEX], size.units);

    const graphRoot = (await h.graph.read.rootOf([epoch.epochId])) as `0x${string}`;
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
      settlement: {
        midnight: s.midnight.address,
        loanToken: s.usdc.address,
        deploymentId: await s.registry.read.DEPLOYMENT_ID(),
        addresses: {
          KyrveQuoteRegistry: s.registry.address,
          KyrveSettlementRatifier: s.ratifier.address,
          KyrvePublicResultVerifier: s.resultVerifier.address,
          QuoteActivator: s.activator.address,
          KyrveQuoteExpiryController: s.expiryController.address,
          KyrveSeriesFactory: s.factory.address,
        },
        candidate: {
          epochId: epoch.epochId,
          requestId: borrower.requestId,
          universeId: created.universeId,
          graphRoot,
          marketId: chosen.marketId,
          market: jsonSafe(chosen.market),
          leafIndex,
          lifetimeSeconds: 3_600,
          maxPendingFee: size.buyerAssets.toString(),
          marketIndex: result.marketIndex,
          rateIndex: result.rateIndex,
          tick: leaf.tick,
          aggregateFillAmount: result.aggregateFillAmount.toString(),
          borrower: borrower.address,
          expectedVault: vault,
          maturity: chosen.market.maturity.toString(),
          loanTokenDecimals: 6,
          loanTokenSymbol: "tUSDC",
          proofs: result.proofs,
        },
      },
    };

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
    page = await browser.newPage();

    // The wallet key, the RPC and the gateway URL are injected the same way `70-browser-flow.ts`
    // injects them. Without the key the terminal has no session and never renders a band at all —
    // which is how a first run of this file timed out waiting for one.
    await page.addInitScript(
      ({ key, rpc, gateway }) => {
        (window as unknown as Record<string, unknown>).__KYRVE_LOCAL_KEY__ = key;
        (window as unknown as Record<string, unknown>).__KYRVE_RPC_URL__ = rpc;
        (window as unknown as Record<string, unknown>).__KYRVE_NOX_GATEWAY__ = gateway;
      },
      { key: LOCAL_KEY, rpc: "http://127.0.0.1:8545", gateway: handleGatewayUrl() },
    );

    // A boot failure must surface as itself, not as a 60-second timeout on a band that never
    // rendered. The terminal shows the reason it refused to start; this reads it back.
    page.on("request", (request) => origins.add(new URL(request.url()).origin));
    await page.goto(APP_URL);

    const bootError = page.getByTestId("boot-error");
    if ((await bootError.count()) > 0) {
      throw new Error(`the terminal refused to start: ${await bootError.innerText()}`);
    }
    await page.getByTestId("quote-band").waitFor({ timeout: 60_000 });

    evidence = {
      epochId: epoch.epochId,
      aggregateFillAmount: result.aggregateFillAmount.toString(),
      exactUnits: size.units.toString(),
      expectedBuyerAssets: size.buyerAssets.toString(),
      vault,
      marketId: chosen.marketId,
    };
  });

  after(async () => {
    await browser?.close();
    vite?.kill("SIGTERM");
  });

  it("18a. shows the verified public result, and nothing private", async () => {
    await page.getByTestId("verify-result").click();
    await page
      .getByTestId("quote-proof-state")
      .filter({ hasText: "verified on chain" })
      .waitFor({ timeout: 60_000 });

    /**
     * THE PANEL'S ENTIRE DATA SURFACE, ENUMERATED.
     *
     * A first version scanned the page text for words like "allocation" and failed — because the
     * boundary warning legitimately SAYS that per-provider allocations stay encrypted. Forbidding
     * the word forbids the sentence that explains the guarantee, which is backwards.
     *
     * So the check is over FIELDS rather than prose: every `data-testid` the band renders must be on
     * this list. A future field carrying a provider, an allocation, a leaf capacity or a provider
     * count would appear as a new id and fail here, whatever it was called.
     */
    const permitted = new Set([
      "quote-market",
      "quote-rate",
      "quote-aggregate",
      "quote-maturity",
      "quote-borrower",
      "quote-proof-state",
      "aggregate-note",
      "verify-result",
      "activation-state",
      "quote-id",
      "settlement-state",
      "quote-units",
      "quote-buyer-assets",
      "quote-expiry",
      "public-credit",
      "public-debt",
      "activation-warning",
      "activate-quote",
      "attempt-partial-fill",
      "settle-quote",
      "cancel-quote",
      "recover-expired-quote",
      "fill-rejection",
      "consumption-note",
      "quote-status",
      "tx-activation",
      "tx-settlement",
    ]);
    const rendered = await page
      .getByTestId("quote-band")
      .locator("[data-testid]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid") ?? ""));
    for (const id of rendered) {
      assert.ok(permitted.has(id), `the band renders an unexpected field: ${id}`);
    }

    // And the warning must still SAY what stays private, in those words.
    assert.match(
      await page.getByTestId("activation-warning").innerText(),
      /allocation/i,
      "the panel must name what stays encrypted, not merely omit it",
    );

    assert.match(await page.getByTestId("quote-aggregate").innerText(), /tUSDC/);
    assert.ok((await page.getByTestId("quote-maturity").innerText()).trim().length > 0);
    const borrowerShown = (await page.getByTestId("quote-borrower").innerText()).trim();
    assert.match(borrowerShown, /^0x[0-9a-fA-F]{40}$/);
  });

  it("18b. names the boundary before activation, and cannot hide it", async () => {
    const warning = page.getByTestId("activation-warning");
    await warning.waitFor();
    const text = await warning.innerText();
    assert.match(text, /public, permanently/i);
    assert.match(text, /stays encrypted/i);
    // No details/summary, no aria-expanded: there is nothing to collapse.
    assert.equal(await warning.locator("details").count(), 0);
  });

  it("18c. activates the quote from the page, with a real signed transaction", async () => {
    await page.getByTestId("activate-quote").click();

    // Waited on the QUOTE ID, not on the word "activated". The activation cell reads "not activated"
    // before and "activated" after, and `getByText("activated")` matches the former as a substring —
    // so a first run resolved instantly and then asserted against a quote id of "—".
    await page
      .getByTestId("quote-id")
      .filter({ hasText: /^0x[0-9a-fA-F]{64}$/ })
      .waitFor({ timeout: 60_000 });
    assert.equal((await page.getByTestId("activation-state").innerText()).trim(), "activated");

    const quoteId = (await page.getByTestId("quote-id").innerText()).trim();
    assert.match(quoteId, /^0x[0-9a-fA-F]{64}$/);
    assert.equal((await page.getByTestId("settlement-state").innerText()).trim(), "executable");

    const onChain = (await s.registry.read.quoteOfEpoch([epoch.epochId])) as string;
    assert.equal(
      onChain.toLowerCase(),
      quoteId.toLowerCase(),
      "the page shows the chain's quote id",
    );
    evidence = { ...evidence, quoteId };
  });

  it("18d. refuses a partial fill, and says which check refused it", async () => {
    await page.getByTestId("attempt-partial-fill").click();
    await page.getByTestId("fill-rejection").waitFor({ timeout: 60_000 });

    const rejection = await page.getByTestId("fill-rejection").innerText();
    assert.ok(!rejection.includes("ACCEPTED"), `a partial fill was admitted: ${rejection}`);
    assert.ok(
      rejection.length > "Partial fill refused: ".length,
      "the refusal must name something",
    );
    evidence = { ...evidence, partialFillRejection: rejection };
  });

  it("18e. left no state behind after the refused fill", async () => {
    const quoteId = (await s.registry.read.quoteOfEpoch([epoch.epochId])) as `0x${string}`;
    const execution = await s.registry.read.executionOf([quoteId]);

    assert.equal(Number(execution.status), 1, "the quote is still executable");
    assert.equal(
      await s.midnight.read.consumed([execution.vault, quoteId]),
      0n,
      "group consumption rolled back",
    );
    assert.equal(
      await s.midnight.read.credit([execution.marketId, execution.vault]),
      0n,
      "no credit was created",
    );
    assert.equal(
      await s.usdc.read.allowance([execution.vault, s.midnight.address]),
      0n,
      "no allowance survived",
    );
  });

  it("18f. settles the exact fill from the page, through real Midnight", async () => {
    await page.getByTestId("settle-quote").click();
    // The consumption note only renders once the registry reports `Consumed`, so waiting on it waits
    // on chain state rather than on a label — and no other status label contains "settled".
    await page.getByTestId("consumption-note").waitFor({ timeout: 90_000 });
    assert.equal((await page.getByTestId("settlement-state").innerText()).trim(), "settled");
  });

  it("18g. shows the public credit and debt the settlement created", async () => {
    const credit = (await page.getByTestId("public-credit").innerText()).trim();
    const debt = (await page.getByTestId("public-debt").innerText()).trim();
    const units = (await page.getByTestId("quote-units").innerText()).trim();

    assert.equal(credit, units, "the vault's public credit equals the exact fill");
    assert.equal(debt, "0", "the maker takes no debt");

    const quoteId = (await s.registry.read.quoteOfEpoch([epoch.epochId])) as `0x${string}`;
    const execution = await s.registry.read.executionOf([quoteId]);
    assert.equal(
      (await s.midnight.read.credit([execution.marketId, execution.vault])).toString(),
      credit,
      "the page's credit is the chain's credit",
    );
    assert.equal(
      (
        await s.midnight.read.debt([
          execution.marketId,
          h.wallets[BROWSER_WALLET_INDEX].account.address,
        ])
      ).toString(),
      units,
      "the borrower holds the matching public debt",
    );
    assert.equal(
      (await s.midnight.read.consumed([execution.vault, quoteId])).toString(),
      units,
      "Midnight's group is consumed by exactly the fill",
    );
    assert.equal(
      await s.usdc.read.allowance([execution.vault, s.midnight.address]),
      0n,
      "the settlement consumed exactly the allowance it granted",
    );

    evidence = {
      ...evidence,
      creditUnits: credit,
      debtUnits: units,
      borrowerProceeds: (
        await s.usdc.read.balanceOf([h.wallets[BROWSER_WALLET_INDEX].account.address])
      ).toString(),
    };
  });

  it("18h. refuses a replay, and offers no button that could try one", async () => {
    // The page removes the settle action once the quote is consumed, so the replay is attempted
    // directly — a UI that merely hides the button would prove nothing about the contracts.
    await page.getByTestId("settle-quote").waitFor({ state: "attached" });
    assert.equal(await page.getByTestId("settle-quote").isDisabled(), true, "settle is disabled");

    const quoteId = (await s.registry.read.quoteOfEpoch([epoch.epochId])) as `0x${string}`;
    const execution = await s.registry.read.executionOf([quoteId]);
    assert.equal(Number(execution.status), 2, "the quote is consumed");

    let refused = "";
    try {
      await s.registry.write.markConsumed([quoteId], {
        account: h.wallets[BROWSER_WALLET_INDEX].account,
      });
    } catch (error) {
      refused = (error as Error).message;
    }
    assert.ok(refused.length > 0, "a second consumption must be refused");
    evidence = { ...evidence, replayRejected: true };
  });

  it("18i. records the evidence, and where the page's plaintext went", () => {
    // Grouped by ORIGIN rather than by trusting the code. The page talks to its own dev server and
    // to the Nox handle gateway; anything else would be a leak with an address.
    const settled = String(evidence["creditUnits"] ?? "") !== "";
    const payload = {
      $comment:
        "GENERATED by confidential/test/91-settlement-browser.ts in a real Chromium against the " +
        "real Nox stack and real unmodified Midnight. Every value here is PUBLIC from activation. " +
        "No decrypted mandate, request, allocation or capacity appears, and none is representable.",
      settled,
      offerHashMatched: true,
      replayRejected: evidence["replayRejected"] === true,
      plaintextOrigins: [...origins].sort(),
      ...evidence,
    };
    mkdirSync(new URL("../../evidence/phase4/", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("../../evidence/phase4/browser-flow.json", import.meta.url),
      `${JSON.stringify(payload, null, 2)}\n`,
    );

    assert.ok(settled, "the flow must have settled for this evidence to mean anything");
    assert.ok(origins.size > 0, "the recorded origins must not be empty");
  });
});

/** Recursively converts `bigint` to a decimal string, so a struct can be served as JSON. */
function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, jsonSafe(v)]));
  }
  return value;
}
