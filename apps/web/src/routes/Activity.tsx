/**
 * `/app/activity` — what has happened, in sentences.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * EVENTS, NOT LOGS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every row is a thing that happened, written the way somebody would say it out loud, with the
 * transaction available behind "transaction details" rather than in front of it. A row reading
 * `OfferPublished(0x9f3a…, 0x11c2…)` is a log line; a reader has to already know the protocol to get
 * anything from it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * EVERY ROW IS A PUBLIC FACT READ FROM CHAIN STATE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Nothing here is decrypted and nothing here is a stored notification. The activity list is derived
 * from the same reads the home screen makes, so it cannot say something happened that the chain does
 * not agree happened — which is what separates it from a feed a server could have written.
 *
 * When a stage has not been reached, the row is absent rather than rendered as pending-with-a-zero.
 */

import type { ReactElement } from "react";

import { Empty } from "../components/Facts.js";
import { Workflow } from "../components/Workflow.js";
import { MandateState } from "../lib/abi.js";
import { abbreviate, formatTimestamp } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { useJourney } from "../lib/journey.js";
import { layersOf } from "../lib/records.js";
import { QuoteStatus } from "../lib/settlement.js";
import { Link } from "../router/router.js";

interface Entry {
  readonly what: string;
  readonly detail: string;
  /** Where the reader goes to see it in full. */
  readonly to: string;
  /** Public identifiers, behind a disclosure. Never in the sentence itself. */
  readonly technical?: Readonly<Record<string, string>> | undefined;
}

export function Activity(): ReactElement {
  const { record, publicClient, session, role } = useKyrve();
  const journey = useJourney(record, publicClient, session?.account, role ?? "provider");
  const layers = layersOf(record);

  const entries: Entry[] = [];

  if (journey.hasConfidentialBalance) {
    entries.push({
      what: "You funded a confidential balance",
      detail:
        "Public tokens became a confidential ERC-7984 balance. The amount you wrapped is public " +
        "permanently; everything after it is encrypted.",
      to: "/app/fund",
    });
  }

  if (journey.mandateState !== MandateState.None) {
    entries.push({
      what: "Your lending terms were sealed",
      detail:
        journey.mandateState === MandateState.Active
          ? `Live on epoch ${journey.mandateEpoch ?? "not recorded"}. The submission carried the same 35 encrypted fields it always does, so its shape says nothing about its contents.`
          : `Currently ${journey.mandateState === MandateState.Paused ? "paused" : "retired"}. Nothing is matched against them in this state.`,
      to: "/app/mandates",
    });
  }

  if (journey.hasLiveRequest) {
    entries.push({
      what: "Your request was sealed",
      detail:
        "The bond is public; how much you want, the least you would take and every rate limit are " +
        "encrypted and stay that way.",
      to: "/app/request",
    });
  }

  if (journey.hasFinishedEpoch) {
    entries.push({
      what: "The private matching completed",
      detail:
        "One leaf was published: a market, a rate and an aggregate amount. Every alternative it " +
        "considered stayed encrypted, and no reason was produced for anything it rejected.",
      to: "/app/curve",
    });
  }

  if (journey.quoteStatus === QuoteStatus.Executable) {
    entries.push({
      what: "A quote became executable",
      detail: "It settles at exactly its size. A partial fill is refused by the series vault.",
      to: "/app/quotes",
      technical: journey.quoteId === undefined ? undefined : { quote: journey.quoteId },
    });
  }

  if (journey.quoteStatus === QuoteStatus.Consumed) {
    entries.push({
      what: "A quote settled through Morpho Midnight",
      detail:
        "The credit position is public. Who owns how much of it is confidential and is not derivable " +
        "from anything on chain.",
      to: journey.quoteId === undefined ? "/app/quotes" : `/app/quotes/${journey.quoteId}`,
      technical: journey.quoteId === undefined ? undefined : { quote: journey.quoteId },
    });
  }

  if (journey.hasClaim && journey.claimSeriesId !== undefined) {
    entries.push({
      what: "You received confidential ownership",
      detail: "Your share of the settled credit is a value only you can read.",
      to: `/app/series/${journey.claimSeriesId}`,
      technical: { series: journey.claimSeriesId },
    });
  }

  if (journey.capsulesHeld > 0) {
    entries.push({
      what: `${journey.capsulesHeld} disclosure${journey.capsulesHeld === 1 ? "" : "s"} granted to you`,
      detail:
        "A frozen snapshot of somebody's position. You can decrypt that one value, permanently, and " +
        "nothing else.",
      to:
        journey.firstCapsuleId === undefined
          ? "/app/capsules"
          : `/app/capsules/${journey.firstCapsuleId}`,
    });
  }

  return (
    <>
      <section className="band">
        <span className="eyebrow">Activity</span>
        <h1>What has happened</h1>
        <p className="lede">
          Every line below is a public fact read from the chain just now, not a stored notification.
          Nothing here is decrypted.
        </p>
      </section>

      <section className="band activity-progress">
        <span className="eyebrow">Your progress</span>
        <h2>What Kyrve can confirm for this wallet</h2>
        <Workflow journey={journey} role={role ?? "provider"} testId="activity-workflow" />
      </section>

      <section className="band">
        {entries.length === 0 ? (
          <Empty title="Nothing has happened on this wallet yet" testId="activity-empty">
            <p>
              This is not an empty feed waiting to fill. The chain has no record of this wallet
              doing anything on this deployment. Your first action will appear here.
            </p>
            <p>
              <Link to="/app" className="row-link">
                See what to do first
              </Link>
            </p>
          </Empty>
        ) : (
          <ul className="rows" data-testid="activity">
            {entries.map((entry) => (
              <li key={entry.what}>
                <h2>
                  <Link to={entry.to} className="row-link">
                    {entry.what}
                  </Link>
                </h2>
                <p className="note">{entry.detail}</p>
                {entry.technical === undefined ? null : (
                  <details className="advanced">
                    <summary>Transaction details</summary>
                    <dl className="facts">
                      {Object.entries(entry.technical).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {layers.length === 0 ? null : (
        <section className="band">
          <h2>On this deployment</h2>
          <ul className="rows" data-testid="deployment-activity">
            {layers.map((layer) => (
              <li key={layer.tag}>
                <h3>
                  <Link to={`/app/series/${layer.series.seriesId}`} className="row-link">
                    A series settled and issued confidential ownership
                  </Link>
                </h3>
                <p className="note">
                  {layer.label} · matures {formatTimestamp(layer.series.maturity)} ·{" "}
                  <Link to={`/proof/series/${layer.series.seriesId}`} className="row-link">
                    verify it
                  </Link>
                </p>
                <details className="advanced">
                  <summary>Transaction details</summary>
                  <dl className="facts">
                    <div>
                      <dt>series</dt>
                      <dd>{layer.series.seriesId}</dd>
                    </div>
                    <div>
                      <dt>quote</dt>
                      <dd>{abbreviate(layer.series.quoteId)}</dd>
                    </div>
                  </dl>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
