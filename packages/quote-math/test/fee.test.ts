import { describe, expect, it } from "vitest";

import { CBP, MAX_CONTINUOUS_FEE, WAD } from "../src/constants.js";
import {
  assertContinuousFeeWithinCap,
  assertPendingFeeWithinMax,
  assertSettlementFeeValid,
  isPastMaturity,
  maxSettlementFee,
  pendingFeeIncrease,
  settlementFee,
  timeToMaturity,
} from "../src/fee.js";

const DAY = 86_400n;

/** The schedule the Day 0 exact-fill and differential suites configured. */
const DAY0_FEE_CBP = [0, 0, 0, 400, 1000, 0, 0];

describe("settlementFee interpolates exactly as Midnight does", () => {
  it("returns the flat rate at or beyond 360 days", () => {
    const cbp = [0, 0, 0, 0, 0, 0, 5000];
    expect(settlementFee(cbp, 360n * DAY)).toBe(5000n * CBP);
    expect(settlementFee(cbp, 1000n * DAY)).toBe(5000n * CBP);
  });

  it("returns the lower breakpoint exactly at a breakpoint", () => {
    expect(settlementFee(DAY0_FEE_CBP, 30n * DAY)).toBe(400n * CBP);
    expect(settlementFee(DAY0_FEE_CBP, 90n * DAY)).toBe(1000n * CBP);
  });

  it("interpolates linearly between 30 and 90 days", () => {
    // 60 days is exactly halfway, so the fee is the midpoint of 400 and 1000 cbp.
    expect(settlementFee(DAY0_FEE_CBP, 60n * DAY)).toBe(700n * CBP);
  });

  it("reproduces the 7e14 figure Day 0 measured at 60 days", () => {
    // docs/day0/PRD-DELTA.md D-8 records settlementFee = 7e14 at a 60-day maturity.
    expect(settlementFee(DAY0_FEE_CBP, 60n * DAY)).toBe(700_000_000_000_000n);
  });

  it("is monotonic across the whole schedule when the cbp values are", () => {
    const cbp = [14, 14, 98, 417, 1250, 2500, 5000];
    let previous = -1n;
    for (let t = 0n; t <= 400n * DAY; t += DAY / 4n) {
      const fee = settlementFee(cbp, t);
      expect(fee).toBeGreaterThanOrEqual(previous);
      previous = fee;
    }
  });

  it("rejects the wrong number of breakpoints rather than guessing", () => {
    expect(() => settlementFee([0, 0, 0], 30n * DAY)).toThrow(/exactly 7 breakpoint values/);
  });

  it("rejects a cbp value that overflows uint16", () => {
    expect(() => settlementFee([0, 0, 0, 0, 0, 0, 70_000], 0n)).toThrow(/uint16/);
  });
});

describe("settlement fee ceilings mirror ConstantsLib", () => {
  it.each([
    [0, 14_000_000_000_000n],
    [3, 417_000_000_000_000n],
    [4, 1_250_000_000_000_000n],
    [6, 5_000_000_000_000_000n],
  ])("index %i", (index, expected) => {
    expect(maxSettlementFee(index)).toBe(expected);
  });

  it("rejects an out-of-range index", () => {
    expect(() => maxSettlementFee(7)).toThrow(/must be 0..6/);
  });

  it("accepts a fee at exactly the ceiling", () => {
    expect(() => assertSettlementFeeValid(3, 417n * CBP)).not.toThrow();
  });

  it("rejects a fee one cbp above the ceiling", () => {
    expect(() => assertSettlementFeeValid(3, 418n * CBP)).toThrow(/exceeds the protocol maximum/);
  });

  it("rejects a fee that is not a whole number of cbp", () => {
    expect(() => assertSettlementFeeValid(3, 400n * CBP + 1n)).toThrow(/not a multiple of CBP/);
  });
});

describe("continuous fee — the maker's real fee exposure (PRD v1.1 A-4)", () => {
  it("computes pendingFeeIncrease as take does", () => {
    const creditIncrease = 1_000_000_000_000n; // 1,000,000e6
    const continuousFee = 1000n;
    const seconds = 60n * DAY;
    // mulDivDown(credit, continuousFee * seconds, WAD)
    const expected = (creditIncrease * (continuousFee * seconds)) / WAD;
    expect(pendingFeeIncrease(creditIncrease, continuousFee, seconds)).toBe(expected);
  });

  it("returns zero at maturity, when no time remains to accrue over", () => {
    expect(pendingFeeIncrease(1_000_000n, 1000n, 0n)).toBe(0n);
  });

  it("caps the per-second fee at the protocol maximum", () => {
    expect(MAX_CONTINUOUS_FEE).toBe(317_097_919n);
  });

  it("rejects a market fee above the offer's cap, as take does", () => {
    expect(() => assertContinuousFeeWithinCap(2000n, 1000n)).toThrow(
      /exceeds the offer's continuousFeeCap/,
    );
    expect(() => assertContinuousFeeWithinCap(1000n, 1000n)).not.toThrow();
  });

  it("rejects a pending fee above the activated quote's bound", () => {
    expect(() => assertPendingFeeWithinMax(101n, 100n)).toThrow(
      /exceeds the activated quote's maxPendingFee/,
    );
    expect(() => assertPendingFeeWithinMax(100n, 100n)).not.toThrow();
  });

  it("never overflows uint128 at the protocol's own worst case", () => {
    // Maximum credit, maximum per-second fee, longest schedule Midnight interpolates over.
    // take() casts this to uint128, so an overflow here would be a protocol-level DoS.
    const worstCase = pendingFeeIncrease(2n ** 128n - 1n, MAX_CONTINUOUS_FEE, 360n * DAY);
    expect(worstCase).toBeLessThan(2n ** 128n);
  });

  it("refuses a pending fee that would not fit uint128, which take casts to", () => {
    // Beyond any reachable protocol configuration, but the guard must still fail closed rather
    // than silently wrapping into a small number.
    expect(() => pendingFeeIncrease(2n ** 128n - 1n, 10n ** 12n, 10n ** 8n)).toThrow(/uint128/);
  });
});

describe("time to maturity clamps rather than reverting", () => {
  it("returns remaining seconds before maturity", () => {
    expect(timeToMaturity(1000n, 400n)).toBe(600n);
  });

  it("returns zero at and after maturity, matching zeroFloorSub", () => {
    expect(timeToMaturity(1000n, 1000n)).toBe(0n);
    expect(timeToMaturity(1000n, 5000n)).toBe(0n);
  });

  it("identifies a matured market", () => {
    expect(isPastMaturity(1000n, 999n)).toBe(false);
    expect(isPastMaturity(1000n, 1000n)).toBe(true);
    expect(isPastMaturity(1000n, 1001n)).toBe(true);
  });
});
