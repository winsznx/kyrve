/**
 * `/app/series` — every confidential series this deployment holds, per issuance stack.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE LIST IS BY LAYER, NOT MERGED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Phase 6 stood up two complete issuance stacks that share zero contracts, because one custody vault
 * serves exactly one series and `bindSettler` is one-shot (delta U-1). Merging them into an
 * undifferentiated list would invite exactly the confusion `scripts/lib/layer.ts` exists to prevent:
 * a layer B claim read through layer A's addresses looks like a working page and proves nothing.
 *
 * So each layer is its own group, labelled, and every link carries the series id rather than an index.
 *
 * NO AMOUNT APPEARS HERE. Not the supply, not the coverage, not a balance. A series' numbers are read
 * on its own page, from chain state, and its confidential ones are decrypted in the browser by the
 * wallet that owns them.
 */

import type { ReactElement } from "react";

import { Empty } from "../components/Facts.js";
import { abbreviate, formatTimestamp } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { layersOf } from "../lib/records.js";
import { Link } from "../router/router.js";

export function SeriesList(): ReactElement {
  const { record } = useKyrve();
  const layers = layersOf(record);

  return (
    <>
      <section className="band">
        <span className="eyebrow">Provider · Positions</span>
        <h1>Settled positions</h1>
        <p className="lede">
          A series is what a settled quote leaves behind: a public credit position at Midnight, and
          confidential claims on it. The credit is public. Who owns how much of it is not, and
          cannot be derived from anything on this page.
        </p>
      </section>

      {layers.length === 0 ? (
        <section className="band">
          <Empty title="No series has been issued on this deployment" testId="series-empty">
            <p>
              A series exists after a quote has settled through unmodified Midnight and the
              allocator has minted claims against the credit it created. Until then there is nothing
              to own, and a placeholder position would be a page confidently displaying ownership
              nobody holds.
            </p>
            <p>
              Start at{" "}
              <Link to="/app/fund" className="row-link">
                funding a confidential balance
              </Link>{" "}
              A position appears only after exact settlement has completed.
            </p>
          </Empty>
        </section>
      ) : (
        <section className="band">
          {/*
            A list page still owes the reader one dominant action.

            Opening the first position is it — not "verify", which is a different intent, and not a
            row of equally weighted links, which is the flat surface this pass is correcting. The
            cobalt lives here and nowhere else on the page.
          */}
          <div className="actions" style={{ marginTop: 0, marginBottom: 24 }}>
            <Link
              to={`/app/series/${layers[0]?.series.seriesId ?? ""}`}
              className="primary"
              data-testid="open-first-position"
            >
              Open {layers.length === 1 ? "the position" : "a position"}
            </Link>
          </div>
          <ul className="rows" data-testid="series-list">
            {layers.map((layer) => (
              <li key={layer.tag} data-testid={`series-row-${layer.tag}`}>
                <span className="eyebrow">
                  {layer.label} · {layer.series.loanTokenSymbol}
                </span>
                <h2>
                  <Link to={`/app/series/${layer.series.seriesId}`} className="row-link">
                    {abbreviate(layer.series.seriesId)}
                  </Link>
                </h2>
                <dl className="facts">
                  <div>
                    <dt>Maturity</dt>
                    <dd>{formatTimestamp(layer.series.maturity)}</dd>
                  </div>
                  <div>
                    <dt>Midnight market</dt>
                    <dd>{abbreviate(layer.series.marketId)}</dd>
                  </div>
                  <div>
                    <dt>Series vault (the maker)</dt>
                    <dd>{abbreviate(layer.series.vault)}</dd>
                  </div>
                  <div>
                    <dt>Settled quote</dt>
                    <dd>
                      <Link to={`/app/quotes/${layer.series.quoteId}`}>
                        {abbreviate(layer.series.quoteId)}
                      </Link>
                    </dd>
                  </div>
                </dl>
                <p className="note">
                  {layer.series.providers.length} provider
                  {layer.series.providers.length === 1 ? "" : "s"} hold a claim on this quote.
                  Participation in an epoch is public. It is the honest cost of a permissionless
                  keeper. What stays private is whether any of them was eligible, at what rate, in
                  what size, and what they now own.
                </p>
                <p className="note">
                  <Link to={`/proof/series/${layer.series.seriesId}`} className="row-link">
                    Verify this series from chain state
                  </Link>
                  {layer.market?.addresses.KyrveCrossBook === undefined ? null : (
                    <>
                      {" · "}
                      <Link to={`/app/cross/${layer.series.seriesId}`} className="row-link">
                        Cross out of it
                      </Link>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
