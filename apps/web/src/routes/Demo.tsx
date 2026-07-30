/**
 * `/demo` — a presenter's map of the real lifecycle. Not a fake-data mode.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * NOTHING HERE FABRICATES STATE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every stage links to the real route it happens on, and every stage's "done" mark is read from the
 * same chain state the rest of the product reads. A demo mode that painted a finished lifecycle on
 * an empty deployment would be the exact fabricated proof `.claude/rules/frontend.md` forbids — and
 * would be worse here than anywhere else, because a demonstration is precisely where somebody is
 * being asked to believe a claim they cannot check in the room.
 *
 * So this page cannot make anything happen. It tells the presenter where to be and shows whether the
 * protocol agrees it has happened yet.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * LOCAL ONLY, AND THAT IS A PROPERTY OF THE DEPLOYMENT RATHER THAN A FLAG
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The control renders when the served record says chain 31337. A build flag could be set by anybody;
 * the chain id is a fact about what the page is pointed at. On a public network this route says so
 * and offers the verification pages instead, which is what a reader on Sepolia actually wants.
 */

import type { ReactElement } from "react";

import { Empty } from "../components/Facts.js";
import { MandateState } from "../lib/abi.js";
import { useKyrve } from "../lib/context.js";
import { useJourney } from "../lib/journey.js";
import { capsuleVaultsOf, layersOf, rollOf } from "../lib/records.js";
import { QuoteStatus } from "../lib/settlement.js";
import { Link } from "../router/router.js";

interface DemoStage {
  readonly n: number;
  readonly title: string;
  /** What the presenter says while it is on screen. One sentence. */
  readonly say: string;
  readonly to: string;
  /** Whether the chain agrees this has happened. Never a stored flag. */
  readonly done: boolean;
}

export function Demo(): ReactElement {
  const { record, publicClient, session, role } = useKyrve();
  const journey = useJourney(record, publicClient, session?.account, role ?? "provider");
  const layers = layersOf(record);
  const vaults = capsuleVaultsOf(record);
  const roll = rollOf(record);

  if (record.chainId !== 31337) {
    return (
      <section className="band">
        <h1>Demo mode is local only</h1>
        <Empty title={`This page is pointed at chain ${record.chainId}`} testId="demo-not-local">
          <p>
            The presenter's walkthrough drives a local stack where every step can actually be
            performed in front of an audience. On a public network the equivalent is the
            verification surface, which recomputes what already happened.
          </p>
          <p>
            <Link to="/proof" className="row-link">
              Verify this deployment instead
            </Link>
          </p>
        </Empty>
      </section>
    );
  }

  const stages: readonly DemoStage[] = [
    {
      n: 1,
      title: "Provider adds confidential capital",
      say: "Public tokens go in. The amount is public once, forever — that is the honest cost of the boundary.",
      to: "/app/fund",
      done: journey.hasConfidentialBalance,
    },
    {
      n: 2,
      title: "Provider sets private lending terms",
      say: "Thirty-five encrypted fields, the same count whether one market is enabled or eight.",
      to: "/app/mandates",
      done: journey.mandateState !== MandateState.None,
    },
    {
      n: 3,
      title: "Borrower requests a quote",
      say: "The bond is public. How much they want and the most they will pay are not.",
      to: "/app/request",
      done: journey.hasLiveRequest || journey.hasFinishedEpoch,
    },
    {
      n: 4,
      title: "The curve computes",
      say: "Eligibility, capacity, the privacy floor and leaf selection, entirely on ciphertext.",
      to: "/app/curve",
      done: journey.hasFinishedEpoch,
    },
    {
      n: 5,
      title: "One quote appears",
      say: "A market, a rate and an aggregate amount. Every rejected alternative stays encrypted.",
      to: "/app/quotes",
      done: journey.quoteStatus !== QuoteStatus.None,
    },
    {
      n: 6,
      title: "A partial fill is refused",
      say: "Midnight itself permits one. The series vault is what refuses it — this is the load-bearing moment.",
      to: "/app/quotes",
      done: journey.quoteStatus === QuoteStatus.Consumed,
    },
    {
      n: 7,
      title: "Exact settlement succeeds",
      say: "Through unmodified Morpho Midnight, at exactly the size the quote names.",
      to: "/app/quotes",
      done: journey.quoteStatus === QuoteStatus.Consumed,
    },
    {
      n: 8,
      title: "Provider receives confidential ownership",
      say: "The credit position is public. Who owns how much of it is not, and cannot be derived.",
      to:
        journey.claimSeriesId === undefined
          ? "/app/series"
          : `/app/series/${journey.claimSeriesId}`,
      done: journey.hasClaim,
    },
    {
      n: 9,
      title: "Provider shares a disclosure",
      say: "One frozen value, to one wallet, permanently — because Nox has no way to withdraw a grant.",
      to: "/app/capsules",
      done: vaults.length > 0,
    },
    {
      n: 10,
      title: "Auditor decrypts the frozen snapshot",
      say: "And is refused the provider's live balance, on chain, before any key material is released.",
      to: "/app/capsules",
      done: journey.capsulesHeld > 0,
    },
    {
      n: 11,
      title: "Cross and Roll, as completed records",
      say: "A confidential transfer and a confidential migration between two maturities. Both real, both minimal.",
      to: "/app/roll",
      done: roll !== undefined,
    },
    {
      n: 12,
      title: "Verify proves the lifecycle",
      say: "Every claim recomputed from chain state. The record supplies addresses and never a verdict.",
      to: "/proof",
      done: layers.length > 0,
    },
  ];

  const reached = stages.filter((stage) => stage.done).length;

  return (
    <>
      <section className="band">
        <span className="eyebrow">Local demonstration</span>
        <h1>Presenter walkthrough</h1>
        <p className="lede">
          Twelve stages of the real lifecycle, in order, each linking to the page it happens on.
          Nothing here is simulated: a stage is marked complete only when this chain says it is.
        </p>
        <p className="note" data-testid="demo-progress">
          {reached} of {stages.length} stages complete on this deployment.
        </p>
      </section>

      <section className="band">
        <ol className="demo-stages" data-testid="demo-stages">
          {stages.map((stage) => (
            <li
              key={stage.n}
              className={stage.done ? "demo-stage demo-stage-done" : "demo-stage"}
              data-stage={stage.n}
              data-done={stage.done}
            >
              <span className="demo-number" aria-hidden="true">
                {stage.n}
              </span>
              <div>
                <h2>
                  <Link to={stage.to} className="row-link">
                    {stage.title}
                  </Link>
                </h2>
                <p className="note">{stage.say}</p>
                <p className="note demo-state">
                  {stage.done ? "complete on this chain" : "not yet performed on this chain"}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="band">
        <div className="card">
          <h2>Before you present</h2>
          <p className="lede">
            Bring the whole stack up with one command and let it reach READY before opening
            anything: the chain, the confidential runtime, both issuance stacks and the web product
            all come up together, and the page refuses to start against a deployment that is not
            there.
          </p>
          <p className="note mono">pnpm stack:local</p>
          <p className="note">
            There is no hidden prerequisite. If a stage below is not marked complete, performing it
            on its own page is what completes it — in the order shown.
          </p>
        </div>
      </section>
    </>
  );
}
