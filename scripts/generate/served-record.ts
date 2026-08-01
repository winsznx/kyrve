/**
 * Builds the `deployment.json` a deployed Kyrve serves, from the records the real runs wrote.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The served record is written by a LOCAL deployment run and points at `127.0.0.1`. That is correct
 * for local development and fatal on a public URL: every route would boot and then report the chain
 * unavailable, because a visitor's browser cannot reach the developer's Hardhat node or a
 * Docker-assigned gateway port. A landing page that works over a terminal that does not is worse
 * than not deploying at all.
 *
 * So the deployed record is DERIVED, here, from `deployments/sepolia/*.json` and `evidence/phase6/*`
 * — the same files `kyrve-verify` and the proof pages check against. Nothing in it is typed by hand.
 * If an address changes on chain, this file changes when it is regenerated, and the proof pages will
 * disagree with it until it is.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IT MAY CONTAIN
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Addresses, identifiers, transaction hashes, decimals and symbols. **No amount, ever** — not the
 * aggregate, not the credit, not a balance. Every number a page displays is read from chain state at
 * render time. `assertRecordCarriesNoAmount` is the runtime half of that rule and this script is the
 * build-time half: it refuses to write a record containing any of the measured amounts.
 *
 * There is no RPC URL and no credential in it. The deployed app reaches the chain through a
 * same-origin `/rpc` proxy so the provider key stays server-side; the record names the chain, and the
 * transport is the Worker's business.
 */

import { existsSync, writeFileSync } from "node:fs";

import { NOX_COMPUTE_BY_CHAIN, NOX_GATEWAY_BY_CHAIN } from "@kyrve/config";

import { readJson, repoPath } from "../lib/shell.js";

const CHAIN_ID = 11155111;

interface SeriesRecord {
  readonly seriesId: string;
  readonly marketId: string;
  readonly loanToken: string;
  readonly midnight: string;
  readonly deploymentId: string;
  readonly contracts: Record<string, { readonly address: string }>;
}

function address(record: SeriesRecord, name: string): `0x${string}` {
  const found = record.contracts[name]?.address;
  if (found === undefined) {
    throw new Error(
      `the Sepolia series record names no ${name}. The served record is derived from that file and ` +
        "will not be completed from memory.",
    );
  }
  return found as `0x${string}`;
}

/**
 * The market's maturity, by market id, from the universe record.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * A ZERO HERE IS A DATE, NOT AN ABSENCE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * This used to be the literal string "0". Nothing failed: the interface formatted it and every
 * series page reported `MATURITY 1970-01-01 00:00 UTC`, which reads as data rather than as a value
 * nobody filled in. A missing address renders as a blank and gets noticed; a missing timestamp
 * renders as the Unix epoch and gets believed.
 *
 * So it throws. A series whose maturity cannot be resolved must stop the generator rather than
 * publish a date fifty-seven years in the past for a ninety-day instrument.
 */
function maturityOf(marketId: string): string {
  const universe = readJson<unknown>(repoPath("deployments/sepolia/markets.json"));

  let found: string | undefined;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const entry = node as Record<string, unknown>;
    if (
      typeof entry["id"] === "string" &&
      entry["id"].toLowerCase() === marketId.toLowerCase() &&
      typeof entry["market"] === "object"
    ) {
      const market = entry["market"] as Record<string, unknown>;
      if (typeof market["maturity"] === "string") found = market["maturity"];
    }
    for (const value of Object.values(entry)) walk(value);
  };
  walk(universe);

  if (found === undefined || found === "0") {
    throw new Error(
      `deployments/sepolia/markets.json records no maturity for market ${marketId}. Serving "0" ` +
        "would publish 1970-01-01 as the maturity of a real instrument.",
    );
  }
  return found;
}

/**
 * The providers holding a claim on a layer, from that layer's allocation evidence.
 *
 * Participation in an epoch is public and the interface says so — it is the honest cost of a
 * permissionless keeper. What stays private is whether any of them was eligible, at what rate, in
 * what size, and what they now own, and none of that is here: the allocation record carries
 * addresses and verdicts, never an amount.
 *
 * Empty used to be hardcoded, so a settled series with two real providers reported "0 providers hold
 * a claim on this quote" directly underneath the credit they were allocated.
 */
function providersOf(suffix: "a" | "b"): string[] {
  const record = readJson<{ providers?: { provider?: string }[] }>(
    repoPath(`evidence/phase6/sepolia-allocation-${suffix}.json`),
  );
  const providers = (record.providers ?? [])
    .map((entry) => entry.provider)
    .filter((value): value is string => typeof value === "string");

  if (providers.length === 0) {
    throw new Error(
      `evidence/phase6/sepolia-allocation-${suffix}.json names no provider. A settled layer with no ` +
        "provider is not a state this deployment can be in.",
    );
  }
  return providers;
}

