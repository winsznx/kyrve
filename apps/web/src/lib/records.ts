/**
 * The served deployment record, normalised into layers.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * LAYER A AND LAYER B ARE SEPARATE RECORDS AND MUST STAY SEPARATE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Phase 6 stood up two complete confidential issuance stacks that share zero contracts, because a
 * roll needs two real series and `bindSettler` is one-shot (delta U-1). `scripts/lib/layer.ts`
 * threads `KYRVE_EVIDENCE_TAG` through every script path for one reason, stated there: **a
 * successful layer A flow must never silently satisfy a layer B check.** A layer B page that read
 * layer A's addresses would render a verdict about a stack it never touched.
 *
 * So this module normalises the served JSON into a LIST of layers, each carrying its own tag, its
 * own series record and its own optional market record, and every route takes a layer rather than
 * "the" deployment. There is no accessor that returns "the series" — asking for one without saying
 * which layer is the bug this shape makes unrepresentable.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THE RECORD MAY CONTAIN
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Addresses, identifiers, transaction hashes, decimals and symbols. **No amount, ever.** Not the
 * aggregate, not the credit, not the supply, and certainly not a balance. Every number any page
 * displays is read from chain state at render time or decrypted in this browser by the wallet that
 * owns it — which is what makes a verification page capable of disagreeing with the record instead of
 * reformatting it. `assertRecordCarriesNoAmount` is the runtime half of that rule and the browser
 * demonstration asserts it before it launches.
 */

import { type Deployment, DeploymentUnavailableError } from "./deployment.js";
import type { MarketRecord, SeriesRecord } from "./series.js";
import type { SettlementRecord } from "./settlement.js";

/** Which issuance stack. `a` is the layer every other tool reads by default. */
export type LayerTag = "a" | "b";

export interface LayerRecord {
  readonly tag: LayerTag;
  /** Human-readable, for any surface that must say which layer it is talking about. */
  readonly label: string;
  readonly series: SeriesRecord;
  /** Capsule vault, Cross book, Roll book — each independently optional. */
  readonly market: MarketRecord | undefined;
}

/**
 * The full served record.
 *
 * `series`/`market`/`settlement` at the top level are layer A. Layer B arrives under `layerB`, which
 * is absent on any deployment that has only run one issuance stack — the common case locally, and a
 * coherent state rather than an error.
 */
export interface KyrveRecord extends Deployment {
  readonly series?: SeriesRecord;
  readonly market?: MarketRecord;
  readonly settlement?: SettlementRecord;
  readonly layerB?: {
    readonly series: SeriesRecord;
    readonly market?: MarketRecord;
    readonly settlement?: SettlementRecord;
  };
  /** Present on a local stack, where the gateway's Docker host port is assigned at startup. */
  readonly gatewayUrl?: string;
}

const LABEL: Readonly<Record<LayerTag, string>> = {
  a: "layer A",
  b: "layer B",
};

/**
 * Loads the served record.
 *
 * On failure this throws rather than falling back to a default. A confidential terminal that
 * silently points somewhere else is worse than one that will not start — a balance displayed from a
 * deployment that no longer exists is a confident statement about nothing.
 *
 * `cache: "no-store"` because the record is rewritten by every local deployment, and a cached copy
 * would have the page reading a previous stack's addresses with no indication that it had.
 */
export async function loadRecord(): Promise<KyrveRecord> {
  const response = await fetch("/deployment.json", { cache: "no-store" });
  if (!response.ok) {
    throw new DeploymentUnavailableError(
      `no deployment record is being served (HTTP ${response.status}). Run ` +
        "`pnpm stack:local` to bring up the node, the Nox stack and a deployment together, or " +
        "`pnpm deploy:confidential local` against a stack that is already up.",
    );
  }
  const record = (await response.json()) as KyrveRecord;
  if (record.addresses?.KyrveWrappedAsset === undefined) {
    throw new DeploymentUnavailableError(
      "the deployment record is missing contract addresses; it was probably written by a failed run.",
    );
  }
  return record;
}

