import { describe, expect, it } from "vitest";

import {
  ManifestError,
  parseDeploymentManifest,
  requireContract,
  requireMarket,
} from "../src/manifest.js";

const ADDR_A = "0x1111111111111111111111111111111111111111";
const ADDR_B = "0x2222222222222222222222222222222222222222";
const ZERO = "0x0000000000000000000000000000000000000000";
const HASH_A = `0x${"aa".repeat(32)}`;
const HASH_B = `0x${"bb".repeat(32)}`;

function validManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    environment: "local",
    chainId: 31337,
    deployedAt: "2026-07-29T00:00:00Z",
    deploymentBlock: "42",
    deployer: ADDR_A,
    compiler: {
      solc: "0.8.34",
      evmVersion: "osaka",
      viaIr: true,
      optimizer: true,
      optimizerRuns: 466,
      bytecodeHash: "none",
    },
    pins: {
      midnightRelease: "2026-07-23",
      midnightCommit: "dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0",
      noxProtocolContracts: "0.2.4",
      noxConfidentialContracts: "0.2.2",
      handleSdk: "0.1.0-beta.13",
    },
    roles: {
      configurator: ADDR_A,
      feeSetter: ADDR_A,
      feeClaimer: ADDR_A,
      tickSpacingSetter: ADDR_A,
    },
    contracts: {
      Midnight: {
        address: ADDR_B,
        runtimeBytecodeHash: HASH_A,
        deploymentTxHash: HASH_B,
        constructorArgs: [],
        sourcePath: "vendor/midnight/src/Midnight.sol",
        verifiedSource: "not-applicable",
        explorerUrl: null,
      },
    },
    markets: [
      {
        key: "usdc-30d-weth",
        label: "USDC 30d / WETH",
        id: HASH_A,
        market: {
          chainId: "31337",
          midnight: ADDR_B,
          loanToken: ADDR_A,
          collateralParams: [
            {
              token: ADDR_B,
              lltv: "770000000000000000",
              liquidationCursor: "300000000000000000",
              oracle: ADDR_A,
            },
          ],
          maturity: "1790000000",
          rcfThreshold: "0",
          enterGate: ZERO,
          liquidatorGate: ZERO,
        },
        tickSpacing: 4,
        settlementFeeCbp: [0, 14, 98, 400, 1000, 2500, 5000],
        continuousFee: "1000",
        rateGridHash: HASH_B,
      },
    ],
    licenceDisclosureHash: HASH_A,
    sourceUrl: "https://github.com/kyrve/kyrve",
    disclosure:
      "Non-production testnet replica of the pinned Morpho Midnight release. Not an official Morpho deployment.",
  };
}

describe("parseDeploymentManifest — accepts a well-formed manifest", () => {
  it("round-trips every load-bearing field", () => {
    const manifest = parseDeploymentManifest(validManifest());
    expect(manifest.chainId).toBe(31337);
    expect(manifest.pins.midnightCommit).toBe("dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0");
    expect(manifest.compiler.evmVersion).toBe("osaka");
    expect(manifest.markets).toHaveLength(1);
    expect(manifest.markets[0]?.settlementFeeCbp).toHaveLength(7);
  });

  it("carries an optional implementation address only when present", () => {
    const withProxy = validManifest();
    (withProxy["contracts"] as Record<string, Record<string, unknown>>)["NoxCompute"] = {
      address: ADDR_A,
      runtimeBytecodeHash: HASH_B,
      implementation: ADDR_B,
      deploymentTxHash: null,
      constructorArgs: [],
      sourcePath: "external",
      verifiedSource: "unavailable",
      explorerUrl: null,
    };
    const manifest = parseDeploymentManifest(withProxy);
    expect(requireContract(manifest, "NoxCompute").implementation).toBe(ADDR_B);
    expect(requireContract(manifest, "Midnight").implementation).toBeUndefined();
  });
});

/**
 * Every negative below is a real way a manifest goes wrong in practice. A validator that cannot
 * fail proves nothing, so each case asserts the *specific* field named in the error.
 */
