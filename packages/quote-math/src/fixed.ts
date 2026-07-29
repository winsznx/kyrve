/**
 * Integer arithmetic with Solidity 0.8 semantics.
 *
 * Two details are load-bearing and easy to get wrong in a JavaScript port:
 *
 * 1. **Solidity integer division truncates toward zero, not toward negative infinity.** JavaScript
 *    `BigInt` division does the same, so `/` is a faithful translation — but only because both
 *    truncate. Never substitute `Math.floor`.
 *
 * 2. **Outside `unchecked`, Solidity 0.8 reverts on overflow.** These helpers therefore throw
 *    where the chain would revert. A quote-math result that silently wrapped would be a number
 *    the chain refuses to settle, which is worse than an exception here.
 *
 * Source: vendor/midnight/src/libraries/UtilsLib.sol
 */

import { MAX_UINT128, MAX_UINT256 } from "./constants.js";

export class OverflowError extends Error {
  constructor(operation: string, detail: string) {
    super(`${operation} overflows uint256: ${detail}. Midnight would revert on this input.`);
    this.name = "OverflowError";
  }
}

export class NegativeError extends Error {
  constructor(operation: string, detail: string) {
    super(`${operation} underflows below zero: ${detail}. Midnight would revert on this input.`);
    this.name = "NegativeError";
  }
}

/** Asserts a value is a valid uint256. */
export function asUint256(value: bigint, label: string): bigint {
  if (value < 0n) throw new NegativeError(label, `received ${value}`);
  if (value > MAX_UINT256) throw new OverflowError(label, `received ${value}`);
  return value;
}

/** Asserts a value fits uint128, the width Midnight uses for units and position amounts. */
export function asUint128(value: bigint, label: string): bigint {
  if (value < 0n) throw new NegativeError(label, `received ${value}`);
  if (value > MAX_UINT128) {
    throw new OverflowError(
      label,
      `${value} exceeds uint128, which Midnight casts to via toUint128`,
    );
  }
  return value;
}

/** `UtilsLib.mulDivDown` — (x * y) / d, rounded down. */
export function mulDivDown(x: bigint, y: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("mulDivDown: division by zero");
  asUint256(x, "mulDivDown x");
  asUint256(y, "mulDivDown y");
  const product = x * y;
  if (product > MAX_UINT256) {
    throw new OverflowError("mulDivDown", `${x} * ${y}`);
  }
  return product / d;
}

/** `UtilsLib.mulDivUp` — (x * y + (d - 1)) / d, rounded up. */
export function mulDivUp(x: bigint, y: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("mulDivUp: division by zero");
  asUint256(x, "mulDivUp x");
  asUint256(y, "mulDivUp y");
  const numerator = x * y + (d - 1n);
  if (numerator > MAX_UINT256) {
    throw new OverflowError("mulDivUp", `${x} * ${y} + ${d - 1n}`);
  }
  return numerator / d;
}

/** `UtilsLib.zeroFloorSub` — max(x - y, 0). Never reverts; this is how time-to-maturity clamps. */
export function zeroFloorSub(x: bigint, y: bigint): bigint {
  return x > y ? x - y : 0n;
}

/** `UtilsLib.min`. */
export function min(x: bigint, y: bigint): bigint {
  return x < y ? x : y;
}

/**
 * `TickLib.divHalfDownUnchecked` — x / d rounded to nearest, ties down.
 *
 * Declared `unchecked` in Solidity, so it is translated without an overflow guard on the
 * addition. The callers in `TickLib` bound the inputs.
 */
export function divHalfDownUnchecked(x: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("divHalfDownUnchecked: division by zero");
  return (x + (d - 1n) / 2n) / d;
}

/** Truncates a value to uint256, matching how Solidity's SHL and casts discard high bits. */
export function wrapUint256(value: bigint): bigint {
  return value & MAX_UINT256;
}
