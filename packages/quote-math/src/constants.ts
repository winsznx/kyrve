/**
 * Constants transcribed from the pinned Morpho Midnight release `2026-07-23` (`dbd8d3d5`).
 *
 * Source of every value:
 *   vendor/midnight/src/libraries/ConstantsLib.sol
 *   vendor/midnight/src/libraries/TickLib.sol
 *
 * Nothing here is derived, rounded or restated. If a value in this file ever disagrees with the
 * vendored source, `pnpm test:contracts` fails first — the fixture that drives the differential
 * tests is generated from the vendored libraries themselves.
 */

export const WAD = 10n ** 18n;
export const ORACLE_PRICE_SCALE = 10n ** 36n;

/** Centi-basis-point. Settlement fees are stored as `fee / CBP` in a uint16. */
export const CBP = 10n ** 12n;

export const MAX_UINT256 = 2n ** 256n - 1n;
export const MAX_UINT128 = 2n ** 128n - 1n;
export const MAX_INT256 = 2n ** 255n - 1n;

// ---------------------------------------------------------------------------------------------
// TickLib
// ---------------------------------------------------------------------------------------------

/** floor(ln(1.005) * 1e18) */
export const LN_ONE_PLUS_DELTA = 4_987_541_511_039_073n;

export const MAX_TICK = 6744n;

/** Minimum representable price increment, 1e-7 WAD. Tick prices are multiples of this. */
export const PRICE_ROUNDING_STEP = 10n ** 11n;

/** floor(ln(2) * 1e18) */
export const LN_2 = 693_147_180_559_945_309n;

/**
 * Chosen so `2 * expR(-offset) == expR(ln2 - offset - 1)`, which is what makes `wExp`
 * non-decreasing. Asserted by Midnight's own `testWExpOffsetProperty`.
 */
export const WEXP_OFFSET = 322_611_214_989_459_870n;

export const DEFAULT_TICK_SPACING = 4;

// ---------------------------------------------------------------------------------------------
// Settlement fee
// ---------------------------------------------------------------------------------------------

const SECONDS_PER_DAY = 86_400n;

/** The seven settlement-fee breakpoints, in seconds to maturity. Index order is normative. */
export const SETTLEMENT_FEE_BREAKPOINTS = [
  0n,
  1n * SECONDS_PER_DAY,
  7n * SECONDS_PER_DAY,
  30n * SECONDS_PER_DAY,
  90n * SECONDS_PER_DAY,
  180n * SECONDS_PER_DAY,
  360n * SECONDS_PER_DAY,
] as const;

/** Ceiling for each breakpoint. `setDefaultSettlementFee` reverts above these. */
export const MAX_SETTLEMENT_FEE = [
  14_000_000_000_000n, // 0 days   0.000014e18
  14_000_000_000_000n, // 1 day    0.000014e18
  98_000_000_000_000n, // 7 days   0.000098e18
  417_000_000_000_000n, // 30 days  0.000417e18
  1_250_000_000_000_000n, // 90 days  0.00125e18
  2_500_000_000_000_000n, // 180 days 0.0025e18
  5_000_000_000_000_000n, // 360 days 0.005e18
] as const;

/** `uint32(uint256(0.01e18) / uint256(365 days))` — per-second continuous fee ceiling. */
export const MAX_CONTINUOUS_FEE = 10n ** 16n / (365n * SECONDS_PER_DAY);

/**
 * keccak256("morpho.midnight.callbackSuccess") — the value every Midnight callback must return.
 * Computed, not transcribed: `cast keccak "morpho.midnight.callbackSuccess"`.
 * A contract test asserts this equals `ConstantsLib.CALLBACK_SUCCESS` in the vendored release.
 */
export const CALLBACK_SUCCESS =
  "0x7f87788ea698181ea4d28d1576d0ba4fc92c0dbe5bf75b43692af2ce91dbaea2" as const;