/**
 * Every issuance stack the record describes, in tag order.
 *
 * Returns an empty list when no series exists yet, which is a real state: a deployment can carry the
 * confidential books and no settled series at all, and every collection route renders that as
 * "nothing here yet" rather than as an error or as a placeholder row.
 */
export function layersOf(record: KyrveRecord): readonly LayerRecord[] {
  const layers: LayerRecord[] = [];
  if (record.series !== undefined) {
    layers.push({ tag: "a", label: LABEL.a, series: record.series, market: record.market });
  }
  if (record.layerB !== undefined) {
    layers.push({
      tag: "b",
      label: LABEL.b,
      series: record.layerB.series,
      market: record.layerB.market,
    });
  }
  return layers;
}

/** The layer whose series has this id, or nothing. Never falls back to another layer. */
export function layerBySeriesId(record: KyrveRecord, seriesId: string): LayerRecord | undefined {
  const wanted = seriesId.toLowerCase();
  return layersOf(record).find((layer) => layer.series.seriesId.toLowerCase() === wanted);
}

/** The layer whose settled quote has this id, or nothing. */
export function layerByQuoteId(record: KyrveRecord, quoteId: string): LayerRecord | undefined {
  const wanted = quoteId.toLowerCase();
  return layersOf(record).find((layer) => layer.series.quoteId.toLowerCase() === wanted);
}

/** Every settlement block the record carries, tagged by layer. */
export function settlementsOf(
  record: KyrveRecord,
): readonly { readonly tag: LayerTag; readonly settlement: SettlementRecord }[] {
  const found: { tag: LayerTag; settlement: SettlementRecord }[] = [];
  if (record.settlement !== undefined) found.push({ tag: "a", settlement: record.settlement });
  if (record.layerB?.settlement !== undefined) {
    found.push({ tag: "b", settlement: record.layerB.settlement });
  }
  return found;
}

/** Every capsule vault across every layer, so `/app/capsules` can look in both. */
export function capsuleVaultsOf(
  record: KyrveRecord,
): readonly { readonly layer: LayerRecord; readonly vault: `0x${string}` }[] {
  const found: { layer: LayerRecord; vault: `0x${string}` }[] = [];
  for (const layer of layersOf(record)) {
    const vault = layer.market?.addresses.KyrveCapsuleVault;
    if (vault !== undefined) found.push({ layer, vault });
  }
  return found;
}

/**
 * The Roll book, and which two layers it spans.
 *
 * A roll needs two complete series, so the book is only ever meaningful with both layers present.
 * Returning `undefined` when either is missing is not defensive coding — P7-5 forbids an interface
 * that implies a roll exists where one cannot, and a Roll page rendered against one layer would be
 * exactly that.
 */
export function rollOf(
  record: KyrveRecord,
):
  | { readonly book: `0x${string}`; readonly source: LayerRecord; readonly target: LayerRecord }
  | undefined {
  const layers = layersOf(record);
  const source = layers.find((layer) => layer.tag === "a");
  const target = layers.find((layer) => layer.tag === "b");
  const book = source?.market?.addresses.KyrveRollBook ?? target?.market?.addresses.KyrveRollBook;
  if (book === undefined || source === undefined || target === undefined) return undefined;
  return { book, source, target };
}

/**
 * Refuses a record that carries an amount.
 *
 * Called by the browser demonstration before it launches, and by `/proof/deployment` on every load,
 * so the guarantee is checked in the product and not only in a test. The candidate settlement block
 * is exempt by construction and is passed separately: it carries the published aggregate because the
 * activation screen must show the terms BEFORE a quote exists to read them from, and that number is
 * public from publication.
 */
export function assertRecordCarriesNoAmount(
  record: KyrveRecord,
  amounts: readonly (bigint | string)[],
): void {
  const scrubbed: Record<string, unknown> = { ...record };
  delete scrubbed["settlement"];
  const serialised = JSON.stringify(scrubbed);
  for (const amount of amounts) {
    if (serialised.includes(String(amount))) {
      throw new Error(
        `the served record contains the amount ${amount}. Every number on every page is read from ` +
          "chain state or decrypted in this browser; a served amount would make each of them a " +
          "restatement of a file anybody could have written.",
      );
    }
  }
}
