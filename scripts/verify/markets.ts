/**
 * Verifies the four launch markets in a deployment manifest are internally consistent and
 * genuinely quotable.
 *
 * Runs without a live chain: every check here is derivable from the manifest, the rate grids and
 * the pinned quote math. `verify:deployment` adds the live-chain half.
 */

import { existsSync } from "node:fs";
import { parseDeploymentManifest } from "../../packages/config/src/index.js";
import { marketId } from "../../packages/midnight/src/index.js";
import {
  assertGridViable,
  DEFAULT_TICK_SPACING,
  quoteAmounts,
  settlementFee,
  tickToPrice,
} from "../../packages/quote-math/src/index.js";
import type { RateGrid } from "../generate/rate-grids.js";
import { safeErrorMessage } from "../lib/env.js";
import { readJson, repoPath } from "../lib/shell.js";

const environment = process.argv[2] ?? "local";

function main(): void {
  const manifestPath = repoPath(`deployments/${environment}/manifest.json`);
  if (!existsSync(manifestPath)) {
    console.error(
      `no manifest at deployments/${environment}/manifest.json. Run: pnpm deploy:${environment}`,
    );
    process.exitCode = 1;
    return;
  }

  const manifest = parseDeploymentManifest(readJson(manifestPath));
  const { grids } = readJson<{ grids: RateGrid[] }>(repoPath("deployments/rate-grids.json"));

  const failures: string[] = [];

  if (manifest.markets.length !== 4) {
    failures.push(`expected 4 launch markets, manifest has ${manifest.markets.length}`);
  }

  const loanTokens = new Set<string>();
  const maturities = new Set<string>();
  const collateralFamilies = new Set<string>();

  for (const entry of manifest.markets) {
    loanTokens.add(entry.market.loanToken.toLowerCase());
    maturities.add(entry.market.maturity);
    for (const c of entry.market.collateralParams) collateralFamilies.add(c.token.toLowerCase());

    // 1. The recorded id must be the id the market struct actually derives.
    const derived = marketId({
      chainId: BigInt(entry.market.chainId),
      midnight: entry.market.midnight,
      loanToken: entry.market.loanToken,
      collateralParams: entry.market.collateralParams.map((c) => ({
        token: c.token,
        lltv: BigInt(c.lltv),
        liquidationCursor: BigInt(c.liquidationCursor),
        oracle: c.oracle,
      })),
      maturity: BigInt(entry.market.maturity),
      rcfThreshold: BigInt(entry.market.rcfThreshold),
      enterGate: entry.market.enterGate,
      liquidatorGate: entry.market.liquidatorGate,
    });
    if (derived.toLowerCase() !== entry.id.toLowerCase()) {
      failures.push(`${entry.key}: recorded id ${entry.id} but the struct derives ${derived}`);
    }

    // 2. Collateral must be strictly sorted, or touchMarket would have reverted.
    const tokens = entry.market.collateralParams.map((c) => c.token.toLowerCase());
    if (tokens.some((t, i) => i > 0 && t <= (tokens[i - 1] as string))) {
      failures.push(`${entry.key}: collateral params are not strictly ascending by token address`);
    }

    // 3. The rate grid the manifest points at must exist and hash correctly.
    const grid = grids.find((g) => g.marketKey === entry.key);
    if (grid === undefined) {
      failures.push(`${entry.key}: no rate grid generated`);
      continue;
    }
    if (grid.gridHash !== entry.rateGridHash) {
      failures.push(
        `${entry.key}: manifest grid hash ${entry.rateGridHash} != generated ${grid.gridHash}`,
      );
    }

    // 4. Every tick must be settleable: on spacing, and above the settlement-fee floor.
    const ticks = grid.points.map((p) => BigInt(p.tick));
    const secondsToMaturity = BigInt(grid.maturitySeconds);
    try {
      assertGridViable(ticks, entry.settlementFeeCbp, secondsToMaturity, entry.tickSpacing);
    } catch (error) {
      failures.push(`${entry.key}: ${safeErrorMessage(error)}`);
    }

    // 5. Every tick must actually produce a quote, not merely pass a bounds check.
    for (const tick of ticks) {
      try {
        quoteAmounts({
          units: 1_000_000_000_000n,
          tick,
          settlementFeeCbp: entry.settlementFeeCbp,
          secondsToMaturity,
          tickSpacing: entry.tickSpacing,
        });
      } catch (error) {
        failures.push(`${entry.key}: tick ${tick} does not quote: ${safeErrorMessage(error)}`);
        break;
      }
    }

    const fee = settlementFee(entry.settlementFeeCbp, secondsToMaturity);
    const lowest = ticks.reduce((a, b) => (a < b ? a : b));
    console.log(
      `  ${entry.key.padEnd(18)} id ${entry.id.slice(0, 18)}..  ${grid.points.length} ticks  ` +
        `lowest ${lowest} @ ${tickToPrice(lowest)}  fee ${fee}`,
    );
  }

  // The launch set must span the axes universe construction has to handle.
  if (loanTokens.size !== 1)
    failures.push(`expected exactly one loan token, found ${loanTokens.size}`);
  if (maturities.size < 2)
    failures.push(`expected at least two maturities, found ${maturities.size}`);
  if (collateralFamilies.size < 2) {
    failures.push(`expected at least two collateral families, found ${collateralFamilies.size}`);
  }
  if (manifest.markets.some((m) => m.tickSpacing !== DEFAULT_TICK_SPACING)) {
    failures.push("every launch market must use the default tick spacing");
  }

  if (failures.length > 0) {
    console.error(`\nverify:markets FAILED (${environment})\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `verify:markets PASS (${environment}) — 4 markets, ${loanTokens.size} loan token, ` +
      `${maturities.size} maturities, ${collateralFamilies.size} collateral families, all ticks settleable`,
  );
}

main();
