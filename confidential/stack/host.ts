/**
 * The local stack host: the one process that owns the chain, the Nox stack and every deployment.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A HARDHAT TEST FILE AND NOT A SCRIPT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Because the Nox plugin's `test` override is the proven path that starts a chain, injects
 * NoxCompute, brings the Docker stack up with `--wait`, discovers the gateway's Docker-assigned host
 * port, and tears all of it down in a `finally`. Every browser suite in this repository already
 * depends on that path working.
 *
 * A hand-written orchestrator that booted its own chain and its own compose project would be a
 * second implementation of the most delicate part of the system, and the first time it diverged the
 * symptom would be a stack that looks up and answers about a different chain. So the host runs
 * INSIDE the plugin's lifecycle and adds only what the plugin does not do: deploy Kyrve, publish the
 * port, and stay alive.
 *
 * It lives outside `test/` deliberately. A file under `test/` that blocks forever would hang
 * `pnpm test:confidential`, and the whole point of this one is that it does not return.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * HOW THE GATEWAY PORT LEAVES THIS PROCESS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `handleGatewayUrl()` reads `NOX_HANDLE_GATEWAY_HOST_PORT`, which `startOffchainServices` sets in
 * THIS process's environment and nowhere else. The orchestrator cannot read it.
 *
 * It leaves as ONE JSON line on stdout behind a sentinel. Not a parsed log message: the sentinel
 * makes the line machine-addressable, the payload is JSON, and the orchestrator matches the prefix
 * rather than a phrase. IPC would have been better and does not survive — `npx` and the `hardhat`
 * shell wrapper sit between the orchestrator and this process, and the IPC file descriptor does not
 * cross them (measured, not assumed).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * HOW IT SHUTS DOWN WITHOUT LEAVING DOCKER RUNNING
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * SIGTERM resolves the promise this file is blocked on. The test returns, and the plugin's `finally`
 * runs `stopOffchainServices()` and closes the chain. A plain `process.exit` on SIGTERM would skip
 * that `finally` and leave six containers up — which is exactly the orphan the requirement forbids,
 * and is why the handler resolves rather than exits.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { before, describe, it } from "node:test";

import { handleGatewayUrl } from "@iexec-nox/nox-hardhat-plugin";
import { NOX_COMPUTE_BY_CHAIN } from "@kyrve/config";
import { CURVE_RECOMMENDED_CELLS_PER_TRANSACTION, UNIT } from "@kyrve/curve";

import {
  type CurveHarness,
  deployCurveHarness,
  type SealedProviderState,
  setupProvider,
} from "../test/curve-helpers.js";
import { mine, ROLE_INDEX } from "../test/helpers.js";
import { deployCrossBook, deployParallelCurveLayer } from "../test/market-helpers.js";
import { runIssuanceLifecycle, type SeriesLayer } from "../test/series-helpers.js";
import {
  createSettlementUniverse,
  deploySettlement,
  type SettlementHarness,
  settlementMarketGrid,
} from "../test/settlement-helpers.js";

/** The single line the orchestrator matches. Everything else this process prints is diagnostics. */
const READY_SENTINEL = "@@KYRVE-STACK-READY@@";

/** The target price a Roll book is compiled with, matching the Phase 6 suite. */
const TARGET_PRICE_WAD = 10n ** 18n;

type Series = SeriesLayer & {
  quoteId: `0x${string}`;
  epoch: { epochId: `0x${string}` };
  exactUnits: bigint;
};

/** The sealed operation-graph root a quote's claims were bound to. Public from allocation. */
interface Binding {
  readonly graphRoot: `0x${string}`;
  readonly aggregateFillAmount: bigint;
}

