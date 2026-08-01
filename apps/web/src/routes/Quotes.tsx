/**
 * `/app/quotes` — one quote, and the act of making it public.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE COLLECTION PAGE IS ALSO THE ACTION PAGE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Because before activation there is no quote id to route to. An epoch produces a publicly decrypted
 * leaf; activation is what turns that into a quote with an identifier, and it can happen once per
 * epoch, forever. A `/app/quotes/:quoteId` page that had to exist before the id did would either
 * invent one or route on the epoch id and call it a quote — and the difference between an epoch's leaf
 * and an activated quote is the entire reason `KyrveSettlementRatifier` exists.
 *
 * So this page holds the lifecycle — verify, activate, refuse a partial fill, settle exactly — and
 * `/app/quotes/:quoteId` is the record of one that already exists.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * AN ABSENT QUOTE SHOWS AS AN ABSENT QUOTE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A quote exists only after a confidential epoch has run, been publicly decrypted and been activated:
 * minutes of off-chain computation this page cannot bootstrap. Rendering the panel with placeholder
 * terms is exactly the placeholder proof `.claude/rules/frontend.md` forbids, so when the served
 * record carries no finished epoch the page says so and names the command that produces one.
 */

import type { ReactElement } from "react";

import { Empty } from "../components/Facts.js";
import { QuoteBand } from "../components/QuoteBand.js";
import { RequiresWallet } from "../components/RequiresWallet.js";
import { Why } from "../components/Why.js";
import { abbreviate } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { layersOf, settlementsOf } from "../lib/records.js";
import { Link } from "../router/router.js";

export function Quotes(): ReactElement {
  const { record } = useKyrve();
  /*
   * Only a settlement carrying a FINISHED EPOCH can drive the activation panel.
   *
   * A deployed record names the registry so a quote can be verified, and carries no candidate,
   * because a candidate is an epoch plus its gateway proofs and inventing that shape would be a
   * placeholder proof. `QuoteBand` reads `candidate` directly, so filtering here is what keeps the
   * page an honest empty state rather than a crash on a public URL.
   */
  const settlements = settlementsOf(record).filter(
    (entry) => entry.settlement.candidate !== undefined,
  );
  const layers = layersOf(record);

  return (
    <>
      <section className="band">
        <span className="eyebrow">Borrower · step two</span>
        <h1>Quotes</h1>
        <p className="lede">
          One confidential epoch produces one leaf: a market, a rate and an aggregate amount.
          Verifying it costs nothing and reveals nothing. Activating it is the moment those three
          become public — and it can happen once per epoch, forever.
        </p>
      </section>

      {settlements.length === 0 ? (
        <section className="band">
          <Empty title="No finished epoch is being served" testId="quotes-empty">
            <p>
              A quote exists only after a confidential epoch has run, been publicly decrypted and
              been activated. That is minutes of off-chain computation against a real Nox stack, not
              something this page can start.
            </p>
            <p>
              Locally: <code className="mono">pnpm stack:local</code> brings up the node, the Nox
              stack and a deployment, and the browser demonstration drives a whole epoch end to end.
              The panel appears here once the record carries a real finished epoch — a panel
              rendered with placeholder terms would be a placeholder proof.
            </p>
          </Empty>
        </section>
      ) : (
        settlements.map(({ tag, settlement }) => (
          <RequiresWallet
            key={tag}
            purpose="verify, activate and settle a quote — all three bind to your wallet"
          >
            {(session) => <QuoteBand settlement={settlement} session={session} />}
          </RequiresWallet>
        ))
      )}

      {layers.length === 0 ? null : (
        <section className="band">
          <h2>Quotes that already settled</h2>
          <p className="lede">
            Each of these is the record of a quote that has been through activation and exact-fill
            settlement. Every number on its page is read from chain state.
          </p>
          <ul className="rows" data-testid="settled-quotes">
            {layers.map((layer) => (
              <li key={layer.tag}>
                <span className="eyebrow">{layer.label}</span>
                <Link to={`/app/quotes/${layer.series.quoteId}`} className="row-link">
                  {abbreviate(layer.series.quoteId)}
                </Link>
                <p className="note">
                  Series <span className="mono">{abbreviate(layer.series.seriesId)}</span> ·{" "}
                  <Link to={`/proof/quote/${layer.series.quoteId}`} className="row-link">
                    verify this quote
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="band">
        <Why title="Exact fill is enforced twice because neither check can do it alone">
          <p>
            <code>isRatified</code> is a view and never receives the unit count, so it can confirm
            the offer and the taker are authentic and can never enforce size. Midnight itself
            permits a partial fill.
          </p>
          <p>
            <code>onBuy</code> is the only place the actual fill size reaches maker code, so that is
            where an exact match is required. Reverting there rolls back the entire take, including
            the credit and the debt.
          </p>
        </Why>
      </section>
    </>
  );
}
