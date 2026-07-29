/**
 * The quote id, computed exactly as `KyrveQuoteId.compute` computes it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS OFF CHAIN AT ALL
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The keeper has to know a quote's id BEFORE it exists, because the id is `offer.group` and the
 * offer is what a borrower must present byte-for-byte. Recomputing it here rather than reading it
 * back from the activation receipt also means the terminal can show, before any signature, the
 * exact identifier that is about to become public.
 *
 * The fold is a plain `abi.encode`, so the only way it can drift from Solidity is a field
 * reordered or retyped on one side. `packages/quote/test/id.test.ts` pins that against a fixture
 * generated FROM the Solidity by `contracts/script/ExportSettlementFixtures.s.sol` — the same
 * discipline `@kyrve/quote-math` uses against the tick table.
 */

import { encodeAbiParameters, type Hex, keccak256 } from "viem";

import type { QuoteExecution, QuoteProvenance } from "./types.js";

/** Versioned. A settlement revision that changes the fold must change this too. */
export const QUOTE_ID_DOMAIN = "kyrve.quote.v1" as const;

/**
 * The exact `abi.encode` tuple `KyrveQuoteId.compute` builds.
 *
 * ORDER AND WIDTH ARE BOTH LOAD-BEARING. `abi.encode` pads every value to a word, so a `uint128`
 * and a `uint256` encode identically for values that fit — but `int24` does NOT encode like
 * `uint24` for negative values, and the tick is signed. Getting that wrong would produce ids that
 * agree for every positive tick and diverge silently for the one case a universe must already have
 * excluded.
 */
const QUOTE_ID_ABI = [
  { name: "domain", type: "string" },
  { name: "deploymentId", type: "bytes32" },
  { name: "epochId", type: "bytes32" },
  { name: "graphRoot", type: "bytes32" },
  { name: "requestId", type: "bytes32" },
  { name: "universeId", type: "bytes32" },
  { name: "marketStructHash", type: "bytes32" },
  { name: "aggregateFillAmount", type: "uint256" },
  { name: "tick", type: "int24" },
  { name: "marketIndex", type: "uint8" },
  { name: "rateIndex", type: "uint8" },
  { name: "leafIndex", type: "uint16" },
  { name: "marketId", type: "bytes32" },
  { name: "exactUnits", type: "uint128" },
  { name: "expectedBuyerAssets", type: "uint128" },
  { name: "maxPendingFee", type: "uint128" },
  { name: "expiry", type: "uint40" },
  { name: "taker", type: "address" },
  { name: "vault", type: "address" },
  { name: "ratifier", type: "address" },
] as const;

/**
 * The identifier that is also `offer.group`.
 *
 * `offerHash` is deliberately not an input: the offer contains the group, which is this id, so
 * folding the hash in would be circular.
 */
export function quoteIdFor(execution: QuoteExecution, provenance: QuoteProvenance): Hex {
  return keccak256(
    encodeAbiParameters(QUOTE_ID_ABI, [
      QUOTE_ID_DOMAIN,
      provenance.deploymentId,
      provenance.epochId,
      provenance.graphRoot,
      provenance.requestId,
      provenance.universeId,
      provenance.marketStructHash,
      provenance.aggregateFillAmount,
      provenance.tick,
      provenance.marketIndex,
      provenance.rateIndex,
      provenance.leafIndex,
      execution.marketId,
      execution.exactUnits,
      execution.expectedBuyerAssets,
      execution.maxPendingFee,
      // `uint40` is narrower than 53 bits, so viem models it as a `number`. The conversion is
      // lossless for every value the type can hold — the maximum is year 36812.
      Number(execution.expiry),
      execution.taker,
      execution.vault,
      execution.ratifier,
    ]),
  );
}

/** `KyrveQuoteRegistry.DEPLOYMENT_ID`: `keccak256(chainId, registry, midnight)`. */
export function deploymentIdFor(chainId: bigint, registry: Hex, midnight: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { name: "chainId", type: "uint256" },
        { name: "registry", type: "address" },
        { name: "midnight", type: "address" },
      ],
      [chainId, registry, midnight],
    ),
  );
}

/** `KyrveSeriesFactory.seriesIdFor`. One market, one series, one vault. */
export function seriesIdFor(deploymentId: Hex, marketId: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { name: "domain", type: "string" },
        { name: "deploymentId", type: "bytes32" },
        { name: "marketId", type: "bytes32" },
      ],
      ["kyrve.series.v1", deploymentId, marketId],
    ),
  );
}
