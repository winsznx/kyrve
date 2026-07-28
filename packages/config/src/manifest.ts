/**
 * Deployment manifest — the single artifact that makes a Kyrve deployment addressable.
 *
 * Nothing in Kyrve accepts a bare contract address. Every consumer takes a manifest, and every
 * manifest carries the evidence needed to decide whether the addresses in it are the ones this
 * build expects: the Midnight release commit, the runtime bytecode hashes, the compiler and EVM
 * target, the market structs the ids were derived from, and the licence disclosure that was in
 * force when it was written.
 *
 * That is a deliberate constraint. "Silently switch releases" and "accept an arbitrary unvalidated
 * deployment address" are the two ways an integration package quietly stops proving anything.
 */

export type Address = `0x${string}`;
export type Hash = `0x${string}`;

export interface CollateralParamsRecord {
  readonly token: Address;
  /** WAD-scaled liquidation loan-to-value. */
  readonly lltv: string;
  /** WAD-scaled liquidation cursor. */
  readonly liquidationCursor: string;
  readonly oracle: Address;
}

/**
 * The Midnight `Market` struct, verbatim and in declaration order.
 *
 * Field order is load-bearing: `IdLib.toId` hashes `abi.encode(market)`, so reordering these
 * changes every market id. Source: vendor/midnight/src/interfaces/IMidnight.sol.
 */
export interface MarketRecord {
  readonly chainId: string;
  readonly midnight: Address;
  readonly loanToken: Address;
  readonly collateralParams: readonly CollateralParamsRecord[];
  /** Unix seconds. */
  readonly maturity: string;
  readonly rcfThreshold: string;
  readonly enterGate: Address;
  readonly liquidatorGate: Address;
}

export interface MarketEntry {
  /** Stable human key, e.g. "usdc-30d-weth". Never used on chain. */
  readonly key: string;
  readonly label: string;
  /** keccak256 per IdLib.toId — a CREATE2 address hash, not keccak(abi.encode(market)). */
  readonly id: Hash;
  readonly market: MarketRecord;
  readonly tickSpacing: number;
  /** Settlement-fee cbp values, indexes 0..6, as configured at deployment. */
  readonly settlementFeeCbp: readonly number[];
  readonly continuousFee: string;
  /** Hash of the generated rate grid for this market. Links markets.json to rate-grids. */
  readonly rateGridHash: Hash;
}

export interface ContractRecord {
  readonly address: Address;
  /** keccak256 of the deployed runtime bytecode, read back from chain after deployment. */
  readonly runtimeBytecodeHash: Hash;
  /** Present only for proxies. */
  readonly implementation?: Address;
  readonly deploymentTxHash: Hash | null;
  readonly constructorArgs: readonly string[];
  /** Path within this repository or within vendor/midnight. */
  readonly sourcePath: string;
  readonly verifiedSource: "verified" | "pending" | "unavailable" | "not-applicable";
  readonly explorerUrl: string | null;
}

export interface CompilerRecord {
  readonly solc: string;
  readonly evmVersion: string;
  readonly viaIr: boolean;
  readonly optimizer: boolean;
  readonly optimizerRuns: number;
  readonly bytecodeHash: string;
}

export interface ProtocolPins {
  readonly midnightRelease: string;
  readonly midnightCommit: string;
  readonly noxProtocolContracts: string;
  readonly noxConfidentialContracts: string;
  readonly handleSdk: string;
}

export interface RoleRecord {
  readonly configurator: Address;
  readonly feeSetter: Address;
  readonly feeClaimer: Address;
  readonly tickSpacingSetter: Address;
}

export interface DeploymentManifest {
  readonly schemaVersion: 1;
  readonly environment: string;
  readonly chainId: number;
  /** ISO 8601. Set at deployment time, never regenerated. */
  readonly deployedAt: string;
  readonly deploymentBlock: string;
  readonly deployer: Address;
  readonly compiler: CompilerRecord;
  readonly pins: ProtocolPins;
  readonly roles: RoleRecord;
  readonly contracts: Readonly<Record<string, ContractRecord>>;
  readonly markets: readonly MarketEntry[];
  /**
   * keccak256 of LICENSE as of this deployment. A deployment whose licence disclosure has since
   * changed is detectable rather than silently stale.
   */
  readonly licenceDisclosureHash: Hash;
  readonly sourceUrl: string;
  /** Free-form, but must state that this is a non-production replica. Asserted by the validator. */
  readonly disclosure: string;
}

