/**
 * Solidity and TypeScript must agree on every shared constant, and the check parses the Solidity.
 *
 * These numbers exist twice because Solidity cannot export to TypeScript, which is exactly the
 * situation that produces drift nobody notices — a chunk width that disagreed between the contract
 * sizing a stage and the keeper planning it would produce an epoch whose last chunk silently
 * processed nothing, and every test would still pass.
 *
 * `verify:phase3` closes the loop from the third side by reading the same values back from the
 * deployed contracts' public getters.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as curve from "../src/constants.js";

/** Explicit rather than a dynamic namespace read: a renamed export becomes a type error here. */
const TYPESCRIPT_VALUE: Readonly<Record<(typeof SHARED)[number], number>> = {
  CURVE_MAX_PROVIDERS: curve.CURVE_MAX_PROVIDERS,
  CURVE_MAX_MARKETS: curve.CURVE_MAX_MARKETS,
  CURVE_MAX_RATES_PER_MARKET: curve.CURVE_MAX_RATES_PER_MARKET,
  CURVE_MAX_LEAVES: curve.CURVE_MAX_LEAVES,
  CURVE_COLLATERAL_FAMILY_SLOTS: curve.CURVE_COLLATERAL_FAMILY_SLOTS,
  CURVE_MATURITY_BUCKET_SLOTS: curve.CURVE_MATURITY_BUCKET_SLOTS,
  CURVE_MAX_PUBLIC_PRIORITY: curve.CURVE_MAX_PUBLIC_PRIORITY,
  CURVE_MATURITY_RANK_STRIDE: curve.CURVE_MATURITY_RANK_STRIDE,
  CURVE_RATE_RANK_STRIDE: curve.CURVE_RATE_RANK_STRIDE,
  CURVE_RANK_CEILING: curve.CURVE_RANK_CEILING,
  CURVE_TRANSACTION_GAS_CEILING: curve.CURVE_TRANSACTION_GAS_CEILING,
  CURVE_MAX_CELLS_PER_TRANSACTION: curve.CURVE_MAX_CELLS_PER_TRANSACTION,
  CURVE_RECOMMENDED_CELLS_PER_TRANSACTION: curve.CURVE_RECOMMENDED_CELLS_PER_TRANSACTION,
  CURVE_CACHE_CHUNK_UNITS: curve.CURVE_CACHE_CHUNK_UNITS,
  CURVE_FINALIZE_CHUNK_LEAVES: curve.CURVE_FINALIZE_CHUNK_LEAVES,
  CURVE_REDUCE_CHUNK_LEAVES: curve.CURVE_REDUCE_CHUNK_LEAVES,
  CURVE_ALLOCATE_CHUNK_PROVIDERS: curve.CURVE_ALLOCATE_CHUNK_PROVIDERS,
};

const SOURCE = readFileSync(
  new URL("../../../confidential/contracts/CurveConstants.sol", import.meta.url),
  "utf8",
);

/** Reads `<type> constant NAME = 1_234;` out of the Solidity file. */
function solidityConstant(name: string): number {
  const match = SOURCE.match(new RegExp(`constant\\s+${name}\\s*=\\s*([0-9_]+)\\s*;`));
  if (match?.[1] === undefined) {
    throw new Error(
      `${name} is not declared in CurveConstants.sol. Either the constant was renamed on the ` +
        "Solidity side without mirroring it here, or it was deleted — both are drift.",
    );
  }
  return Number.parseInt(match[1].replaceAll("_", ""), 10);
}

const SHARED = [
  "CURVE_MAX_PROVIDERS",
  "CURVE_MAX_MARKETS",
  "CURVE_MAX_RATES_PER_MARKET",
  "CURVE_MAX_LEAVES",
  "CURVE_COLLATERAL_FAMILY_SLOTS",
  "CURVE_MATURITY_BUCKET_SLOTS",
  "CURVE_MAX_PUBLIC_PRIORITY",
  "CURVE_MATURITY_RANK_STRIDE",
  "CURVE_RATE_RANK_STRIDE",
  "CURVE_RANK_CEILING",
  "CURVE_TRANSACTION_GAS_CEILING",
  "CURVE_MAX_CELLS_PER_TRANSACTION",
  "CURVE_RECOMMENDED_CELLS_PER_TRANSACTION",
  "CURVE_CACHE_CHUNK_UNITS",
  "CURVE_FINALIZE_CHUNK_LEAVES",
  "CURVE_REDUCE_CHUNK_LEAVES",
  "CURVE_ALLOCATE_CHUNK_PROVIDERS",
] as const;