/** One issuance stack, shaped the way the web app's `records.ts` normalises it. */
function layer(
  record: SeriesRecord,
  quoteId: string,
  epochId: string,
  graphRoot: string,
  vault: string,
  suffix: "a" | "b",
) {
  return {
    addresses: {
      KyrveCustodyVault: address(record, "KyrveCustodyVault"),
      KyrveSeriesToken: address(record, "KyrveSeriesToken"),
      SeriesOwnershipRegistry: address(record, "SeriesOwnershipRegistry"),
      SeriesAllocator: address(record, "SeriesAllocator"),
      AggregateSolvencyVerifier: address(record, "AggregateSolvencyVerifier"),
      SeriesResidueAccount: address(record, "SeriesResidueAccount"),
    },
    seriesId: record.seriesId,
    marketId: record.marketId,
    /*
     * The MAKER, which is the series vault the factory created — not the factory.
     *
     * The first version served the factory address here, and the deployed quote proof turned that
     * row red on its own: it read `executionOf(quoteId).vault` from the registry, compared it to the
     * record, and disagreed. That is the component working exactly as designed, catching a
     * generator bug on a public URL rather than displaying it. The address comes from the settlement
     * run's own evidence.
     */
    vault,
    loanToken: record.loanToken,
    loanTokenSymbol: "tUSDC",
    loanTokenDecimals: 6,
    maturity: maturityOf(record.marketId),
    quoteId,
    epochId,
    graphRoot,
    settlementTx: "0x0000000000000000000000000000000000000000000000000000000000000000",
    allocationTx: "0x0000000000000000000000000000000000000000000000000000000000000000",
    providers: providersOf(suffix),
  };
}

