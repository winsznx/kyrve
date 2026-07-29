/**
 * How a published aggregate becomes an executable offer size.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE AGGREGATE IS NOT THE LEAF CAPACITY, AND THE DIFFERENCE IS NOT ROUNDING NOISE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `NoxCurveEngine.publishAggregate` publishes the SUM OF SUCCESSFULLY RESERVED PROVIDER
 * ALLOCATIONS. Each allocation is `fill * contribution / totalCapacity` computed with `safeDiv`,
 * which floors, so the reservations sum to slightly less than the winning leaf's fillable capacity
 * — by up to one unit per provider. A leaf that could carry 300,000,000 may reserve 299,999,999.
 *
 * Publishing the capacity instead would be wrong twice over: the capacity is PRIVATE, and the
 * reservations would not sum to the public number, so "the sum of encrypted allocations equals the
 * Midnight credit received" would be false by construction.
 *
 * Everything downstream therefore derives from the AGGREGATE and never from a capacity:
 *
 *     units       = floor(aggregate * WAD / price)
 *     buyerAssets = floor(units * price / WAD)      <=  aggregate
 *
 * Both roundings are DOWN, and both are load-bearing. Rounding up either would let the maker owe
 * more than providers reserved, which is PRD invariant 19.2. The residue `aggregate - buyerAssets`
 * is unreserved confidential capacity: it is never rounded back up, never added to the offer, and
 * never presented as part of the quote.
 */

import { WAD } from "@kyrve/quote-math";

/** Thrown rather than returning a zero-size quote, which would activate an unfillable offer. */
export class AggregateTooSmall extends Error {
  constructor(
    readonly aggregate: bigint,
    readonly priceWad: bigint,
  ) {
    super(
      `an aggregate of ${aggregate} at price ${priceWad} rounds down to zero units. ` +
        "No offer can be built from it; the epoch produced no executable quote.",
    );
    this.name = "AggregateTooSmall";
  }
}

export class PriceIsZero extends Error {
  constructor(readonly tick: number) {
    super(
      `tick ${tick} prices at zero, so no finite number of units yields any assets. ` +
        "Universe construction must exclude zero-priced ticks.",
    );
    this.name = "PriceIsZero";
  }
}

export interface QuoteSize {
  /** Face value of credit. Goes in `offer.maxUnits` and is the exact fill `onBuy` demands. */
  readonly units: bigint;
  /** What the maker pays. Independent of the settlement fee for a buy offer (PRD v1.1 A-6). */
  readonly buyerAssets: bigint;
  /**
   * `aggregate - buyerAssets`. Unreserved confidential capacity, left where it is.
   *
   * It is derivable from public values and is therefore not itself a disclosure — but it is not
   * part of the quote, and rounding it into the offer would be.
   */
  readonly residue: bigint;
}

function mulDivDown(a: bigint, b: bigint, denominator: bigint): bigint {
  return (a * b) / denominator;
}

/**
 * The public sizing rule, identical to `QuoteActivator._deriveExecution`.
 *
 * @param aggregate the PUBLISHED aggregate fill. Never a leaf capacity.
 * @param priceWad `TickLib.tickToPrice(tick)` from the pinned Midnight release.
 */
export function deriveQuoteSize(aggregate: bigint, priceWad: bigint, tick: number): QuoteSize {
  if (priceWad === 0n) throw new PriceIsZero(tick);

  const units = mulDivDown(aggregate, WAD, priceWad);
  if (units === 0n) throw new AggregateTooSmall(aggregate, priceWad);

  const buyerAssets = mulDivDown(units, priceWad, WAD);
  return { units, buyerAssets, residue: aggregate - buyerAssets };
}
