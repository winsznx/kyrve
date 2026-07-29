import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DEFAULT_TICK_SPACING } from "../src/constants.js";
import { pendingFeeIncrease, settlementFee } from "../src/fee.js";
import { borrowerProceeds, makerFunding, quoteAmounts } from "../src/quote.js";

interface TakeFixture {
  midnightCommit: string;
  anchor: string;
  rows: string[];
}

const fixture: TakeFixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/take-results.json", import.meta.url)), "utf8"),
);

interface TakeRow {
  tick: bigint;
  units: bigint;
  secondsToMaturity: bigint;
  settlementFeeCbp: number[];
  buyerAssets: bigint;
  sellerAssets: bigint;
  pendingFee: bigint;
}

/** tick|units|secondsToMaturity|cbp0,..,cbp6,|buyerAssets|sellerAssets|pendingFee */
function parseRow(row: string): TakeRow {
  const parts = row.split("|");
  if (parts.length !== 7) {
    throw new Error(`malformed take fixture row (expected 7 fields, got ${parts.length}): ${row}`);
  }
  const cbp = (parts[3] as string)
    .split(",")
    .filter((s) => s.length > 0)
    .map(Number);
  if (cbp.length !== 7) {
    throw new Error(`malformed settlement-fee field in row: ${row}`);
  }
  return {
    tick: BigInt(parts[0] as string),
    units: BigInt(parts[1] as string),
    secondsToMaturity: BigInt(parts[2] as string),
    settlementFeeCbp: cbp,
    buyerAssets: BigInt(parts[4] as string),
    sellerAssets: BigInt(parts[5] as string),
    pendingFee: BigInt(parts[6] as string),
  };
}

const rows = fixture.rows.map(parseRow);

/**
 * The test that makes this package worth trusting.
 *
 * These are not restatements of the same formula in two languages — every expected value is the
 * ACTUAL return of a real `take` against real unmodified Midnight, recorded by
 * `contracts/script/ExportTakeFixtures.s.sol`. Agreement here means Kyrve's TypeScript predicts
 * what the protocol actually pays, which is the only claim worth making.
 */
describe("quoteAmounts reproduces real Midnight settlement", () => {
  it("was generated against the pinned release", () => {
    expect(fixture.midnightCommit).toBe("dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0");
    expect(rows.length).toBeGreaterThanOrEqual(36);
  });

  it("predicts buyerAssets exactly, on every recorded settlement", () => {
    const mismatches: string[] = [];
    for (const row of rows) {
      const predicted = makerFunding({
        units: row.units,
        tick: row.tick,
        settlementFeeCbp: row.settlementFeeCbp,
        secondsToMaturity: row.secondsToMaturity,
        tickSpacing: DEFAULT_TICK_SPACING,
      });
      if (predicted !== row.buyerAssets) {
        mismatches.push(
          `tick ${row.tick} units ${row.units} ttm ${row.secondsToMaturity}: chain ${row.buyerAssets}, predicted ${predicted}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("predicts sellerAssets exactly, on every recorded settlement", () => {
    const mismatches: string[] = [];
    for (const row of rows) {
      const predicted = borrowerProceeds({
        units: row.units,
        tick: row.tick,
        settlementFeeCbp: row.settlementFeeCbp,
        secondsToMaturity: row.secondsToMaturity,
        tickSpacing: DEFAULT_TICK_SPACING,
      });
      if (predicted !== row.sellerAssets) {
        mismatches.push(
          `tick ${row.tick} units ${row.units} ttm ${row.secondsToMaturity}: chain ${row.sellerAssets}, predicted ${predicted}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("predicts the continuous fee the vault actually accrued", () => {
    const mismatches: string[] = [];
    for (const row of rows) {
      // The fixture's continuous fee is the market default configured by LocalMidnightFixture.
      const predicted = pendingFeeIncrease(row.units, 1000n, row.secondsToMaturity);
      if (predicted !== row.pendingFee) {
        mismatches.push(
          `tick ${row.tick} units ${row.units} ttm ${row.secondsToMaturity}: chain ${row.pendingFee}, predicted ${predicted}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("reproduces the settlement fee the chain charged, derived rather than read back", () => {
    for (const row of rows) {
      const fee = settlementFee(row.settlementFeeCbp, row.secondsToMaturity);
      // Midnight takes exactly floor(units * fee / WAD) out of the borrower's proceeds.
      expect(row.buyerAssets - row.sellerAssets).toBe((row.units * fee) / 10n ** 18n);
    }
  });
});

describe("PRD v1.1 A-6 — maker funding is independent of the settlement fee", () => {
  it("holds against the recorded settlements at every fee level present", () => {
    for (const row of rows) {
      const base = {
        units: row.units,
        tick: row.tick,
        secondsToMaturity: row.secondsToMaturity,
        tickSpacing: DEFAULT_TICK_SPACING,
      };
      // Doubling every settlement-fee breakpoint must not move what the maker pays.
      const doubled = row.settlementFeeCbp.map((c) => Math.min(c * 2, 0xffff));
      const atRecordedFee = quoteAmounts({ ...base, settlementFeeCbp: row.settlementFeeCbp });
      const atDoubledFee = quoteAmounts({ ...base, settlementFeeCbp: doubled });

      expect(atDoubledFee.buyerAssets).toBe(atRecordedFee.buyerAssets);
      expect(atDoubledFee.buyerAssets).toBe(row.buyerAssets);
      // ...but the borrower's proceeds must fall, which is where fee drift actually lands.
      if (atDoubledFee.settlementFee > atRecordedFee.settlementFee && row.units > 0n) {
        expect(atDoubledFee.sellerAssets).toBeLessThanOrEqual(atRecordedFee.sellerAssets);
      }
    }
  });
});
