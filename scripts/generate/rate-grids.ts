/**
 * Deterministic rate-grid generator.
 *
 * A rate grid is the public universe of ticks Kyrve may quote at on a market. It is public by
 * design — the confidential curve engine compares each provider's ENCRYPTED minimum tick against
 * a PUBLIC leaf tick, which is what reduces one eligibility cell from an indicator-and-multiply
 * chain to a single comparison (PRD v1.1 A-9). Publishing and hashing the grid is therefore not
 * an information leak; it is what makes the private universe affordable.
 *
 * Every grid produced here is guaranteed settleable: no tick is off-spacing, and no tick prices
 * below the market's settlement fee, which would make `take` revert on underflow (A-3).
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

import {
  assertGridViable,
  borrowerProceeds,
  buildRateIndexes,
  DEFAULT_TICK_SPACING,
  makerFunding,
  selectGridTicks,
  settlementFee,
  WAD,
} from "../../packages/quote-math/src/index.js";
import { repoPath, stableStringify } from "../lib/shell.js";

const DAY = 86_400;

/** Matches `LocalMidnightFixture` and `DeployKyrveSubstrate.s.sol` exactly. */
export const SETTLEMENT_FEE_CBP = [14, 14, 98, 400, 1000, 2500, 5000];
export const CONTINUOUS_FEE = 1000n;

/** One reference size used to publish indicative amounts. 1,000,000 units of a 6-decimal token. */
const REFERENCE_UNITS = 1_000_000_000_000n;

export interface GridSpec {
  readonly marketKey: string;
  readonly label: string;
  readonly maturitySeconds: number;
  /** Inclusive simple-annualised borrowing-rate band, in WAD. */
  readonly minRateWad: bigint;
  readonly maxRateWad: bigint;
  readonly points: number;
}

/** The four launch grids. Two maturities, one band, so the grids are comparable across markets. */
export const GRID_SPECS: readonly GridSpec[] = [
  {
    marketKey: "usdc-30d-weth",
    label: "USDC 30d / WETH",
    maturitySeconds: 30 * DAY,
    minRateWad: 20_000_000_000_000_000n,
    maxRateWad: 200_000_000_000_000_000n,
    points: 16,
  },
  {
    marketKey: "usdc-90d-weth",
    label: "USDC 90d / WETH",
    maturitySeconds: 90 * DAY,
    minRateWad: 20_000_000_000_000_000n,
    maxRateWad: 200_000_000_000_000_000n,
    points: 16,
  },
  {
    marketKey: "usdc-30d-wsteth",
    label: "USDC 30d / wstETH",
    maturitySeconds: 30 * DAY,
    minRateWad: 20_000_000_000_000_000n,
    maxRateWad: 200_000_000_000_000_000n,
    points: 16,
  },
  {
    marketKey: "usdc-90d-multi",
    label: "USDC 90d / WETH + wstETH",
    maturitySeconds: 90 * DAY,
    minRateWad: 20_000_000_000_000_000n,
    maxRateWad: 200_000_000_000_000_000n,
    points: 16,
  },
];

export interface GridPoint {
  readonly rateIndex: number;
  readonly tick: string;
  readonly priceWad: string;
  readonly impliedTermReturnWad: string;
  readonly annualisedRateWad: string;
  /** What the maker pays for REFERENCE_UNITS at this tick. */
  readonly makerFunding: string;
  /** What the borrower receives for REFERENCE_UNITS at this tick. */
  readonly borrowerProceeds: string;
}

export interface RateGrid {
  readonly marketKey: string;
  readonly label: string;
  readonly maturitySeconds: number;
  readonly tickSpacing: number;
  readonly settlementFeeCbp: readonly number[];
  readonly settlementFeeWad: string;
  readonly continuousFee: string;
  readonly referenceUnits: string;
  readonly points: readonly GridPoint[];
  /** sha256 over the canonical grid content. Recorded in markets.json and the manifest. */
  readonly gridHash: string;
}