describe("parseDeploymentManifest — fails closed", () => {
  it("rejects a big integer written as a JSON number, which would lose precision", () => {
    const bad = validManifest();
    (bad["markets"] as Record<string, unknown>[])[0]!["market"] = {
      ...((bad["markets"] as Record<string, unknown>[])[0]!["market"] as Record<string, unknown>),
      maturity: 1790000000,
    };
    expect(() => parseDeploymentManifest(bad)).toThrow(ManifestError);
    expect(() => parseDeploymentManifest(bad)).toThrow(/maturity.*decimal integer string/s);
  });

  it("rejects a market whose chainId disagrees with the manifest", () => {
    const bad = validManifest();
    const market = (bad["markets"] as Record<string, unknown>[])[0]!;
    market["market"] = { ...(market["market"] as Record<string, unknown>), chainId: "11155111" };
    expect(() => parseDeploymentManifest(bad)).toThrow(/does not match manifest chainId/);
  });

  it("rejects a disclosure that omits the non-production qualification", () => {
    const bad = validManifest();
    bad["disclosure"] = "Official Morpho Midnight deployment.";
    expect(() => parseDeploymentManifest(bad)).toThrow(/non-production replica/);
  });

  it("rejects the wrong number of settlement-fee buckets", () => {
    const bad = validManifest();
    (bad["markets"] as Record<string, unknown>[])[0]!["settlementFeeCbp"] = [0, 14, 98, 400];
    expect(() => parseDeploymentManifest(bad)).toThrow(/exactly 7 settlement-fee buckets/);
  });

  it("rejects a settlement fee that overflows uint16", () => {
    const bad = validManifest();
    (bad["markets"] as Record<string, unknown>[])[0]!["settlementFeeCbp"] = [
      0, 14, 98, 400, 1000, 2500, 70_000,
    ];
    expect(() => parseDeploymentManifest(bad)).toThrow(/uint16/);
  });

  it("rejects a market with no collateral params, which Midnight itself refuses", () => {
    const bad = validManifest();
    const market = (bad["markets"] as Record<string, unknown>[])[0]!;
    market["market"] = { ...(market["market"] as Record<string, unknown>), collateralParams: [] };
    expect(() => parseDeploymentManifest(bad)).toThrow(/no collateral params/);
  });

  it("rejects a truncated address", () => {
    const bad = validManifest();
    bad["deployer"] = "0x1111";
    expect(() => parseDeploymentManifest(bad)).toThrow(/20-byte hex address/);
  });

  it("rejects duplicate market keys", () => {
    const bad = validManifest();
    const markets = bad["markets"] as Record<string, unknown>[];
    markets.push({ ...markets[0]! });
    expect(() => parseDeploymentManifest(bad)).toThrow(/duplicate market keys/);
  });

  it("rejects a manifest with no markets", () => {
    const bad = validManifest();
    bad["markets"] = [];
    expect(() => parseDeploymentManifest(bad)).toThrow(/cannot serve a quote/);
  });

  it("rejects a future schema version rather than guessing", () => {
    const bad = validManifest();
    bad["schemaVersion"] = 2;
    expect(() => parseDeploymentManifest(bad)).toThrow(/unsupported schema version 2/);
  });

  it("rejects an unknown verifiedSource value", () => {
    const bad = validManifest();
    (bad["contracts"] as Record<string, Record<string, unknown>>)["Midnight"]!["verifiedSource"] =
      "probably";
    expect(() => parseDeploymentManifest(bad)).toThrow(
      /verified\|pending\|unavailable\|not-applicable/,
    );
  });
});

describe("lookup helpers name what is available rather than returning undefined", () => {
  it("throws listing present contracts", () => {
    const manifest = parseDeploymentManifest(validManifest());
    expect(() => requireContract(manifest, "KyrveProtocolRegistry")).toThrow(/Present: Midnight/);
  });

  it("throws listing available markets", () => {
    const manifest = parseDeploymentManifest(validManifest());
    expect(() => requireMarket(manifest, "nope")).toThrow(/Available: usdc-30d-weth/);
  });
});
