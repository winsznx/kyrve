/**
 * `/app/quotes/:quoteId` — the record of one quote, read from chain state.
 *
 * The lifecycle — verify, activate, refuse a partial fill, settle exactly — lives on `/app/quotes`,
 * because before activation there is no quote id to route to. This page is what exists afterwards:
 * the public terms, the position they created, and the two numbers that are not the same number.
 *
 * `exactUnits` and `expectedBuyerAssets` are both public from activation and they differ. Units are
 * Midnight's denomination; assets are what the borrower receives. The difference is real loan tokens
 * with an immutable declared destination — not a rounding note, and not the same residue as
 * `capacity − aggregate`, which is private forever (delta T-2).
 */

import type { ReactElement } from "react";

import { Empty, Facts } from "../components/Facts.js";
import { QUOTE_REGISTRY_ABI, SERIES_VAULT_ABI } from "../lib/abi.js";
import { abbreviate, formatAmount, formatTimestamp, useChainRead } from "../lib/chain.js";
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

export function QuoteDetail({ quoteId }: { quoteId: `0x${string}` }): ReactElement {
  const { record, publicClient } = useKyrve();
  const layer = layerByQuoteId(record, quoteId);
  const registry = settlementsOf(record)[0]?.settlement.addresses.KyrveQuoteRegistry;
  const decimals = layer?.series.loanTokenDecimals ?? 6;
  const symbol = layer?.series.loanTokenSymbol ?? "";

  const read = useChainRead(async () => {
    if (registry === undefined) return undefined;
    const execution = (await publicClient.readContract({
      address: registry,
      abi: QUOTE_REGISTRY_ABI,
      functionName: "executionOf",
      args: [quoteId],
    })) as Execution;

    if (execution.vault === "0x0000000000000000000000000000000000000000") {
      return { execution: undefined, position: undefined };
    }
    const [credit, debt] = (await publicClient.readContract({
      address: execution.vault,
      abi: SERIES_VAULT_ABI,
      functionName: "positionOf",
      args: [execution.marketId],
    })) as readonly [bigint, bigint, bigint];
    return { execution, position: { credit, debt } };
  }, [quoteId, registry]);

  if (registry === undefined) {
    return (
      <section className="band">
        <h1>Quote</h1>
        <Empty title="No settlement layer is being served" testId="quote-no-registry">
          <p>
            The record names no quote registry, so there is nothing to ask about this id. Nothing
            was read, and that is reported rather than turned into a verdict about the quote.
          </p>
          <p>
            <Link to="/app/quotes" className="row-link">
              Quotes on this deployment
            </Link>
          </p>
        </Empty>
      </section>
    );
  }

  if (read.state === "unavailable") {
    return (
      <section className="band">
        <h1>Quote {abbreviate(quoteId)}</h1>
        <Empty title="The registry could not be read" testId="quote-unavailable">
          <p>
            The node did not answer, so nothing was checked. This is availability, not
            authorisation, and it is not a statement about whether the quote exists.
          </p>
          <p className="note">{read.error}</p>
        </Empty>
      </section>
    );
  }

  const execution = read.value?.execution;

  if (read.state === "done" && execution === undefined) {
    return (
      <section className="band">
        <h1>Quote {abbreviate(quoteId)}</h1>
        <Empty title="The registry has never heard of this quote" testId="quote-unknown">
          <p>
            <span className="mono">{quoteId}</span> is not an execution this registry holds. A page
            asserting a settled quote against a registry that does not know it would be worse than
            no page at all, so this one says so instead.
          </p>
          <p>
            <Link to="/app/quotes" className="row-link">
              Quotes on this deployment
            </Link>
          </p>
        </Empty>
      </section>
    );
  }

  return (
    <>
      <section className="band">
        {layer === undefined ? null : <span className="eyebrow">{layer.label}</span>}
        <h1>Quote {abbreviate(quoteId)}</h1>
        <p className="lede">
          Public from activation: the selected market, the selected rate, the aggregate amount and
          the approved borrower. Not public, and not derivable from anything here: the rest of the
          curve, every provider allocation, every leaf capacity, and how many providers are behind
          this fill.
        </p>

        {execution === undefined ? (
          <p className="lede" aria-busy="true">
            Reading the registry…
          </p>
        ) : (
          <>
            <div className="card">
              <div className="quote-figures">
                <div>
                  <span className="eyebrow">Exact units</span>
                  <div className="quote-figure" data-testid="detail-units">
                    {execution.exactUnits.toLocaleString("en-GB")}
                  </div>
                  <p className="note">
                    Midnight's denomination. Settlement is at exactly this count.
                  </p>
                </div>
                <div>
                  <span className="eyebrow">Buyer assets</span>
                  <div className="quote-figure" data-testid="detail-assets">
                    {formatAmount(execution.expectedBuyerAssets, decimals)} {symbol}
                  </div>
                  <p className="note">
                    What the borrower receives. Derived by rounding down from the units, so the
                    maker never owes more than providers committed.
                  </p>
                </div>
                <div>
                  <span className="eyebrow">Status</span>
                  <div className="quote-figure" data-testid="detail-status">
                    {QUOTE_STATUS_LABEL[execution.status as QuoteStatus]}
                  </div>
                  <p className="note">Read from the registry, not from the record.</p>
                </div>
              </div>
            </div>

            <Facts
              testId="quote-detail-facts"
              facts={[
                { label: "Quote", value: <span className="mono">{quoteId}</span> },
                { label: "Offer hash", value: <span className="mono">{execution.offerHash}</span> },
                { label: "Market", value: <span className="mono">{execution.marketId}</span> },
                { label: "Ratifier", value: <span className="mono">{execution.ratifier}</span> },
                {
                  label: "Series vault (the maker)",
                  value: <span className="mono">{execution.vault}</span>,
                },
                {
                  label: "Approved taker",
                  value:
                    execution.taker === "0x0000000000000000000000000000000000000000" ? undefined : (
                      <span className="mono">{execution.taker}</span>
                    ),
                  absent: "no taker recorded on this execution",
                },
                {
                  label: "Expiry",
                  value:
                    execution.expiry === 0 ? undefined : formatTimestamp(BigInt(execution.expiry)),
                  absent: "this execution carries no expiry",
                },
                {
                  label: "Activated at",
                  value:
                    execution.activatedAt === 0
                      ? undefined
                      : formatTimestamp(BigInt(execution.activatedAt)),
                  absent: "not activated",
                },
                {
                  label: "Public credit",
                  value: read.value?.position?.credit.toLocaleString("en-GB"),
                  absent: "the vault did not answer",
                },
                {
                  label: "Public debt",
                  value: read.value?.position?.debt.toLocaleString("en-GB"),
                  absent: "the vault did not answer",
                },
              ]}
            />
          </>
        )}
      </section>

      <section className="band">
        <div className="card">
          <h2>Verify</h2>
          <p className="lede">
            Every term above is read from the registry and the vault. The proof page states each one
            as a claim, reads the chain for it, and compares against the served record.
          </p>
          <Link to={`/proof/quote/${quoteId}`} className="ghost">
            Recompute this quote from chain state
          </Link>
          {layer === undefined ? null : (
            <p className="note">
              <Link to={`/app/series/${layer.series.seriesId}`} className="row-link">
                The series this quote created
              </Link>
            </p>
          )}
        </div>
      </section>
    </>
  );
}