// -------------------------------------------------------------------------------------------
// Validation
// -------------------------------------------------------------------------------------------

export class ManifestError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`deployment manifest: ${path}: ${message}`);
    this.name = "ManifestError";
  }
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const UINT_RE = /^(0|[1-9][0-9]*)$/;

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestError(path, `expected an object, received ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

function str(source: Record<string, unknown>, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ManifestError(
      `${path}.${key}`,
      `expected a non-empty string, received ${describe(value)}`,
    );
  }
  return value;
}

function num(source: Record<string, unknown>, key: string, path: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ManifestError(
      `${path}.${key}`,
      `expected a finite number, received ${describe(value)}`,
    );
  }
  return value;
}

function bool(source: Record<string, unknown>, key: string, path: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean") {
    throw new ManifestError(`${path}.${key}`, `expected a boolean, received ${describe(value)}`);
  }
  return value;
}

function address(source: Record<string, unknown>, key: string, path: string): Address {
  const value = str(source, key, path);
  if (!ADDRESS_RE.test(value)) {
    throw new ManifestError(
      `${path}.${key}`,
      `expected a 20-byte hex address, received "${value}"`,
    );
  }
  return value as Address;
}

function hash(source: Record<string, unknown>, key: string, path: string): Hash {
  const value = str(source, key, path);
  if (!HASH_RE.test(value)) {
    throw new ManifestError(`${path}.${key}`, `expected a 32-byte hex hash, received "${value}"`);
  }
  return value as Hash;
}

/** Big integers are carried as decimal strings so a manifest never loses precision through JSON. */
function uint(source: Record<string, unknown>, key: string, path: string): string {
  const value = source[key];
  // The realistic mistake is writing a bare JSON number, which silently loses precision above
  // 2^53 — and maturities, WAD-scaled fees and unit amounts all exceed that. Name it exactly.
  if (typeof value === "number") {
    throw new ManifestError(
      `${path}.${key}`,
      `expected a decimal integer string, received the JSON number ${value}. Big integers must be ` +
        "strings: JSON numbers are IEEE-754 doubles and lose precision above 2^53.",
    );
  }
  const text = str(source, key, path);
  if (!UINT_RE.test(text)) {
    throw new ManifestError(
      `${path}.${key}`,
      `expected a decimal integer string with no sign, decimal point or leading zero, received "${text}"`,
    );
  }
  return text;
}

function array(source: Record<string, unknown>, key: string, path: string): unknown[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    throw new ManifestError(`${path}.${key}`, `expected an array, received ${describe(value)}`);
  }
  return value;
}

function parseCollateral(value: unknown, path: string): CollateralParamsRecord {
  const source = record(value, path);
  return {
    token: address(source, "token", path),
    lltv: uint(source, "lltv", path),
    liquidationCursor: uint(source, "liquidationCursor", path),
    oracle: address(source, "oracle", path),
  };
}

function parseMarket(value: unknown, path: string): MarketRecord {
  const source = record(value, path);
  const collateral = array(source, "collateralParams", path);
  if (collateral.length === 0) {
    throw new ManifestError(
      `${path}.collateralParams`,
      "Midnight rejects a market with no collateral params",
    );
  }
  return {
    chainId: uint(source, "chainId", path),
    midnight: address(source, "midnight", path),
    loanToken: address(source, "loanToken", path),
    collateralParams: collateral.map((c, i) =>
      parseCollateral(c, `${path}.collateralParams[${i}]`),
    ),
    maturity: uint(source, "maturity", path),
    rcfThreshold: uint(source, "rcfThreshold", path),
    enterGate: address(source, "enterGate", path),
    liquidatorGate: address(source, "liquidatorGate", path),
  };
}

function parseMarketEntry(value: unknown, path: string): MarketEntry {
  const source = record(value, path);
  const fees = array(source, "settlementFeeCbp", path);
  if (fees.length !== 7) {
    throw new ManifestError(
      `${path}.settlementFeeCbp`,
      `Midnight stores exactly 7 settlement-fee buckets (0d, 1d, 7d, 30d, 90d, 180d, 360d), received ${fees.length}`,
    );
  }
  for (const [i, fee] of fees.entries()) {
    if (typeof fee !== "number" || !Number.isInteger(fee) || fee < 0 || fee > 0xffff) {
      throw new ManifestError(
        `${path}.settlementFeeCbp[${i}]`,
        `settlement fee cbp is a uint16, received ${describe(fee)} ${String(fee)}`,
      );
    }
  }
  const tickSpacing = num(source, "tickSpacing", path);
  if (!Number.isInteger(tickSpacing) || tickSpacing <= 0) {
    throw new ManifestError(
      `${path}.tickSpacing`,
      `expected a positive integer, received ${tickSpacing}`,
    );
  }
  return {
    key: str(source, "key", path),
    label: str(source, "label", path),
    id: hash(source, "id", path),
    market: parseMarket(source["market"], `${path}.market`),
    tickSpacing,
    settlementFeeCbp: fees as number[],
    continuousFee: uint(source, "continuousFee", path),
    rateGridHash: hash(source, "rateGridHash", path),
  };
}

function parseContract(value: unknown, path: string): ContractRecord {
  const source = record(value, path);
  const verified = str(source, "verifiedSource", path);
  if (!["verified", "pending", "unavailable", "not-applicable"].includes(verified)) {
    throw new ManifestError(
      `${path}.verifiedSource`,
      `expected one of verified|pending|unavailable|not-applicable, received "${verified}"`,
    );
  }
  const args = array(source, "constructorArgs", path);
  for (const [i, arg] of args.entries()) {
    if (typeof arg !== "string") {
      throw new ManifestError(
        `${path}.constructorArgs[${i}]`,
        `expected a string, received ${describe(arg)}`,
      );
    }
  }
  const explorerUrl = source["explorerUrl"];
  if (explorerUrl !== null && typeof explorerUrl !== "string") {
    throw new ManifestError(
      `${path}.explorerUrl`,
      `expected a string or null, received ${describe(explorerUrl)}`,
    );
  }
  const txHash = source["deploymentTxHash"];
  if (txHash !== null && (typeof txHash !== "string" || !HASH_RE.test(txHash))) {
    throw new ManifestError(
      `${path}.deploymentTxHash`,
      `expected a 32-byte hex hash or null, received ${describe(txHash)}`,
    );
  }

  const parsed: ContractRecord = {
    address: address(source, "address", path),
    runtimeBytecodeHash: hash(source, "runtimeBytecodeHash", path),
    deploymentTxHash: txHash as Hash | null,
    constructorArgs: args as string[],
    sourcePath: str(source, "sourcePath", path),
    verifiedSource: verified as ContractRecord["verifiedSource"],
    explorerUrl: explorerUrl as string | null,
  };

  if (source["implementation"] !== undefined) {
    return { ...parsed, implementation: address(source, "implementation", path) };
  }
  return parsed;
}

/**
 * Parses and validates a deployment manifest, throwing a `ManifestError` naming the exact field
 * on the first violation.
 *
 * This is intentionally strict rather than permissive. A manifest is the artifact that tells
 * production code which contracts to trust; a lenient parser here would let a malformed or
 * partially-written manifest reach the settlement path.
 */
export function parseDeploymentManifest(value: unknown): DeploymentManifest {
  const source = record(value, "$");

  const schemaVersion = num(source, "schemaVersion", "$");
  if (schemaVersion !== 1) {
    throw new ManifestError(
      "$.schemaVersion",
      `unsupported schema version ${schemaVersion}, this build reads 1`,
    );
  }

  const compiler = record(source["compiler"], "$.compiler");
  const pins = record(source["pins"], "$.pins");
  const roles = record(source["roles"], "$.roles");
  const contracts = record(source["contracts"], "$.contracts");
  const markets = array(source, "markets", "$");

  if (markets.length === 0) {
    throw new ManifestError("$.markets", "a deployment with no markets cannot serve a quote");
  }

  const disclosure = str(source, "disclosure", "$");
  if (!/non-production/i.test(disclosure)) {
    throw new ManifestError(
      "$.disclosure",
      "must state that this deployment is a non-production replica. The Morpho BUSL-1.1 Additional " +
        "Use Grant is empty (verified 2026-07-28), so only non-production use is granted. See LICENSE.",
    );
  }

  const parsedContracts: Record<string, ContractRecord> = {};
  for (const [name, entry] of Object.entries(contracts)) {
    parsedContracts[name] = parseContract(entry, `$.contracts.${name}`);
  }

  const parsedMarkets = markets.map((m, i) => parseMarketEntry(m, `$.markets[${i}]`));

  const chainId = num(source, "chainId", "$");
  for (const market of parsedMarkets) {
    if (market.market.chainId !== String(chainId)) {
      throw new ManifestError(
        `$.markets[${parsedMarkets.indexOf(market)}].market.chainId`,
        `market chainId ${market.market.chainId} does not match manifest chainId ${chainId}. ` +
          "Midnight embeds chainId in the Market struct, so this would produce an unusable market id.",
      );
    }
  }

  const duplicateKeys = parsedMarkets
    .map((m) => m.key)
    .filter((key, i, all) => all.indexOf(key) !== i);
  if (duplicateKeys.length > 0) {
    throw new ManifestError(
      "$.markets",
      `duplicate market keys: ${[...new Set(duplicateKeys)].join(", ")}`,
    );
  }

  return {
    schemaVersion: 1,
    environment: str(source, "environment", "$"),
    chainId,
    deployedAt: str(source, "deployedAt", "$"),
    deploymentBlock: uint(source, "deploymentBlock", "$"),
    deployer: address(source, "deployer", "$"),
    compiler: {
      solc: str(compiler, "solc", "$.compiler"),
      evmVersion: str(compiler, "evmVersion", "$.compiler"),
      viaIr: bool(compiler, "viaIr", "$.compiler"),
      optimizer: bool(compiler, "optimizer", "$.compiler"),
      optimizerRuns: num(compiler, "optimizerRuns", "$.compiler"),
      bytecodeHash: str(compiler, "bytecodeHash", "$.compiler"),
    },
    pins: {
      midnightRelease: str(pins, "midnightRelease", "$.pins"),
      midnightCommit: str(pins, "midnightCommit", "$.pins"),
      noxProtocolContracts: str(pins, "noxProtocolContracts", "$.pins"),
      noxConfidentialContracts: str(pins, "noxConfidentialContracts", "$.pins"),
      handleSdk: str(pins, "handleSdk", "$.pins"),
    },
    roles: {
      configurator: address(roles, "configurator", "$.roles"),
      feeSetter: address(roles, "feeSetter", "$.roles"),
      feeClaimer: address(roles, "feeClaimer", "$.roles"),
      tickSpacingSetter: address(roles, "tickSpacingSetter", "$.roles"),
    },
    contracts: parsedContracts,
    markets: parsedMarkets,
    licenceDisclosureHash: hash(source, "licenceDisclosureHash", "$"),
    sourceUrl: str(source, "sourceUrl", "$"),
    disclosure,
  };
}

/** Returns a contract record or throws naming what is missing. Never returns undefined. */
export function requireContract(manifest: DeploymentManifest, name: string): ContractRecord {
  const found = manifest.contracts[name];
  if (found === undefined) {
    throw new ManifestError(
      `$.contracts.${name}`,
      `absent from the ${manifest.environment} manifest. Present: ${Object.keys(manifest.contracts).join(", ")}`,
    );
  }
  return found;
}

/** Returns a market entry by key or throws naming what is available. */
export function requireMarket(manifest: DeploymentManifest, key: string): MarketEntry {
  const found = manifest.markets.find((m) => m.key === key);
  if (found === undefined) {
    throw new ManifestError(
      "$.markets",
      `no market with key "${key}" in the ${manifest.environment} manifest. ` +
        `Available: ${manifest.markets.map((m) => m.key).join(", ")}`,
    );
  }
  return found;
}
