/**
 * Builds the three deployment artifacts from a broadcast result plus live chain state.
 *
 * Every market id written here is RE-DERIVED in TypeScript from the market struct and compared
 * against the id Midnight itself returned. A manifest that merely copied the chain's answer would
 * prove nothing about whether Kyrve can address those markets.
 */

import { readFileSync } from "node:fs";
import { type Hex, keccak256, toHex } from "viem";
import {
  type ContractRecord,
  type DeploymentManifest,
  type MarketEntry,
  type MarketRecord,
  parseDeploymentManifest,
} from "../../packages/config/src/index.js";
import { type Market, marketId } from "../../packages/midnight/src/index.js";
import { CONTINUOUS_FEE, type RateGrid, SETTLEMENT_FEE_CBP } from "../generate/rate-grids.js";
import { repoPath } from "../lib/shell.js";

export const MARKET_KEYS = [
  "usdc-30d-weth",
  "usdc-90d-weth",
  "usdc-30d-wsteth",
  "usdc-90d-multi",
] as const;

const MARKET_LABELS: Record<string, string> = {
  "usdc-30d-weth": "USDC 30d / WETH",
  "usdc-90d-weth": "USDC 90d / WETH",
  "usdc-30d-wsteth": "USDC 30d / wstETH",
  "usdc-90d-multi": "USDC 90d / WETH + wstETH",
};

const DAY = 86_400;
const LLTV_WETH = 770_000_000_000_000_000n;
const LLTV_WSTETH = 860_000_000_000_000_000n;
const LIQUIDATION_CURSOR = 300_000_000_000_000_000n;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const TICK_SPACING = 4;

export interface RawDeployment {
  readonly chainId: number;
  readonly maturityAnchor: number;
  readonly deployer: Hex;
  readonly midnightRelease: string;
  readonly midnightCommit: string;
  readonly midnightRuntimeHash: Hex;
  readonly Midnight: Hex;
  readonly TestUSDC: Hex;
  readonly TestWETH: Hex;
  readonly TestWstETH: Hex;
  readonly WethOracle: Hex;
  readonly WstethOracle: Hex;
  readonly KyrveOsakaProbe: Hex;
  readonly KyrveProtocolRegistry: Hex;
  readonly KyrveDeploymentVerifier: Hex;
  readonly marketIds: readonly Hex[];
}

export interface BuildArgs {
  readonly environment: string;
  readonly chainId: number;
  readonly raw: RawDeployment;
  readonly deploymentBlock: bigint;
  readonly midnightRuntimeHash: Hex;
  readonly grids: readonly RateGrid[];
  readonly maturityAnchor: number;
  /** Real block timestamp of the deployment, not a fixed constant. */
  readonly deployedAt: Date;
  readonly verifiedSource: ContractRecord["verifiedSource"];
  readonly explorerBase: string | null;
  /** Deployment transaction hashes by lowercased contract address, from the broadcast log. */
  readonly transactionHashes?: ReadonlyMap<string, string>;
}

export interface BuildResult {
  readonly manifest: DeploymentManifest;
  readonly addresses: Record<string, string>;
  readonly markets: { readonly markets: readonly MarketEntry[] };
}

/** Reconstructs the four launch markets exactly as `DeployKyrveSubstrate.s.sol` built them. */
function buildMarkets(raw: RawDeployment, chainId: number, anchor: number): Market[] {
  const weth = {
    token: raw.TestWETH,
    lltv: LLTV_WETH,
    liquidationCursor: LIQUIDATION_CURSOR,
    oracle: raw.WethOracle,
  };
  const wsteth = {
    token: raw.TestWstETH,
    lltv: LLTV_WSTETH,
    liquidationCursor: LIQUIDATION_CURSOR,
    oracle: raw.WstethOracle,
  };
  // touchMarket requires strictly ascending token order, and addresses are not known in advance.
  const pair =
    weth.token.toLowerCase() < wsteth.token.toLowerCase() ? [weth, wsteth] : [wsteth, weth];

  const base = {
    chainId: BigInt(chainId),
    midnight: raw.Midnight,
    loanToken: raw.TestUSDC,
    rcfThreshold: 0n,
    enterGate: ZERO,
    liquidatorGate: ZERO,
  } as const;

  return [
    { ...base, collateralParams: [weth], maturity: BigInt(anchor + 30 * DAY) },
    { ...base, collateralParams: [weth], maturity: BigInt(anchor + 90 * DAY) },
    { ...base, collateralParams: [wsteth], maturity: BigInt(anchor + 30 * DAY) },
    { ...base, collateralParams: pair, maturity: BigInt(anchor + 90 * DAY) },
  ];
}

function toMarketRecord(market: Market): MarketRecord {
  return {
    chainId: market.chainId.toString(),
    midnight: market.midnight,
    loanToken: market.loanToken,
    collateralParams: market.collateralParams.map((c) => ({
      token: c.token,
      lltv: c.lltv.toString(),
      liquidationCursor: c.liquidationCursor.toString(),
      oracle: c.oracle,
    })),
    maturity: market.maturity.toString(),
    rcfThreshold: market.rcfThreshold.toString(),
    enterGate: market.enterGate,
    liquidatorGate: market.liquidatorGate,
  };
}