describe("CurveConstants.sol and @kyrve/curve agree", () => {
  for (const name of SHARED) {
    it(`${name}`, () => {
      expect(TYPESCRIPT_VALUE[name]).toBe(solidityConstant(name));
    });
  }

  it("the parser can actually fail, so this suite is not vacuous", () => {
    expect(() => solidityConstant("CURVE_NOT_A_REAL_CONSTANT")).toThrow(/is not declared/);
  });
});

describe("the rank packing is arithmetically sound, not just consistent", () => {
  it("the maturity stride is wider than every reachable tail", () => {
    // Tail = (priority << 4) | marketIndex, masked to 7 bits. Max is (7<<4)|7 = 119.
    const maxTail = ((curve.CURVE_MAX_PUBLIC_PRIORITY << 4) | (curve.CURVE_MAX_MARKETS - 1)) & 0x7f;
    expect(maxTail).toBeLessThan(curve.CURVE_MATURITY_RANK_STRIDE);
  });

  it("the rate stride is wider than the whole maturity field", () => {
    const maxMaturityField =
      (curve.CURVE_MATURITY_BUCKET_SLOTS - 1) * curve.CURVE_MATURITY_RANK_STRIDE;
    expect(maxMaturityField + curve.CURVE_MATURITY_RANK_STRIDE).toBeLessThanOrEqual(
      curve.CURVE_RATE_RANK_STRIDE,
    );
  });

  it("the ceiling is above every reachable score and inside euint16", () => {
    const worst =
      (curve.CURVE_MAX_RATES_PER_MARKET - 1) * curve.CURVE_RATE_RANK_STRIDE +
      (curve.CURVE_MATURITY_BUCKET_SLOTS - 1) * curve.CURVE_MATURITY_RANK_STRIDE +
      119;
    expect(worst).toBe(8_183);
    expect(curve.CURVE_RANK_CEILING).toBeGreaterThan(worst);
    expect(curve.CURVE_RANK_CEILING).toBeLessThanOrEqual(0xffff);
  });
});

describe("every chunk width stays inside the measured gas ceiling", () => {
  const cases: readonly [string, number, number][] = [
    ["cacheProviders", curve.CURVE_CACHE_CHUNK_UNITS, curve.CURVE_STAGE_GAS.cacheUnit],
    ["finalizeLeaves", curve.CURVE_FINALIZE_CHUNK_LEAVES, curve.CURVE_STAGE_GAS.finalizeLeaf],
    ["reduceWinner", curve.CURVE_REDUCE_CHUNK_LEAVES, curve.CURVE_STAGE_GAS.reduceLeaf],
    ["allocate", curve.CURVE_ALLOCATE_CHUNK_PROVIDERS, curve.CURVE_STAGE_GAS.allocateProvider],
  ];

  for (const [stage, width, perUnit] of cases) {
    it(`${stage}: ${width} units x ${perUnit} gas stays under 24M`, () => {
      expect(width * perUnit).toBeLessThan(curve.CURVE_TRANSACTION_GAS_CEILING);
    });
  }

  it("the accumulate maximum is exactly what the measured cell cost permits", () => {
    const derived = Math.floor(
      (curve.CURVE_TRANSACTION_GAS_CEILING - curve.CURVE_STAGE_GAS.accumulateChunkOverhead) /
        curve.CURVE_STAGE_GAS.accumulateCell,
    );
    expect(derived).toBe(curve.CURVE_MAX_CELLS_PER_TRANSACTION);
  });

  it("the recommended width keeps real headroom rather than sitting at the limit", () => {
    const gas =
      curve.CURVE_RECOMMENDED_CELLS_PER_TRANSACTION * curve.CURVE_STAGE_GAS.accumulateCell +
      curve.CURVE_STAGE_GAS.accumulateChunkOverhead;
    expect(gas / curve.CURVE_TRANSACTION_GAS_CEILING).toBeLessThan(0.85);
  });
});