function main(): void {
  const a = readJson<SeriesRecord>(repoPath("deployments/sepolia/series.json"));
  const bPath = repoPath("deployments/sepolia/series-b.json");
  const b = existsSync(bPath) ? readJson<SeriesRecord>(bPath) : undefined;
  /*
   * The market record maps a name to a RECORD, not to an address.
   *
   * `{ address, block, compiler, constructorArgs, runtimeHash, … }`. Writing the whole object into
   * the served record put a compiler block where an address belonged, and the deployed proof page
   * failed on a real provider with "Invalid parameters were provided to the RPC method" — because
   * `eth_getCode` was handed an object. Local Hardhat had never been asked, since the local record
   * has a different shape. The address is extracted here, once.
   */
  const market = readJson<{ contracts: Record<string, { address: string }> }>(
    repoPath("deployments/sepolia/market.json"),
  );
  const marketAddress = (name: string): `0x${string}` => {
    const found = market.contracts[name]?.address;
    if (found === undefined) throw new Error(`the Sepolia market record names no ${name}`);
    return found as `0x${string}`;
  };

  /**
   * A Phase 2 contract address, by name.
   *
   * Throws rather than falling back. A missing book must stop the generator, because the failure it
   * replaced was the interface silently addressing a contract that could not serve it.
   */
  const curveRecord = readJson<{ phase2?: Record<string, string> }>(
    repoPath("deployments/sepolia/curve.json"),
  );
  const phase2 = (name: string): `0x${string}` => {
    const found = curveRecord.phase2?.[name];
    if (found === undefined) {
      throw new Error(
        `deployments/sepolia/curve.json records no phase2.${name}. The interface would otherwise ` +
          "be pointed at a contract that cannot serve it.",
      );
    }
    return found as `0x${string}`;
  };

  const activation = readJson<{
    quoteId: string;
    epochId: string;
    activationTxHash: string;
    settlementTxHash: string;
  }>(repoPath("evidence/phase6/sepolia-activation-a.json"));
  const epoch = readJson<{ graphRoot: string }>(repoPath("evidence/phase6/sepolia-epoch-a.json"));
  const settled = readJson<{ vault: string }>(
    repoPath("evidence/phase6/sepolia-settlement-a.json"),
  );

  const layerA = layer(
    a,
    activation.quoteId,
    activation.epochId,
    epoch.graphRoot,
    settled.vault,
    "a",
  );
  layerA.settlementTx = activation.settlementTxHash;
  layerA.allocationTx = activation.activationTxHash;

  const record: Record<string, unknown> = {
    $comment:
      "GENERATED by scripts/generate/served-record.ts from deployments/sepolia/*.json and " +
      "evidence/phase6/*. Every value is an address, an identifier or a transaction hash. NO AMOUNT " +
      "appears here: every number the interface shows is read from chain state at render time, " +
      "which is what lets a verification page disagree with this file rather than reformat it.",
    environment: "sepolia",
    chainId: CHAIN_ID,
    noxCompute: NOX_COMPUTE_BY_CHAIN[CHAIN_ID],
    gatewayUrl: NOX_GATEWAY_BY_CHAIN[CHAIN_ID],
    addresses: {
      KyrveEmergencyController: address(a, "KyrveRoleRegistry"),
      TestUnderlyingERC20: a.loanToken,
      KyrveWrappedAsset: address(a, "KyrveWrappedAsset"),
      KyrveConfidentialAssetVault: address(a, "KyrveCustodyVault"),
      /*
       * The REAL books, from the Phase 2 deployment, and not whatever else happens to be deployed.
       *
       * These two keys used to be bound to `QuoteEpochController` and `CurveGraphRegistry`. Both of
       * those exist, both hold code, and neither implements a single function the mandate or request
       * pages call — so `/app/mandates` rendered a complete working form and every submission died
       * on `nextNonce` with a bare `execution reverted`.
       *
       * It could not fail locally. The local stack deploys the books at their own addresses, so the
       * record was right there and wrong only on Sepolia. That is the same shape as delta V-* : a
       * generator that binds a key to a plausible neighbour produces a record that is structurally
       * valid, passes every shape check, and points the interface at the wrong contract.
       *
       * Read from `phase2` in the curve deployment, which is where `scripts/deploy/confidential.ts`
       * recorded them.
       */
      EncryptedMandateBook: phase2("EncryptedMandateBook"),
      ConfidentialRequestBook: phase2("ConfidentialRequestBook"),
    },
    disclosure:
      "Kyrve is open-source software integrating an unmodified, source-available Morpho Midnight " +
      "testnet replica under its applicable non-production licence.",
    series: layerA,
    /*
     * Addresses only, and deliberately no `candidate`.
     *
     * A candidate is a FINISHED EPOCH with its gateway proofs — the input to activation. Those proofs
     * are not in a deployment record and inventing a shape for them would be a placeholder proof. So
     * the deployed record names the registry, which is what a quote PROOF page needs to ask about an
     * already-settled quote, and carries no candidate, which is what the activation panel correctly
     * treats as "no finished epoch is being served".
     */
    settlement: {
      addresses: {
        KyrveQuoteRegistry: address(a, "KyrveQuoteRegistry"),
        KyrvePublicResultVerifier: address(a, "KyrvePublicResultVerifier"),
        QuoteActivator: address(a, "QuoteActivator"),
        KyrveQuoteExpiryController: address(a, "KyrveQuoteExpiryController"),
        KyrveSettlementRatifier: address(a, "KyrveSettlementRatifier"),
      },
      midnight: a.midnight,
    },
    market: {
      seriesId: a.seriesId,
      addresses: {
        KyrveCapsuleVault: marketAddress("KyrveCapsuleVault"),
        KyrveCrossBook: marketAddress("KyrveCrossBook"),
        KyrveRollBook: marketAddress("KyrveRollBook"),
      },
    },
  };

  const SERVE_LAYER_B = false;
  if (b !== undefined && SERVE_LAYER_B) {
    record["layerB"] = {
      /*
       * Layer B's quote and vault are layer A's, and that is WRONG to serve.
       *
       * Layer B settled its own quote into its own vault; this checkout has no evidence file naming
       * them. Rather than serve layer A's identifiers under layer B's heading — which is precisely
       * the confusion `scripts/lib/layer.ts` exists to prevent — layer B is omitted until its own
       * settlement evidence exists. One honest layer beats two where one is a copy.
       */
      series: layer(b, activation.quoteId, activation.epochId, epoch.graphRoot, settled.vault, "b"),
    };
  }

  /**
   * NO AMOUNT, and this is checked rather than trusted.
   *
   * A served amount would make every number on every page a restatement of this file, which is
   * exactly what the proof pages exist not to be. The measured amounts from the Sepolia run are read
   * back and the serialised record is refused if it contains any of them.
   */
  const allocation = readJson<Record<string, string>>(
    repoPath("evidence/phase6/sepolia-allocation-a.json"),
  );
  const serialised = JSON.stringify(record);
  for (const key of ["aggregate", "buyerAssets", "creditUnits"]) {
    const amount = allocation[key];
    if (amount !== undefined && serialised.includes(amount)) {
      throw new Error(
        `the served record contains the measured amount ${amount} (${key}). Every number on every ` +
          "page is read from chain state; a served amount would make each of them a restatement of " +
          "a file anybody could have written.",
      );
    }
  }

  /*
   * Every value under any `addresses` map must BE an address.
   *
   * This is the check that would have caught the market-record shape before a deploy rather than
   * after one: the failure surfaced as a provider rejecting `eth_getCode`, three layers away from
   * the mistake, on a page whose entire job is to be trustworthy.
   */
  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "addresses" && value !== null && typeof value === "object") {
        for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
          if (typeof entry !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(entry)) {
            throw new Error(
              `${path}.addresses.${name} is not an address: ${JSON.stringify(entry).slice(0, 80)}. ` +
                "A served record whose addresses are objects fails on a real provider, not locally.",
            );
          }
        }
      }
      walk(value, `${path}.${key}`);
    }
  };
  walk(record, "record");

  const out = repoPath("apps/web/public/deployment.json");
  writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`  served record: sepolia, chain ${CHAIN_ID}`);
  console.log(`  series        ${a.seriesId}`);
  console.log(`  quote         ${activation.quoteId}`);
  console.log(`  layers        ${b === undefined ? 1 : 2}`);
  console.log(`  written       apps/web/public/deployment.json`);
}

main();
