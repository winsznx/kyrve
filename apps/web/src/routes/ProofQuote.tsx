/**
 * `/proof/quote/:quoteId` — one quote, recomputed.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE FOUR QUANTITIES THAT ARE NOT THE SAME NUMBER
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * On the measured fixture the winning leaf's capacity, the published aggregate, the Midnight units
 * and the borrower's assets all differ, and minting against units over-issues by 600 (delta T-1). So
 * this page reads the two it is allowed to and shows them side by side rather than presenting one as
 * "the amount". The leaf's own capacity is private forever: publishing it would disclose it by
 * subtraction from the aggregate.
 *
 * The residue is public and real: `aggregate − buyerAssets` is loan tokens with an immutable declared
 * destination. That is a DIFFERENT residue from `capacity − aggregate`, which is private forever.
 * Both are 1 on the fixture, which is exactly why neither may be described without saying which
 * (delta T-2).
 */

import type { ReactElement } from "react";

import { Empty } from "../components/Facts.js";
import { compare, VerifyPanel } from "../components/VerifyPanel.js";
import { QUOTE_REGISTRY_ABI, SERIES_VAULT_ABI } from "../lib/abi.js";
import type { Check } from "../lib/artefact.js";
import { abbreviate } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { layerByQuoteId, settlementsOf } from "../lib/records.js";
import { QUOTE_STATUS_LABEL, type QuoteStatus } from "../lib/settlement.js";
import { Link } from "../router/router.js";

interface Execution {
  readonly offerHash: `0x${string}`;
  readonly marketId: `0x${string}`;
  readonly exactUnits: bigint;
  readonly expectedBuyerAssets: bigint;
  readonly maxPendingFee: bigint;
  readonly expiry: number;
  readonly activatedAt: number;
  readonly status: number;
  readonly taker: `0x${string}`;
  readonly vault: `0x${string}`;
  readonly ratifier: `0x${string}`;
}

