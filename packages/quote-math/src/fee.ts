/**
 * Settlement fee and continuous fee, ported from `Midnight.settlementFee` and the fee arithmetic
 * inside `Midnight.take`.
 *
 * Two facts here overturn what PRD v1.0 assumed, and both are proven executably (v1.1 A-6):
 *
 * - For a BUY offer the maker's payment is EXACTLY independent of the settlement fee, because
 *   `buyerPrice == sellerPrice + settlementFee == offerPrice`. Settlement-fee drift is a
 *   BORROWER-PROCEEDS risk, not a funding risk.
 * - The maker's real fee exposure is the CONTINUOUS fee, delivered to `onBuy` as
 *   `pendingFeeIncrease`. That is what a quote must bound.
 */

import {
  CBP,
  MAX_CONTINUOUS_FEE,
  MAX_SETTLEMENT_FEE,
  SETTLEMENT_FEE_BREAKPOINTS,
  WAD,
} from "./constants.js";
import { asUint128, mulDivDown, zeroFloorSub } from "./fixed.js";

export class SettlementFeeAboveMax extends Error {
  constructor(index: number, fee: bigint, max: bigint) {
    super(
      `settlement fee ${fee} at breakpoint index ${index} exceeds the protocol maximum ${max}. ` +
        "Midnight reverts SettlementFeeAboveMax.",
    );
    this.name = "SettlementFeeAboveMax";
  }
}

export class FeeNotMultipleOfCbp extends Error {
  constructor(fee: bigint) {
    super(
      `settlement fee ${fee} is not a multiple of CBP (${CBP}). Midnight stores fees as uint16 ` +
        "centi-basis-points and reverts FeeNotMultipleOfFeeCbp.",
    );
    this.name = "FeeNotMultipleOfCbp";
  }
}

export class ContinuousFeeAboveCap extends Error {
  constructor(fee: bigint, cap: bigint) {
    super(
      `market continuous fee ${fee} exceeds the offer's continuousFeeCap ${cap}. ` +
        "Midnight reverts ContinuousFeeAboveOfferCap before the ratifier is consulted.",
    );
    this.name = "ContinuousFeeAboveCap";
  }
}

export class PendingFeeAboveMax extends Error {
  constructor(pending: bigint, max: bigint) {
    super(
      `pendingFeeIncrease ${pending} exceeds the activated quote's maxPendingFee ${max}. ` +
        "The series vault rejects this in onBuy, which rolls back the entire take.",
    );
    this.name = "PendingFeeAboveMax";
  }
}

/** Seconds remaining until maturity, clamped at zero. `UtilsLib.zeroFloorSub`. */
export function timeToMaturity(maturity: bigint, now: bigint): bigint {
  return zeroFloorSub(maturity, now);
}

export function isPastMaturity(maturity: bigint, now: bigint): boolean {
  return now >= maturity;
}

/**
 * `Midnight.settlementFee(id, timeToMaturity)` — piecewise linear interpolation between the seven
 * breakpoints, in WAD.
 *
 * @param feeCbp the market's seven stored uint16 centi-basis-point values, indexes 0..6.
 */
export function settlementFee(feeCbp: readonly number[], secondsToMaturity: bigint): bigint {
  if (feeCbp.length !== 7) {
    throw new Error(
      `settlementFee expects exactly 7 breakpoint values (0d, 1d, 7d, 30d, 90d, 180d, 360d), received ${feeCbp.length}`,
    );
  }
  for (const [i, cbp] of feeCbp.entries()) {
    if (!Number.isInteger(cbp) || cbp < 0 || cbp > 0xffff) {
      throw new Error(`settlementFee: feeCbp[${i}] is a uint16, received ${cbp}`);
    }
  }
  if (secondsToMaturity < 0n) {
    throw new Error(
      `settlementFee: secondsToMaturity must not be negative, received ${secondsToMaturity}`,
    );
  }

  const fee = (index: number): bigint => BigInt(feeCbp[index] as number) * CBP;

  // At or beyond the last breakpoint the schedule is flat.
  const last = SETTLEMENT_FEE_BREAKPOINTS[6];
  if (secondsToMaturity >= last) return fee(6);

  for (let i = 1; i <= 6; i++) {
    const end = SETTLEMENT_FEE_BREAKPOINTS[i] as bigint;
    if (secondsToMaturity < end) {
      const start = SETTLEMENT_FEE_BREAKPOINTS[i - 1] as bigint;
      const feeLower = fee(i - 1);
      const feeUpper = fee(i);
      return (
        (feeLower * (end - secondsToMaturity) + feeUpper * (secondsToMaturity - start)) /
        (end - start)
      );
    }
  }

  /* c8 ignore next -- unreachable: the loop covers [0, 360 days) and the guard covers the rest */
  throw new Error(`settlementFee: unreachable for secondsToMaturity ${secondsToMaturity}`);
}

/** Protocol ceiling for a breakpoint index. `ConstantsLib.maxSettlementFee`. */
export function maxSettlementFee(index: number): bigint {
  const max = MAX_SETTLEMENT_FEE[index];
  if (max === undefined) {
    throw new Error(`settlement fee breakpoint index must be 0..6, received ${index}`);
  }
  return max;
}

/** Throws exactly where `setDefaultSettlementFee` / `setMarketSettlementFee` would revert. */
export function assertSettlementFeeValid(index: number, fee: bigint): void {
  if (fee % CBP !== 0n) throw new FeeNotMultipleOfCbp(fee);
  const max = maxSettlementFee(index);
  if (fee > max) throw new SettlementFeeAboveMax(index, fee, max);
}

/**
 * `pendingFeeIncrease` as computed inside `take` and delivered to `onBuy`.
 *
 * `mulDivDown(buyerCreditIncrease, continuousFee * timeToMaturity, WAD)`, cast to uint128.
 * This is the maker's real fee exposure and must be bounded by the activated quote (v1.1 A-4).
 */
export function pendingFeeIncrease(
  creditIncrease: bigint,
  continuousFee: bigint,
  secondsToMaturity: bigint,
): bigint {
  if (continuousFee < 0n) {
    throw new Error(`continuousFee must not be negative, received ${continuousFee}`);
  }
  const raw = mulDivDown(creditIncrease, continuousFee * secondsToMaturity, WAD);
  return asUint128(raw, "pendingFeeIncrease");
}

/** Throws where Midnight reverts `ContinuousFeeAboveOfferCap`. */
export function assertContinuousFeeWithinCap(marketContinuousFee: bigint, offerCap: bigint): void {
  if (marketContinuousFee > offerCap) {
    throw new ContinuousFeeAboveCap(marketContinuousFee, offerCap);
  }
}

/** Throws where `KyrveExactFillVault.onBuy` rejects, rolling back the entire take. */
export function assertPendingFeeWithinMax(pending: bigint, maxPendingFee: bigint): void {
  if (pending > maxPendingFee) throw new PendingFeeAboveMax(pending, maxPendingFee);
}

/** Protocol ceiling on the per-second continuous fee. */
export function maxContinuousFee(): bigint {
  return MAX_CONTINUOUS_FEE;
}