export function buildManifest(args: BuildArgs): BuildResult {
  const { raw, chainId, maturityAnchor, grids } = args;

  const markets = buildMarkets(raw, chainId, maturityAnchor);

  const entries: MarketEntry[] = markets.map((market, i) => {
    const key = MARKET_KEYS[i] as string;

    // The check that makes this manifest worth anything: re-derive, do not copy.
    const derived = marketId(market);
    const onChain = raw.marketIds[i];
    if (derived.toLowerCase() !== onChain?.toLowerCase()) {
      throw new Error(
        `market id mismatch for ${key}: Midnight returned ${onChain}, Kyrve derived ${derived}. ` +
          "Either the market reconstruction or the IdLib port is wrong; do not publish this manifest.",
      );
    }

    const grid = grids.find((g) => g.marketKey === key);
    if (grid === undefined) throw new Error(`no rate grid generated for market ${key}`);

    return {
      key,
      label: MARKET_LABELS[key] ?? key,
      id: derived,
      market: toMarketRecord(market),
      tickSpacing: TICK_SPACING,
      settlementFeeCbp: SETTLEMENT_FEE_CBP,
      continuousFee: CONTINUOUS_FEE.toString(),
      rateGridHash: grid.gridHash as Hex,
    };
  });

  const explorer = (address: string): string | null =>
    args.explorerBase === null ? null : `${args.explorerBase}/address/${address}`;

  const contract = (
    address: Hex,
    sourcePath: string,
    runtimeHash: Hex,
    constructorArgs: string[] = [],
  ): ContractRecord => ({
    address,
    runtimeBytecodeHash: runtimeHash,
    deploymentTxHash: (args.transactionHashes?.get(address.toLowerCase()) ?? null) as Hex | null,
    constructorArgs,
    sourcePath,
    verifiedSource: args.verifiedSource,
    explorerUrl: explorer(address),
  });

  // Placeholder hash for contracts whose runtime code the caller did not read back. Only Midnight
  // is hashed here because it is the one whose substitution would be catastrophic; the deployment
  // verifier re-reads the rest from chain.
  const unread = keccak256(toHex("unread"));

  const contracts: Record<string, ContractRecord> = {
    Midnight: contract(raw.Midnight, "vendor/midnight/src/Midnight.sol", args.midnightRuntimeHash),
    TestUSDC: contract(raw.TestUSDC, "contracts/integration/TestERC20.sol", unread),
    TestWETH: contract(raw.TestWETH, "contracts/integration/TestERC20.sol", unread),
    TestWstETH: contract(raw.TestWstETH, "contracts/integration/TestERC20.sol", unread),
    WethOracle: contract(raw.WethOracle, "contracts/integration/FixedPriceOracle.sol", unread),
    WstethOracle: contract(raw.WstethOracle, "contracts/integration/FixedPriceOracle.sol", unread),
    KyrveOsakaProbe: contract(
      raw.KyrveOsakaProbe,
      "contracts/registry/KyrveOsakaProbe.sol",
      unread,
    ),
    KyrveProtocolRegistry: contract(
      raw.KyrveProtocolRegistry,
      "contracts/registry/KyrveProtocolRegistry.sol",
      unread,
      [raw.deployer],
    ),
    KyrveDeploymentVerifier: contract(
      raw.KyrveDeploymentVerifier,
      "contracts/registry/KyrveDeploymentVerifier.sol",
      unread,
      [raw.KyrveProtocolRegistry],
    ),
  };

  const licenceDisclosureHash = keccak256(toHex(readFileSync(repoPath("LICENSE"), "utf8")));

  const manifest = parseDeploymentManifest({
    schemaVersion: 1,
    environment: args.environment,
    chainId,
    deployedAt: args.deployedAt.toISOString(),
    deploymentBlock: args.deploymentBlock.toString(),
    deployer: raw.deployer,
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
      configurator: raw.deployer,
      feeSetter: raw.deployer,
      feeClaimer: raw.deployer,
      tickSpacingSetter: raw.deployer,
    },
    contracts,
    markets: entries,
    licenceDisclosureHash,
    sourceUrl: "https://github.com/kyrve/kyrve",
    disclosure:
      "Non-production testnet replica of the pinned Morpho Midnight release 2026-07-23 (dbd8d3d5). " +
      "Deployed by Kyrve under BUSL-1.1 non-production use; the Additional Use Grant was resolved on " +
      "2026-07-28 and found empty. This is NOT an official Morpho deployment, is not maintained by " +
      "Morpho Association, and carries no Morpho branding.",
  });

  const addresses = Object.fromEntries(
    Object.entries(contracts).map(([name, record]) => [name, record.address]),
  );

  return { manifest, addresses, markets: { markets: entries } };
}