describe("kyrve local stack", () => {
  let h: CurveHarness;
  let h2: CurveHarness;
  let s: SettlementHarness;
  let s2: SettlementHarness;
  let source: Series;
  let target: Series;
  let cross: { readonly book: { address: `0x${string}` } };
  let roll: { address: `0x${string}` };
  let sourceMaturity = 0n;
  let sourceBinding: Binding;
  let targetBinding: Binding;

  before(async () => {
    /**
     * TWO COMPLETE ISSUANCE STACKS, because one is not enough for the product to be exercised.
     *
     * `KyrveCustodyVault.bindSettler` is one-shot and the settler holds its series, token, ownership
     * registry, vault and market as immutables. So one custody vault serves exactly one series, and
     * a second maturity cascades into a second engine, epoch controller, graph registry, ledger and
     * settlement layer (delta U-1). A Roll book cannot exist without both, and the whole point of
     * this host is that the demonstration runs against ONE stack instance rather than three.
     *
     * The two layers SHARE the controller, the wrapped asset, both books, the universe registry and
     * the Midnight substrate — so the providers' mandates live in one book and both series redeem in
     * one loan token, which is what `KyrveRollBook`'s constructor checks.
     */
    h = await deployCurveHarness({ substrate: true });
    s = await deploySettlement(h);
    h2 = await deployParallelCurveLayer(h);
    s2 = await deploySettlement(h2);

    /**
     * Fixture markets 0 and 1: the same loan token and the SAME collateral, at two maturities.
     *
     * That is what a roll is, and it is also what makes the fixture runnable — market 3 is a sorted
     * collateral PAIR and `supplyCollateral` supplies index 0 of whatever the market declares, so
     * pointing an epoch at it produces a Midnight balance revert naming nothing about the cause.
     */
    const first = await settlementMarketGrid(s, 0, { collateralFamily: 0, maturityBucket: 0 });
    const second = await settlementMarketGrid(s, 1, { collateralFamily: 0, maturityBucket: 1 });
    const markets = [
      { market: first.market, marketId: first.marketId },
      { market: second.market, marketId: second.marketId },
    ];
    const created = await createSettlementUniverse(h, [first.grid, second.grid], {
      privacyFloor: 2,
      cellsPerChunk: CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
    });
    sourceMaturity = BigInt(first.market.maturity);

    /**
     * TWO DISJOINT PROVIDER SETS, each capped onto one market.
     *
     * A cap of zero means the provider offers that market nothing, so capping wallets 1 and 2 onto
     * market 0 and wallets 3 and 4 onto market 1 makes each epoch's winner determined by who is
     * willing to fill it. That is how two epochs over ONE universe end up as two SERIES rather than
     * two quotes on the same one.
     *
     * Wallet 1 is the provider the browser demonstration drives, and wallet 2 is the second provider
     * that meets the privacy floor of two — and is also the peer whose refusal is the load-bearing
     * assertion, because two providers' balances are the equal-shaped quantities that would alias
     * into one handle without isolation.
     */
    const sourceProviders: SealedProviderState[] = [
      await setupProvider(h, created.universeId, {
        walletIndex: 1,
        mandate: { marketCaps: [400n * UNIT, 0n], minRateIndexes: [0, 0] },
        balance: 2_000n * UNIT,
      }),
      await setupProvider(h, created.universeId, {
        walletIndex: 2,
        mandate: { marketCaps: [300n * UNIT, 0n], minRateIndexes: [0, 0] },
        balance: 1_500n * UNIT,
      }),
    ];
    const targetProviders: SealedProviderState[] = [
      await setupProvider(h2, created.universeId, {
        walletIndex: 3,
        mandate: { marketCaps: [0n, 400n * UNIT], minRateIndexes: [0, 0] },
        balance: 2_000n * UNIT,
      }),
      await setupProvider(h2, created.universeId, {
        walletIndex: 4,
        mandate: { marketCaps: [0n, 400n * UNIT], minRateIndexes: [0, 0] },
        balance: 2_000n * UNIT,
      }),
    ];

    const request = {
      desiredAssets: 400n * UNIT,
      minimumAssets: 50n * UNIT,
      maxRateIndexes: [1, 1],
    };
    // Borrower wallets 5 and 13: both above every ROLE_INDEX entry, so a borrower is never a role.
    source = (await runIssuanceLifecycle(
      h,
      s,
      sourceProviders,
      5,
      0,
      markets,
      created,
      request,
    )) as Series;
    target = (await runIssuanceLifecycle(
      h2,
      s2,
      targetProviders,
      13,
      1,
      markets,
      created,
      request,
    )) as Series;

    assert.notEqual(
      source.seriesId,
      target.seriesId,
      "the two epochs must have produced two DIFFERENT series, or this stack proves nothing",
    );

    // Supply and the solvency verdict are published once, before any browser reads them. The page
    // decrypts them through the PUBLIC path; it does not compute them.
    for (const series of [source, target]) {
      await mine(
        h,
        await series.token.write.publishAggregateSupply({ account: series.curator.account }),
      );
    }
    await mine(h, await source.solvency.write.proveSolvency());

    /**
     * The source series opens redemption, which is what makes a conversion exist.
     *
     * `conversionWad` is derived from two public numbers. Until the curator sets the factor there is
     * no conversion at all and `KyrveRollBook` reverts `SourceRedemptionNotOpen` rather than
     * defaulting to par — a roll priced at par by accident moves value on every netting.
     */
    sourceBinding = (await source.ownership.read.bindingOf([source.quoteId])) as Binding;
    targetBinding = (await target.ownership.read.bindingOf([target.quoteId])) as Binding;
    const binding = sourceBinding;
    await mine(
      h,
      await source.token.write.setRedemptionFactor(
        [binding.aggregateFillAmount + 2_500_000n, binding.aggregateFillAmount],
        { account: source.curator.account },
      ),
    );

    cross = await deployCrossBook(h, s, source, { priceWad: TARGET_PRICE_WAD });
    const deploymentId = (await s.registry.read.DEPLOYMENT_ID()) as `0x${string}`;
    roll = await h.connection.viem.deployContract("KyrveRollBook", [
      source.token.address,
      target.token.address,
      TARGET_PRICE_WAD,
      deploymentId,
      h.wallets[ROLE_INDEX.keeper].account.address,
      h.controller.address,
    ]);

    writeServedRecord();
    announceReady();
  });

  /**
   * The record the web product is served.
   *
   * IDENTIFIERS AND TRANSACTION HASHES ONLY, and this is asserted rather than intended: every amount
   * the interface displays is read from chain state at render time or decrypted in the browser by
   * the wallet that owns it. A served aggregate would make every browser assertion an assertion
   * about this file.
   */
  function writeServedRecord(): void {
    const record = {
      environment: "local",
      chainId: 31337,
      noxCompute: NOX_COMPUTE_BY_CHAIN[31337],
      addresses: {
        KyrveEmergencyController: h.controller.address,
        TestUnderlyingERC20: h.underlying.address,
        KyrveWrappedAsset: h.asset.address,
        KyrveConfidentialAssetVault: h.custody.address,
        EncryptedMandateBook: h.mandateBook.address,
        ConfidentialRequestBook: h.requestBook.address,
      },
      disclosure:
        "Kyrve is open-source software integrating an unmodified, source-available Morpho Midnight " +
        "testnet replica under its applicable non-production licence.",
      gatewayUrl: handleGatewayUrl(),
      series: seriesRecord(source, sourceMaturity, sourceBinding),
      market: {
        seriesId: source.seriesId,
        addresses: {
          KyrveCapsuleVault: source.capsules.address,
          KyrveCrossBook: cross.book.address,
          KyrveRollBook: roll.address,
        },
      },
      layerB: {
        series: seriesRecord(target, sourceMaturity, targetBinding),
        market: {
          seriesId: target.seriesId,
          addresses: { KyrveRollBook: roll.address },
        },
      },
    };

    const serialised = JSON.stringify(record);
    for (const [what, amount] of [
      ["the source aggregate", source.exactUnits],
      ["the target aggregate", target.exactUnits],
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
  }

  function seriesRecord(series: Series, maturity: bigint, binding: Binding) {
    return {
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
      vault: series.vault.address,
      loanToken: s.usdc.address,
      loanTokenSymbol: "tUSDC",
      loanTokenDecimals: 6,
      maturity: maturity.toString(),
      quoteId: series.quoteId,
      epochId: series.epoch.epochId,
      graphRoot: binding.graphRoot,
      settlementTx: `0x${"00".repeat(32)}`,
      allocationTx: `0x${"00".repeat(32)}`,
      providers: [] as string[],
    };
  }

  /**
   * The one machine-readable line.
   *
   * Everything the orchestrator needs that only this process knows: the gateway port Docker chose,
   * the two series the demonstration addresses, and the market-layer addresses. Public identifiers
   * only — this line goes to the orchestrator's stdout pipe and from there into the runtime manifest.
   */
  function announceReady(): void {
    const payload = {
      chainId: 31337,
      rpcUrl: "http://127.0.0.1:8545",
      noxGatewayUrl: handleGatewayUrl(),
      noxComputeAddress: NOX_COMPUTE_BY_CHAIN[31337],
      hostPid: process.pid,
      sourceSeriesId: source.seriesId,
      targetSeriesId: target.seriesId,
      sourceQuoteId: source.quoteId,
      capsuleVault: source.capsules.address,
      crossBook: cross.book.address,
      rollBook: roll.address,
      seriesToken: source.token.address,
      ownershipRegistry: source.ownership.address,
    };
    console.log(`${READY_SENTINEL} ${JSON.stringify(payload)}`);
  }

  it("holds the stack open until the orchestrator asks it to stop", async () => {
    await new Promise<void>((resolve) => {
      /**
       * RESOLVE, never `process.exit`.
       *
       * Exiting here would skip the plugin's `finally`, which is what runs `stopOffchainServices()`
       * and closes the chain. Six orphaned containers is precisely the failure this handler exists
       * to avoid, and it is invisible until the next start fails on a port that is still bound.
       */
      const stop = (): void => {
        console.log("[kyrve] stack host received a stop signal; tearing down");
        resolve();
      };
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
    });
  });
});
