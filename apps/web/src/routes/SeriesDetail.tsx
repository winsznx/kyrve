/**
 * `/app/series/:seriesId` — one series, and confidential ownership of it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE ROUTE PARAMETER IS RESOLVED AGAINST THE RECORD, AND NEVER FALLS BACK
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * An id this deployment does not know renders as "not on this deployment", not as layer A's series
 * under someone else's heading. That is `scripts/lib/layer.ts`'s rule expressed in the interface: a
 * layer B page that read layer A's addresses would look like it worked and would prove nothing.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * FOUR QUANTITIES THAT ARE NOT THE SAME NUMBER
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The winning leaf's capacity, the published aggregate, the Midnight units and the borrower's assets
 * all differ on the measured fixture, and minting against units over-issues by 600 (delta T-1). The
 * ownership panel shows the two it is allowed to — the published aggregate and the public credit —
 * side by side, so a reader can see that supply is principal and credit is Midnight's denomination.
 * The leaf's own capacity is private forever: publishing it would disclose it by subtraction.
 */

import type { ReactElement } from "react";

import { Empty, Facts } from "../components/Facts.js";
import { OwnershipBand } from "../components/OwnershipBand.js";
import { RequiresWallet } from "../components/RequiresWallet.js";
import { Why } from "../components/Why.js";
import { abbreviate, formatTimestamp } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { layerBySeriesId } from "../lib/records.js";
import { Link } from "../router/router.js";

export function SeriesDetail({ seriesId }: { seriesId: `0x${string}` }): ReactElement {
  const { record } = useKyrve();
  const layer = layerBySeriesId(record, seriesId);

  if (layer === undefined) {
    return (
      <section className="band">
        <h1>Series</h1>
        <Empty title="This series is not on this deployment" testId="series-unknown">
          <p>
            The record being served names no series with id <span className="mono">{seriesId}</span>
            . This page will not fall back to another series: a page that showed layer A's numbers
            under a layer B identifier would look like it worked and would be describing a stack it
            never touched.
          </p>
          <p>
            <Link to="/app/series" className="row-link">
              Every series this deployment does hold
            </Link>
          </p>
        </Empty>
      </section>
    );
  }

  const { series, market } = layer;

  return (
    <>
      <section className="band">
        <span className="eyebrow">
          {layer.label} · {series.loanTokenSymbol}
        </span>
        <h1>Series {abbreviate(series.seriesId)}</h1>
        <p className="lede">
          A public credit position at Midnight, and confidential claims on it. Every identifier
          below is public the moment it exists; every number is read from chain state at render
          time.
        </p>
        <Facts
          testId="series-public-facts"
          facts={[
            { label: "Series", value: <span className="mono">{series.seriesId}</span> },
            { label: "Midnight market", value: <span className="mono">{series.marketId}</span> },
            { label: "Maturity", value: formatTimestamp(series.maturity) },
            {
              label: "Series vault (the maker)",
              value: <span className="mono">{series.vault}</span>,
            },
            { label: "Loan token", value: <span className="mono">{series.loanToken}</span> },
            {
              label: "Settled quote",
              value: <Link to={`/app/quotes/${series.quoteId}`}>{abbreviate(series.quoteId)}</Link>,
            },
          ]}
        />
      </section>

      <RequiresWallet purpose="read your own claim on this series">
        {(session) => <OwnershipBand session={session} series={series} />}
      </RequiresWallet>

      <section className="band">
        <div className="grid">
          <div className="card">
            <h2>Exit this series</h2>
            {market?.addresses.KyrveCrossBook === undefined ? (
              <p className="lede" data-testid="cross-unavailable">
                No Cross book is deployed over this series, so there is no confidential secondary
                transfer for it here. That is a fact about this deployment and not a verdict about
                the series. Reporting it as either would state something nobody measured.
              </p>
            ) : (
              <>
                <p className="lede">
                  A Cross order moves a confidential claim between two parties without either
                  balance becoming public. The escrow is a real handle and only its owner can read
                  it.
                </p>
                <Link to={`/app/cross/${series.seriesId}`} className="ghost">
                  Submit a Cross order
                </Link>
              </>
            )}
          </div>

          <div className="card">
            <h2>Disclose selectively</h2>
            {market?.addresses.KyrveCapsuleVault === undefined ? (
              <p className="lede" data-testid="capsule-unavailable">
                No Capsule vault is deployed over this series.
              </p>
            ) : (
              <>
                <p className="lede">
                  A capsule freezes a snapshot of one value and grants one recipient the ability to
                  decrypt it. The grant is permanent — Nox has no <code>removeViewer</code> — so the
                  capsule's expiry stops it asserting, not its recipient decrypting.
                </p>
                <Link to="/app/capsules" className="ghost">
                  Create a capsule
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="band">
        <div className="card">
          <h2>Verify</h2>
          <p className="lede">
            The proof page states each fact, reads this chain for it, and compares. The deployment
            record supplies addresses and never a verdict.
          </p>
          <Link to={`/proof/series/${series.seriesId}`} className="ghost">
            Recompute this series from chain state
          </Link>
        </div>
      </section>

      <section className="band">
        <Why title="Four quantities here, and no two of them are the same number">
          <p>
            The winning leaf’s capacity, the published aggregate, the units Midnight recorded and
            the assets the borrower received all differ. On the settled run they differ by small
            amounts, which is what makes the mistake easy: minting against units instead of the
            aggregate over-issues by 600.
          </p>
          <p>
            Supply is the published aggregate. Credit is Midnight’s denomination. The leaf’s own
            capacity stays private forever, because publishing it would reveal it by subtraction.
          </p>
        </Why>
      </section>
    </>
  );
}
