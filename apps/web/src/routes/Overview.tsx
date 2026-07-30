/**
 * `/app` — what you hold, what is happening, and the one thing to do next.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * FOUR QUESTIONS, IN THIS ORDER
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   what do I own or owe?      the portfolio summary, per role
 *   what is happening?         the timeline, read from chain state
 *   what should I do next?     one dominant action, never three
 *   what finished recently?    the completion state, said plainly
 *
 * The previous version of this screen answered none of them. It explained the architecture — two
 * enforcement points, the exact-fill argument, the layer separation — all of which is true, all of
 * which belongs behind "how this was computed", and none of which tells a provider whether they have
 * anything to do this morning.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * NO INVENTED ZEROS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A portfolio row with nothing in it says what is absent and what would fill it. Rendering "0" for a
 * confidential balance would be a claim about a value this page has not read and could not read —
 * every amount here is a HANDLE's existence, never its contents, and the page decrypts nothing.
 */

import type { ReactElement } from "react";

import { Facts } from "../components/Facts.js";
import { NextAction, Workflow } from "../components/Workflow.js";
import { MANDATE_STATE_LABEL, MandateState } from "../lib/abi.js";
import { abbreviate } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { useJourney } from "../lib/journey.js";
import { capsuleVaultsOf, layersOf } from "../lib/records.js";
import { ROLE_ACTIONS, ROLE_COPY, type Role } from "../lib/role.js";
import { QUOTE_STATUS_LABEL, QuoteStatus } from "../lib/settlement.js";
import { Link } from "../router/router.js";
import { Start } from "./Start.js";

export function Overview(): ReactElement {
  const { record, publicClient, session, role, onboarded } = useKyrve();

  /*
   * The journey is read BEFORE the onboarding branch, unconditionally.
   *
   * Hooks cannot sit behind an early return, and the alternative — duplicating the whole screen — is
   * how two copies of one dashboard drift. `provider` stands in while no role is chosen; nothing is
   * rendered from it in that case, and every read it makes is a public one.
   */
  const journey = useJourney(record, publicClient, session?.account, role ?? "provider");
  const layers = layersOf(record);
  const vaults = capsuleVaultsOf(record).length;

  /**
   * A first-time reader is onboarded, not dropped into a dashboard.
   *
   * Rendered rather than redirected so the address bar still says `/app` — a redirect on first visit
   * makes the product's own home page feel like somewhere you are not allowed to be, and makes a
   * shared link land somewhere the sender did not mean.
   */
  if (role === undefined || !onboarded) return <Start />;

  const actions = ROLE_ACTIONS[role];

  return (
    <>
      <section className="band">
        <span className="eyebrow">{ROLE_COPY[role].label}</span>
        <h1>Your Kyrve</h1>
        <p className="lede">{ROLE_COPY[role].promise}</p>
      </section>

      <section className="band">
        <NextAction journey={journey} />
      </section>

      {/*
        The timeline appears only when there is one.

        With no wallet connected there are no stages to show, and a heading standing over nothing is
        exactly the dead vertical space this pass is removing — it reads as a section that failed to
        load rather than as one that does not apply yet.
      */}
      <section className="band">
        {journey.stages.length === 0 ? null : (
          <>
            <h2>Where this is up to</h2>
            <Workflow journey={journey} />
          </>
        )}
        {journey.error === undefined ? null : (
          <p className="note" role="alert" data-testid="journey-error">
            Some of this could not be read from the chain, so parts of the picture are missing
            rather than empty. {journey.error}
          </p>
        )}
      </section>

      <section className="band">
        <h2>What you hold</h2>
        <Portfolio role={role} journey={journey} layerCount={layers.length} vaults={vaults} />
      </section>

      <section className="band">
        <h2>Things you can do</h2>
        <ul className="rows action-rows" data-testid="role-actions">
          {actions.always.map((action) => (
            <li key={action.path}>
              <Link to={action.path} className="action-row">
                <strong>{action.label}</strong>
                <span>{action.outcome}</span>
              </Link>
            </li>
          ))}
          {journey.claimSeriesId === undefined
            ? null
            : actions.needsSeries.map((build) => {
                const action = build(journey.claimSeriesId as string);
                return (
                  <li key={action.path}>
                    <Link to={action.path} className="action-row">
                      <strong>{action.label}</strong>
                      <span>{action.outcome}</span>
                    </Link>
                  </li>
                );
              })}
        </ul>
      </section>

      <section className="band">
        <details className="advanced" data-testid="advanced">
          <summary>How this works underneath</summary>
          <p className="note">
            Encrypted lending terms and one encrypted requirement go into an epoch. The confidential
            engine evaluates eligibility, capacity, the privacy floor and leaf selection entirely on
            ciphertext, and publishes exactly one leaf: a market, a rate and an aggregate amount.
          </p>
          <p className="note">
            Exact fill is enforced in two places and neither is redundant. <code>isRatified</code>{" "}
            is a view and never receives <code>units</code>, so a ratifier can authenticate an offer
            but can never bound its size; Midnight itself permits a partial fill. The series vault's
            <code> onBuy</code> is the only place actual fill size reaches maker code.
          </p>
          <p className="note">
            <Link to="/proof" className="row-link">
              Recompute all of it from chain state
            </Link>
          </p>
        </details>
      </section>
    </>
  );
}

