/**
 * Rate indexes — the bridge between a human borrowing rate and an exact Midnight tick.
 *
 * The direction here is the single most error-prone thing in Kyrve's quote path, and PRD v1.0
 * deliberately declined to assume it. Resolved and proven across the full grid (v1.1 A-7):
 *
 *     higher tick  ->  higher price  ->  more assets per unit of face value  ->  CHEAPER borrowing
 *
 * So "sort rate indexes by increasing borrowing cost" means **sort by decreasing tick**. A rate
 * index is therefore an ordinal position in the cost-ascending order, not a tick.
 */

import { WAD } from "./constants.js";
import { settlementFee } from "./fee.js";
import { mulDivDown } from "./fixed.js";
import { accessibleTicks, assertTickAccessible, tickToPrice } from "./tick.js";

const SECONDS_PER_YEAR = 365n * 86_400n;

export interface RateIndexEntry {
  /** Ordinal position in cost-ascending order. Index 0 is the cheapest borrowing available. */
  readonly index: number;
  readonly tick: bigint;
  readonly price: bigint;
  /** Total return to maturity, WAD. `WAD*WAD/price - WAD`. */
  readonly impliedReturnWad: bigint;
  /** Simple (non-compounded) annualised borrowing rate, WAD. */
  readonly annualisedRateWad: bigint;
}

/**
 * Total return over the term implied by a price, in WAD.
 *
 * Matches Midnight's own `_return` helper in `test/TickLibTest.sol`:
 * `mulDivDown(WAD, WAD, price) - WAD`.
 */
export function impliedReturnWad(price: bigint): bigint {
  if (price <= 0n) {
    throw new Error(`implied return is undefined at price ${price}; exclude zero-priced ticks`);
  }
  if (price > WAD) {
    throw new Error(`price ${price} exceeds WAD; tick prices are capped at par`);
  }
  return mulDivDown(WAD, WAD, price) - WAD;
}

/** Simple annualisation of the term return. Not compounded — fixed-income convention here. */
export function annualisedRateWad(price: bigint, secondsToMaturity: bigint): bigint {
  if (secondsToMaturity <= 0n) {
    throw new Error(
      `cannot annualise at ${secondsToMaturity} seconds to maturity; a matured market has no forward rate`,
    );
  }
  return (impliedReturnWad(price) * SECONDS_PER_YEAR) / secondsToMaturity;
}

/**
 * Builds the cost-ascending rate index over a set of ticks.
 *
 * Ticks are sorted DESCENDING, because that is the order of increasing borrowing cost. Callers
 * that need the tick for rate index `i` read `entries[i].tick` and never re-derive it.
 */
export function buildRateIndexes(
  ticks: readonly bigint[],
  secondsToMaturity: bigint,
): RateIndexEntry[] {
  const sorted = [...ticks].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  const duplicates = sorted.filter((t, i) => i > 0 && t === sorted[i - 1]);
  if (duplicates.length > 0) {
    throw new Error(`rate grid contains duplicate ticks: ${[...new Set(duplicates)].join(", ")}`);
  }

  return sorted.map((tick, index) => {
    const price = tickToPrice(tick);
    return {
      index,
      tick,
      price,
      impliedReturnWad: impliedReturnWad(price),
      annualisedRateWad: annualisedRateWad(price, secondsToMaturity),
    };
  });
}

/** The exact tick for a rate index. Throws rather than clamping an out-of-range index. */
export function tickForRateIndex(entries: readonly RateIndexEntry[], index: number): bigint {
  const entry = entries[index];
  if (entry === undefined) {
    throw new Error(
      `rate index ${index} is out of range; the grid has ${entries.length} entries (0..${entries.length - 1})`,
    );
  }
  return entry.tick;
}

export interface GridRequest {
  readonly tickSpacing: number;
  readonly settlementFeeCbp: readonly number[];
  readonly secondsToMaturity: bigint;
  /** Inclusive bounds on the simple annualised borrowing rate, in WAD. */
  readonly minAnnualisedRateWad: bigint;
  readonly maxAnnualisedRateWad: bigint;
  readonly points: number;
}

/**
 * Selects `points` accessible ticks spanning the requested borrowing-rate band.
 *
 * Every returned tick is guaranteed to satisfy the settlement-fee floor, so a grid built here can
 * never produce a `take` that reverts on fee underflow (v1.1 A-3). Ticks are chosen by walking the
 * accessible set, not by inverting the rate function, so the result is always exactly on grid.
 */
export function selectGridTicks(request: GridRequest): bigint[] {
  const { tickSpacing, settlementFeeCbp, secondsToMaturity, points } = request;

  if (!Number.isInteger(points) || points <= 0) {
    throw new Error(`grid points must be a positive integer, received ${points}`);
  }
  if (request.minAnnualisedRateWad > request.maxAnnualisedRateWad) {
    throw new Error(
      `min annualised rate ${request.minAnnualisedRateWad} exceeds max ${request.maxAnnualisedRateWad}`,
    );
  }

  const fee = settlementFee(settlementFeeCbp, secondsToMaturity);

  const eligible = accessibleTicks(tickSpacing).filter((tick) => {
    const price = tickToPrice(tick);
    // Fee floor: a tick priced below the fee underflows sellerPrice inside take.
    if (price < fee) return false;
    // A zero or par price has no finite / no positive implied rate.
    if (price === 0n || price >= WAD) return false;
    const rate = annualisedRateWad(price, secondsToMaturity);
    return rate >= request.minAnnualisedRateWad && rate <= request.maxAnnualisedRateWad;
  });

  if (eligible.length === 0) {
    throw new Error(
      `no accessible tick at spacing ${tickSpacing} lies in the requested rate band ` +
        `[${request.minAnnualisedRateWad}, ${request.maxAnnualisedRateWad}] WAD at ` +
        `${secondsToMaturity}s to maturity with settlement fee ${fee}. Widen the band or change the maturity.`,
    );
  }

  if (points >= eligible.length) return eligible;

  // Evenly spaced sample across the eligible range, endpoints always included, so the grid always
  // spans the full requested band rather than clustering.
  const picked: bigint[] = [];
  for (let i = 0; i < points; i++) {
    const position = points === 1 ? 0 : Math.round((i * (eligible.length - 1)) / (points - 1));
    const tick = eligible[position] as bigint;
    if (!picked.includes(tick)) picked.push(tick);
  }
  return picked;
}

/** Throws unless every tick in a grid is on-spacing and above the settlement-fee floor. */
export function assertGridViable(
  ticks: readonly bigint[],
  settlementFeeCbp: readonly number[],
  secondsToMaturity: bigint,
  tickSpacing: number,
): void {
  const fee = settlementFee(settlementFeeCbp, secondsToMaturity);
  for (const tick of ticks) {
    assertTickAccessible(tick, tickSpacing);
    const price = tickToPrice(tick);
    if (price < fee) {
      throw new Error(
        `tick ${tick} prices at ${price}, below the settlement fee ${fee} at ${secondsToMaturity}s ` +
          "to maturity. take would revert on underflow (PRD v1.1 A-3).",
      );
    }
  }
}
