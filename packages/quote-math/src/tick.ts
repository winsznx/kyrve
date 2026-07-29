/**
 * Tick and price math, ported from `vendor/midnight/src/libraries/TickLib.sol`.
 *
 * The port is bit-for-bit, not approximate. `test/tick-differential.test.ts` asserts equality
 * against a fixture generated from the vendored Solidity itself, at every one of the 6,745 ticks
 * in range. A rounding difference of one wei here would produce a quote the chain refuses to
 * settle at, so "close enough" is not a category that exists in this file.
 *
 * DIRECTION, because it is counter-intuitive and the PRD deliberately left it open (v1.1 A-7):
 * `tickToPrice` is monotonically NON-DECREASING and capped at WAD. A higher tick means a higher
 * price, which means more assets received per unit of face value, which means CHEAPER borrowing.
 * "Sort by increasing borrowing cost" therefore means sort by DECREASING tick.
 */

import {
  LN_2,
  LN_ONE_PLUS_DELTA,
  MAX_TICK,
  PRICE_ROUNDING_STEP,
  WAD,
  WEXP_OFFSET,
} from "./constants.js";
import { divHalfDownUnchecked, wrapUint256 } from "./fixed.js";

export class TickOutOfRange extends Error {
  constructor(tick: bigint) {
    super(`tick ${tick} is out of range: Midnight accepts 0..${MAX_TICK} inclusive`);
    this.name = "TickOutOfRange";
  }
}

export class PriceGreaterThanOne extends Error {
  constructor(price: bigint) {
    super(`price ${price} exceeds WAD (${WAD}); no tick prices above par`);
    this.name = "PriceGreaterThanOne";
  }
}

export class TickNotAccessible extends Error {
  constructor(tick: bigint, spacing: number) {
    super(
      `tick ${tick} is not a multiple of the market tick spacing ${spacing}. ` +
        "Midnight reverts TickNotAccessible before the ratifier is even consulted.",
    );
    this.name = "TickNotAccessible";
  }
}

/**
 * `TickLib.wExp` — a three-term Taylor expansion of e^x in WAD, with range reduction by ln 2.
 *
 * The whole body is `unchecked` in Solidity. Two consequences are reproduced deliberately:
 * the final `uint256(expR) << uint256(q)` is a raw SHL that discards bits above 256 rather than
 * reverting, and the intermediate divisions truncate toward zero even when `r` is negative.
 */
export function wExp(x: bigint): bigint {
  if (x < 0n) {
    // 1e36 / wExp(-x). Both operands positive, so truncation direction is unambiguous.
    return 10n ** 36n / wExp(-x);
  }

  const q = (x + WEXP_OFFSET) / LN_2;
  const r = x - q * LN_2;

  // `r` may be negative here, so these two divisions rely on truncation toward zero.
  const secondTerm = (r * r) / (2n * WAD);
  const thirdTerm = (secondTerm * r) / (3n * WAD);
  const expR = WAD + r + secondTerm + thirdTerm;

  // Solidity: uint256(expR) << uint256(q). SHL discards high bits; it does not revert.
  return wrapUint256(wrapUint256(expR) << q);
}

/** `TickLib.tickToPrice`. Returns a WAD price in [0, WAD]. */
export function tickToPrice(tick: bigint): bigint {
  if (tick < 0n || tick > MAX_TICK) throw new TickOutOfRange(tick);

  const exponent = LN_ONE_PLUS_DELTA * (MAX_TICK / 2n - tick);
  const denominator = WAD + wExp(exponent);

  return (
    divHalfDownUnchecked(divHalfDownUnchecked(10n ** 36n, denominator), PRICE_ROUNDING_STEP) *
    PRICE_ROUNDING_STEP
  );
}

/**
 * `TickLib.priceToTick` — among ticks that are multiples of `spacing`, the lowest one whose price
 * is greater than or equal to `price`.
 */
export function priceToTick(price: bigint, spacing: number): bigint {
  if (price > WAD) throw new PriceGreaterThanOne(price);
  if (!Number.isInteger(spacing) || spacing <= 0) {
    throw new Error(`tick spacing must be a positive integer, received ${spacing}`);
  }

  let low = 0n;
  let high = MAX_TICK;
  while (low !== high) {
    const mid = (low + high) / 2n;
    if (tickToPrice(mid) < price) low = mid + 1n;
    else high = mid;
  }

  const s = BigInt(spacing);
  return ((low + s - 1n) / s) * s;
}

/** True when Midnight will accept this tick on a market with the given spacing. */
export function isTickAccessible(tick: bigint, spacing: number): boolean {
  if (tick < 0n || tick > MAX_TICK) return false;
  if (!Number.isInteger(spacing) || spacing <= 0) return false;
  return tick % BigInt(spacing) === 0n;
}

/** Throws `TickNotAccessible` exactly where Midnight's `take` would revert with it. */
export function assertTickAccessible(tick: bigint, spacing: number): void {
  if (tick < 0n || tick > MAX_TICK) throw new TickOutOfRange(tick);
  if (tick % BigInt(spacing) !== 0n) throw new TickNotAccessible(tick, spacing);
}

/** Every accessible tick on a market, ascending. 1,687 entries at the default spacing of 4. */
export function accessibleTicks(spacing: number): bigint[] {
  if (!Number.isInteger(spacing) || spacing <= 0) {
    throw new Error(`tick spacing must be a positive integer, received ${spacing}`);
  }
  const s = BigInt(spacing);
  const ticks: bigint[] = [];
  for (let tick = 0n; tick <= MAX_TICK; tick += s) ticks.push(tick);
  return ticks;
}