function Portfolio({
  role,
  journey,
  layerCount,
  vaults,
}: {
  role: Role;
  journey: ReturnType<typeof useJourney>;
  layerCount: number;
  vaults: number;
}): ReactElement {
  if (role === "provider") {
    return (
      <Facts
        testId="portfolio"
        facts={[
          {
            label: "Confidential balance",
            value: journey.hasConfidentialBalance ? "held — readable only by you" : undefined,
            absent: "none yet. Adding capital creates one",
          },
          {
            label: "Lending terms",
            value:
              journey.mandateState === MandateState.None
                ? undefined
                : `${MANDATE_STATE_LABEL[journey.mandateState]}${journey.mandateEpoch === undefined ? "" : `, epoch ${journey.mandateEpoch}`}`,
            absent: "not set. Nothing can be matched to you until they are",
          },
          {
            label: "Settled ownership",
            value: journey.hasClaim ? "you own part of a settled credit position" : undefined,
            absent: "nothing allocated yet",
          },
          {
            label: "Series on this deployment",
            value: layerCount === 0 ? undefined : String(layerCount),
            absent: "no series has been issued here yet",
          },
        ]}
      />
    );
  }

  if (role === "borrower") {
    return (
      <Facts
        testId="portfolio"
        facts={[
          {
            label: "Live request",
            value: journey.hasLiveRequest ? "sealed and awaiting an epoch" : undefined,
            absent: "none. Requesting a quote creates one",
          },
          {
            label: "Quote",
            value:
              journey.quoteStatus === QuoteStatus.None
                ? undefined
                : QUOTE_STATUS_LABEL[journey.quoteStatus],
            absent: "no quote has been activated for you yet",
          },
          {
            label: "Outstanding debt",
            value:
              journey.quoteStatus === QuoteStatus.Consumed
                ? "settled — the credit position is public"
                : undefined,
            absent: "nothing settled yet",
          },
          {
            label: "Quote reference",
            value: journey.quoteId === undefined ? undefined : abbreviate(journey.quoteId),
            absent: "assigned when a quote is activated",
          },
        ]}
      />
    );
  }

  return (
    <Facts
      testId="portfolio"
      facts={[
        {
          label: "Disclosures granted to you",
          value: journey.capsulesHeld === 0 ? undefined : String(journey.capsulesHeld),
          absent: "none yet. A holder grants one to a specific wallet",
        },
        {
          label: "Positions you can verify",
          value: layerCount === 0 ? undefined : String(layerCount),
          absent: "no settled series on this deployment yet",
        },
        {
          label: "Disclosure vaults",
          value: vaults === 0 ? undefined : String(vaults),
          absent: "no capsule vault is deployed here",
        },
      ]}
    />
  );
}