export function buildRateGrid(spec: GridSpec): RateGrid {
  const secondsToMaturity = BigInt(spec.maturitySeconds);

  const ticks = selectGridTicks({
    tickSpacing: DEFAULT_TICK_SPACING,
    settlementFeeCbp: SETTLEMENT_FEE_CBP,
    secondsToMaturity,
    minAnnualisedRateWad: spec.minRateWad,
    maxAnnualisedRateWad: spec.maxRateWad,
    points: spec.points,
  });

  // Fail here rather than on chain: this is the A-3 gate.
  assertGridViable(ticks, SETTLEMENT_FEE_CBP, secondsToMaturity, DEFAULT_TICK_SPACING);

  const entries = buildRateIndexes(ticks, secondsToMaturity);

  const points: GridPoint[] = entries.map((entry) => {
    const inputs = {
      units: REFERENCE_UNITS,
      tick: entry.tick,
      settlementFeeCbp: SETTLEMENT_FEE_CBP,
      secondsToMaturity,
      tickSpacing: DEFAULT_TICK_SPACING,
    };
    return {
      rateIndex: entry.index,
      tick: entry.tick.toString(),
      priceWad: entry.price.toString(),
      impliedTermReturnWad: entry.impliedReturnWad.toString(),
      annualisedRateWad: entry.annualisedRateWad.toString(),
      makerFunding: makerFunding(inputs).toString(),
      borrowerProceeds: borrowerProceeds(inputs).toString(),
    };
  });

  const grid = {
    marketKey: spec.marketKey,
    label: spec.label,
    maturitySeconds: spec.maturitySeconds,
    tickSpacing: DEFAULT_TICK_SPACING,
    settlementFeeCbp: SETTLEMENT_FEE_CBP,
    settlementFeeWad: settlementFee(SETTLEMENT_FEE_CBP, secondsToMaturity).toString(),
    continuousFee: CONTINUOUS_FEE.toString(),
    referenceUnits: REFERENCE_UNITS.toString(),
    points,
  };

  return { ...grid, gridHash: hashGrid(grid) };
}

/** sha256 over a stable serialisation, so the hash changes only when the grid content does. */
function hashGrid(grid: Omit<RateGrid, "gridHash">): string {
  return `0x${createHash("sha256").update(stableStringify(grid)).digest("hex")}`;
}

export function buildAllRateGrids(_maturityAnchor: number): RateGrid[] {
  return GRID_SPECS.map(buildRateGrid);
}

/** Human-readable percentage of a WAD-scaled rate, for documentation output only. */
function pct(wad: bigint): string {
  return `${(Number(wad) / 1e16).toFixed(2)}%`;
}

function renderMarkdown(grids: readonly RateGrid[]): string {
  const lines: string[] = [
    "# Launch rate grids",
    "",
    "GENERATED by `pnpm grids:build`. Do not edit by hand.",
    "",
    "A rate grid is the **public** universe of ticks Kyrve may quote at on a market. Publishing it",
    "is deliberate: the confidential curve engine compares each provider's *encrypted* minimum tick",
    "against a *public* leaf tick, which is what collapses one eligibility cell to a single",
    "comparison (PRD v1.1 A-9). The private values — capacities, allocations, provider counts,",
    "rejected leaves — never appear here.",
    "",
    "Every tick below is on the market's tick spacing and prices at or above the market settlement",
    "fee, so no grid point can make `take` revert on fee underflow (A-3).",
    "",
    "Rate index 0 is the **cheapest** borrowing, which is the **highest** tick (A-7).",
    "",
  ];

  for (const grid of grids) {
    lines.push(
      `## ${grid.label}`,
      "",
      `- market key: \`${grid.marketKey}\``,
      `- maturity: ${grid.maturitySeconds / DAY} days`,
      `- tick spacing: ${grid.tickSpacing}`,
      `- settlement fee at maturity band: ${grid.settlementFeeWad} WAD`,
      `- continuous fee: ${grid.continuousFee} per second`,
      `- reference size: ${grid.referenceUnits} units`,
      `- grid hash: \`${grid.gridHash}\``,
      "",
      "| rate index | tick | price (WAD) | annualised | maker funds | borrower receives |",
      "|---:|---:|---:|---:|---:|---:|",
    );
    for (const p of grid.points) {
      lines.push(
        `| ${p.rateIndex} | ${p.tick} | ${p.priceWad} | ${pct(BigInt(p.annualisedRateWad))} | ${p.makerFunding} | ${p.borrowerProceeds} |`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function main(): void {
  const grids = GRID_SPECS.map(buildRateGrid);

  mkdirSync(repoPath("deployments"), { recursive: true });
  mkdirSync(repoPath("docs/phase1"), { recursive: true });

  writeFileSync(repoPath("deployments/rate-grids.json"), stableStringify({ grids }));
  writeFileSync(repoPath("docs/phase1/RATE-GRIDS.md"), renderMarkdown(grids));

  for (const grid of grids) {
    const rates = grid.points.map((p) => BigInt(p.annualisedRateWad));
    console.log(
      `${grid.marketKey.padEnd(18)} ${grid.points.length} points  ` +
        `${pct(rates[rates.length - 1] as bigint)}..${pct(rates[0] as bigint)}  ` +
        `ticks ${grid.points.at(-1)?.tick}..${grid.points[0]?.tick}  ${grid.gridHash.slice(0, 18)}`,
    );
  }
  console.log(`\nWAD sanity: 1e18 == ${WAD}`);
  console.log("wrote deployments/rate-grids.json and docs/phase1/RATE-GRIDS.md");
}

if (process.argv[1]?.endsWith("rate-grids.ts")) {
  main();
}