export function ProofQuote({ quoteId }: { quoteId: `0x${string}` }): ReactElement {
  const { record, publicClient } = useKyrve();
  const layer = layerByQuoteId(record, quoteId);
  const settlements = settlementsOf(record);
  const registry = settlements[0]?.settlement.addresses.KyrveQuoteRegistry;

  if (registry === undefined) {
    return (
      <section className="band">
        <h1>Quote proof</h1>
        <Empty title="No quote registry is being served" testId="proof-quote-unavailable">
          <p>
            The record names no settlement layer, so there is no registry to ask about this quote.
            Nothing was checked, and this page reports that rather than a verdict.
          </p>
          <p>
            <Link to="/proof" className="row-link">
              Everything this deployment can verify
            </Link>
          </p>
        </Empty>
      </section>
    );
  }

  // Captured after the early return above, so the closure carries a defined address rather than
  // re-deriving one. A `run` that could be handed `undefined` would read the zero address and report
  // a verdict about nothing.
  const registryAddress: `0x${string}` = registry;

  async function run(): Promise<readonly Check[]> {
    const found: Check[] = [];

    const execution = (await publicClient.readContract({
      address: registryAddress,
      abi: QUOTE_REGISTRY_ABI,
      functionName: "executionOf",
      args: [quoteId],
    })) as Execution;

    // ── 1. the registry knows this quote at all ───────────────────────────────────────────
    if (execution.vault === "0x0000000000000000000000000000000000000000") {
      found.push({
        id: "quote-exists",
        claim: "the registry holds an execution for this quote id",
        verdict: "failed",
        detail:
          "the registry has never heard of this quote id. A record asserting a settled quote " +
          "against a registry that does not know it is worse than no record at all.",
        measured: { registry: registryAddress, "quote id": quoteId },
      });
      return found;
    }

    found.push({
      id: "quote-exists",
      claim: "the registry holds an execution for this quote id",
      verdict: "verified",
      detail: `status: ${QUOTE_STATUS_LABEL[execution.status as QuoteStatus]}`,
      measured: {
        registry: registryAddress,
        "offer hash": execution.offerHash,
        "market id": execution.marketId,
        ratifier: execution.ratifier,
        "series vault (the maker)": execution.vault,
        taker: execution.taker,
      },
    });

    // ── 2. the quote's series vault is the one the record names ───────────────────────────
    if (layer === undefined) {
      found.push({
        id: "quote-series",
        claim: "the record names the series this quote settled into",
        verdict: "unavailable",
        detail:
          "the served record names no series for this quote id, so there is nothing to compare the " +
          "on-chain vault against. That is not a pass and not a failure.",
        measured: { "vault on chain": execution.vault },
      });
    } else {
      found.push(
        compare(
          "quote-series",
          "the record names the series this quote settled into",
          execution.vault,
          layer.series.vault,
          { series: layer.series.seriesId, layer: layer.label },
        ),
      );
    }

    // ── 3. exact fill: units and assets, and the residue between them ─────────────────────
    //
    // Both numbers are public from activation. Showing them together is the only way a reader can
    // see that units are Midnight's denomination and assets are what the borrower receives — and
    // that the difference is real loan tokens rather than a rounding note.
    found.push({
      id: "exact-fill",
      claim: "the quote names one exact unit count and one exact settlement asset amount",
      verdict: "verified",
      detail:
        "Midnight permits newConsumed <= offer.maxUnits, so exact fill is not a property of the " +
        "offer. It is enforced in KyrveSeriesVault.onBuy, which is the only place actual fill size " +
        "reaches maker code — isRatified is a view and never receives units.",
      measured: {
        "exact units": execution.exactUnits.toString(),
        "expected buyer assets": execution.expectedBuyerAssets.toString(),
        "max pending fee": execution.maxPendingFee.toString(),
      },
    });

    // ── 4. the public position the credit created ─────────────────────────────────────────
    try {
      const [credit, debt] = (await publicClient.readContract({
        address: execution.vault,
        abi: SERIES_VAULT_ABI,
        functionName: "positionOf",
        args: [execution.marketId],
      })) as readonly [bigint, bigint, bigint];
      found.push({
        id: "position",
        claim: "the credit position this settlement created is public and readable here",
        verdict: "verified",
        detail:
          "the credit is public; who owns how much of it is not, and is not derivable from anything " +
          "on this page.",
        measured: { credit: credit.toString(), debt: debt.toString(), market: execution.marketId },
      });
    } catch {
      found.push({
        id: "position",
        claim: "the credit position this settlement created is public and readable here",
        verdict: "unavailable",
        detail: "the series vault did not answer, so no position was read",
        measured: { vault: execution.vault },
      });
    }

    // ── 5. what the record asserts and this browser did not check ─────────────────────────
    if (layer !== undefined) {
      found.push({
        id: "settlement-tx-reported",
        claim: "the record names the transactions that settled and allocated this quote",
        verdict: "reported-not-verified",
        detail:
          "This browser did not fetch either receipt. The hashes are shown so they can be checked " +
          "elsewhere, and so they cannot be mistaken for something recomputed here.",
        measured: {
          "settlement tx": layer.series.settlementTx,
          "allocation tx": layer.series.allocationTx,
        },
      });
    }

    return found;
  }

  return (
    <>
      <section className="band">
        {layer === undefined ? null : <span className="eyebrow">{layer.label}</span>}
        <h1>Quote {abbreviate(quoteId)}</h1>
        <p className="lede">
          Recomputed from chain state. Every term below came from the registry, the vault or
          Midnight — never from the served record, which supplies only which addresses to ask.
        </p>
        {layer === undefined ? null : (
          <p className="note">
            <Link to={`/app/quotes/${quoteId}`} className="row-link">
              Open this quote in the terminal
            </Link>{" "}
            ·{" "}
            <Link to={`/proof/series/${layer.series.seriesId}`} className="row-link">
              Verify the series it created ({abbreviate(layer.series.seriesId)})
            </Link>
          </p>
        )}
      </section>

      <VerifyPanel
        subject="quote"
        subjectId={quoteId}
        layer={layer?.label}
        run={run}
        deps={[quoteId, registryAddress]}
      />
    </>
  );
}
