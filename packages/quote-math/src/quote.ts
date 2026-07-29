/**
 * Quote math — the exact amounts Midnight will compute for a given offer and fill size.
 *
 * Ported from the pricing block of `Midnight.take` (vendor/midnight/src/Midnight.sol:388-395):
 *
 *     offerPrice   = tickToPrice(offer.tick)
 *     settlementFee= settlementFee(id, timeToMaturity)
 *     sellerPrice  = offer.buy ? offerPrice - settlementFee : offerPrice
 *     buyerPrice   = sellerPrice + settlementFee
 *     buyerAssets  = offer.buy ? mulDivDown(units, buyerPrice, WAD)  : mulDivUp(units, buyerPrice, WAD)
 *     sellerAssets = offer.buy ? mulDivDown(units, sellerPrice, WAD) : mulDivUp(units, sellerPrice, WAD)
 *
 * `sellerPrice = offerPrice - settlementFee` is a checked subtraction: a tick whose price is below
 * the market settlement fee makes `take` revert on underflow. That is why universe construction
 * must exclude those ticks (v1.1 A-3), and it is enforced here rather than discovered on chain.
 */

import { WAD } from "./constants.js";
import { settlementFee } from "./fee.js";
import { asUint128, mulDivDown, mulDivUp } from "./fixed.js";
import { accessibleTicks, assertTickAccessible, tickToPrice } from "./tick.js";

export class TickBelowSettlementFee extends Error {
  constructor(
    readonly tick: bigint,
    readonly price: bigint,
    readonly fee: bigint,
  ) {
    super(
      `tick ${tick} prices at ${price}, below the market settlement fee ${fee}. ` +
        "Midnight computes sellerPrice = offerPrice - settlementFee and would revert on underflow. " +
        "Universe construction must exclude this tick (PRD v1.1 A-3).",
    );
    this.name = "TickBelowSettlementFee";
  }
}

export interface QuoteInputs {
  /** Face value of credit, in loan-token units. */
  readonly units: bigint;
  readonly tick: bigint;
  /** The market's seven stored settlement-fee cbp values. */
  readonly settlementFeeCbp: readonly number[];
  readonly secondsToMaturity: bigint;
  readonly tickSpacing: number;
  /** Kyrve is always the maker on a buy offer; both directions are supported for completeness. */
  readonly buy?: boolean;
}

export interface QuoteAmounts {
  readonly units: bigint;
  readonly tick: bigint;
  readonly offerPrice: bigint;
  readonly settlementFee: bigint;
  readonly sellerPrice: bigint;
  readonly buyerPrice: bigint;
  /** What the maker pays on a buy offer. Independent of the settlement fee (v1.1 A-6). */
  readonly buyerAssets: bigint;
  /** What the borrower receives on a buy offer. This is where fee drift lands. */
  readonly sellerAssets: bigint;
  /** buyerAssets - sellerAssets. Accrues to the protocol fee claimer, not to Kyrve. */
  readonly settlementFeeTaken: bigint;
}

/** The single source of truth for what a Kyrve quote will cost and yield. */
export function quoteAmounts(inputs: QuoteInputs): QuoteAmounts {
  const { units, tick, settlementFeeCbp, secondsToMaturity, tickSpacing } = inputs;
  const buy = inputs.buy ?? true;

  assertTickAccessible(tick, tickSpacing);
  asUint128(units, "units");

  const offerPrice = tickToPrice(tick);
  const fee = settlementFee(settlementFeeCbp, secondsToMaturity);

  if (buy && offerPrice < fee) {
    throw new TickBelowSettlementFee(tick, offerPrice, fee);
  }

  const sellerPrice = buy ? offerPrice - fee : offerPrice;
  const buyerPrice = sellerPrice + fee;

  const buyerAssets = buy ? mulDivDown(units, buyerPrice, WAD) : mulDivUp(units, buyerPrice, WAD);
  const sellerAssets = buy
    ? mulDivDown(units, sellerPrice, WAD)
    : mulDivUp(units, sellerPrice, WAD);

  return {
    units,
    tick,
    offerPrice,
    settlementFee: fee,
    sellerPrice,
    buyerPrice,
    buyerAssets,
    sellerAssets,
    settlementFeeTaken: buyerAssets - sellerAssets,
  };
}

/** What the maker (Kyrve's series vault) must hold and approve before `take`. */
export function makerFunding(inputs: QuoteInputs): bigint {
  return quoteAmounts(inputs).buyerAssets;
}

/** What the borrower actually receives. Falls as the settlement fee rises. */
export function borrowerProceeds(inputs: QuoteInputs): bigint {
  return quoteAmounts(inputs).sellerAssets;
}

export interface UnitsFromAssets {
  /** Face value to put in the offer. Always rounded DOWN. */
  readonly units: bigint;
  /** What the maker will actually owe at these units. */
  readonly buyerAssets: bigint;
  /** targetAssets - buyerAssets. Bounded at 2 wei; routes to the dust account (PRD 19.8). */
  readonly dust: bigint;
}

/**
 * Derives offer `units` from an aggregate `fillAssets` produced by the Nox curve engine.
 *
 * NORMATIVE (PRD v1.1 A-8):
 *
 *     units = floor(fillAssets * WAD / price)
 *
 * Rounding DOWN is load-bearing, not stylistic. It guarantees `buyerAssets <= fillAssets`, so the
 * maker never owes more than providers reserved — which is invariant 19.2. Rounding up can
 * overdraw the reservation. The residue is bounded at 2 wei of the loan token, proven by fuzzing
 * over 256 runs in `contracts/integration/test/QuoteMathDifferential.t.sol`, and is routed to the
 * dust account rather than silently absorbed.
 */
export function unitsFromTargetAssets(
  targetAssets: bigint,
  tick: bigint,
  tickSpacing: number,
): UnitsFromAssets {
  assertTickAccessible(tick, tickSpacing);
  const price = tickToPrice(tick);
  if (price === 0n) {
    throw new Error(
      `tick ${tick} prices at zero; no finite number of units yields ${targetAssets} assets. ` +
        "Exclude zero-priced ticks during universe construction.",
    );
  }

  const units = mulDivDown(targetAssets, WAD, price);
  const buyerAssets = mulDivDown(units, price, WAD);

  return { units, buyerAssets, dust: targetAssets - buyerAssets };
}

/**
 * The lowest tick a market can quote at without `take` reverting on fee underflow.
 *
 * `verify:universe` and the rate-grid builder both enforce this; it is the executable form of
 * PRD v1.1 A-3.
 */
export function minimumViableTick(
  settlementFeeCbp: readonly number[],
  secondsToMaturity: bigint,
  tickSpacing: number,
): bigint {
  const fee = settlementFee(settlementFeeCbp, secondsToMaturity);
  for (const tick of accessibleTicks(tickSpacing)) {
    if (tickToPrice(tick) >= fee) return tick;
  }
  throw new Error(
    `no accessible tick at spacing ${tickSpacing} prices at or above the settlement fee ${fee}. ` +
      "This market cannot be quoted at this maturity.",
  );
}
