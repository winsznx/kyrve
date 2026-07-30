/**
 * The route table. Nineteen paths, one shell, one place a page can be added.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE TABLE CARRIES THE TITLE AND THE DESCRIPTION
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Because a route cannot then ship without them. `Router` is the only writer of `document.title` and
 * of the description meta tag, both fields are required by `RouteDefinition`, and
 * `pnpm verify:web` walks every path in this table in a real browser and compares what the
 * document ended up with against what is declared here. A page carrying a stale title from the
 * previous navigation is the classic single-page-application defect, and it is invisible from inside
 * the page until somebody shares a link.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ORDER IS SIGNIFICANT AND THE TABLE DEPENDS ON IT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `matchRoute` walks in declaration order, so a collection is declared before its detail route.
 * `/app/quotes` and `/app/quotes/:quoteId` have different segment counts and cannot collide, but
 * keeping the reading order the same as the matching order is what stops a later editor from
 * inserting `/app/:section` above them.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT HAPPENS BEFORE ANY ROUTE RENDERS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The deployment record loads, or the terminal refuses to start. It does not fall back to a default
 * and it does not render a partial page: a confidential terminal displaying a balance from a
 * deployment that no longer exists is worse than one that will not open.
 */

import type { ReactElement } from "react";

import { Shell } from "./layout/Shell.js";
import { type BootState, KyrveProvider } from "./lib/context.js";
import { type RouteDefinition, Router } from "./router/router.js";
import { Activity } from "./routes/Activity.js";
import { CapsuleDetail } from "./routes/CapsuleDetail.js";
import { Capsules } from "./routes/Capsules.js";
import { Cross } from "./routes/Cross.js";
import { Curve } from "./routes/Curve.js";
import { Demo } from "./routes/Demo.js";
import { Fund } from "./routes/Fund.js";
import { Landing } from "./routes/Landing.js";
import { Mandates } from "./routes/Mandates.js";
import { NotFound } from "./routes/NotFound.js";
import { Overview } from "./routes/Overview.js";
import { Proof } from "./routes/Proof.js";
import { ProofCapsule } from "./routes/ProofCapsule.js";
import { ProofDeployment } from "./routes/ProofDeployment.js";
import { ProofQuote } from "./routes/ProofQuote.js";
import { ProofSeries } from "./routes/ProofSeries.js";
import { QuoteDetail } from "./routes/QuoteDetail.js";
import { Quotes } from "./routes/Quotes.js";
import { RequestPage } from "./routes/Request.js";
import { Roll } from "./routes/Roll.js";
import { SeriesDetail } from "./routes/SeriesDetail.js";
import { SeriesList } from "./routes/SeriesList.js";
import { Start } from "./routes/Start.js";

export const ROUTES: readonly RouteDefinition[] = [
  {
    path: "/",
    title: "One quote. The curve stays private",
    description:
      "Kyrve turns encrypted lender mandates and borrower requirements into one executable Morpho " +
      "Midnight offer, while the full yield curve stays private.",
    render: () => <Landing />,
  },

  // ── The application ───────────────────────────────────────────────────────────────────────
  {
    path: "/app",
    title: "Overview",
    description:
      "What this deployment holds, which issuance stacks exist, and where each journey starts.",
    render: () => <Overview />,
  },
  {
    path: "/app/start",
    title: "Get started",
    description:
      "Choose how you will use Kyrve, connect a wallet, check that everything is running, and begin.",
    render: () => <Start />,
  },
  {
    path: "/app/activity",
    title: "Activity",
    description: "What has happened on this wallet and this deployment, read from chain state.",
    render: () => <Activity />,
  },
  {
    path: "/app/fund",
    title: "Add capital",
    description:
      "Wrap a public ERC-20 balance into a confidential ERC-7984 one, and read your own balance.",
    render: () => <Fund />,
  },
  {
    path: "/app/mandates",
    title: "Lending terms",
    description:
      "Set privately what you will lend, into which markets and at what floor. Replace, pause or " +
      "retire terms you have already set.",
    render: () => <Mandates />,
  },
  {
    path: "/app/request",
    title: "Request a quote",
    description:
      "State privately how much you need and the most you will pay. Only the bond is public.",
    render: () => <RequestPage />,
  },
  {
    path: "/app/curve",
    title: "Private matching",
    description:
      "The confidential computation, stage by stage, and the single result it makes public.",
    render: () => <Curve />,
  },
  {
    path: "/app/quotes",
    title: "Quotes",
    description:
      "Verify a published result, activate one quote, refuse a partial fill, settle exactly.",
    render: () => <Quotes />,
  },
  {
    path: "/app/quotes/:quoteId",
    title: "Quote",
    description:
      "One quote: its public terms, the position it created, and the two amounts that are not the " +
      "same number.",
    render: (params) => <QuoteDetail quoteId={params["quoteId"] as `0x${string}`} />,
  },
  {
    path: "/app/series",
    title: "Positions",
    description: "What you own of settled credit, and every position this deployment holds.",
    render: () => <SeriesList />,
  },
  {
    path: "/app/series/:seriesId",
    title: "Position",
    description:
      "One series: confidential ownership, aggregate supply, public coverage and the solvency verdict.",
    render: (params) => <SeriesDetail seriesId={params["seriesId"] as `0x${string}`} />,
  },
  {
    path: "/app/cross/:seriesId",
    title: "Transfer a position",
    description:
      "Submit a confidential exit or entry order against one series, and read your own escrow.",
    render: (params) => <Cross seriesId={params["seriesId"] as `0x${string}`} />,
  },
  {
    path: "/app/roll",
    title: "Move maturity",
    description:
      "One confidential migration between two maturities. Minimal by construction: one intent " +
      "against one supply between two series.",
    render: () => <Roll />,
  },
  {
    path: "/app/capsules",
    title: "Disclosures",
    description: "Grant one reviewer one frozen value, and open the disclosures granted to you.",
    render: () => <Capsules />,
  },
  {
    path: "/app/capsules/:capsuleId",
    title: "Disclosure",
    description:
      "One capsule: its origin, its scope, its frozen snapshot, and what its expiry does and does " +
      "not do.",
    render: (params) => <CapsuleDetail capsuleId={params["capsuleId"] as `0x${string}`} />,
  },

  // ── Verification ──────────────────────────────────────────────────────────────────────────
  {
    /**
     * The presenter's walkthrough.
     *
     * Declared before `/proof` only because the table is read in order and this keeps the
     * application surfaces together. It renders a refusal on any chain but the local one — the demo
     * drives real actions, and a walkthrough that could not perform them would be a slideshow.
     */
    path: "/demo",
    title: "Demonstration",
    description:
      "A presenter's map of the real local lifecycle. Every stage links to the page it happens on " +
      "and is marked complete only when the chain agrees.",
    render: () => <Demo />,
  },
  {
    path: "/proof",
    title: "Verify",
    description:
      "Recompute what Kyrve claims from chain state. The deployment record supplies addresses and " +
      "is never the source of a verdict.",
    render: () => <Proof />,
  },
  {
    path: "/proof/deployment",
    title: "Deployment proof",
    description:
      "Every deployed address checked against chain state, the layer separation, the compiler pins, " +
      "and the static-analysis gap named explicitly.",
    render: () => <ProofDeployment />,
  },
  {
    path: "/proof/quote/:quoteId",
    title: "Quote proof",
    description:
      "One quote's terms, offer hash, exact fill and position, recomputed from chain state.",
    render: (params) => <ProofQuote quoteId={params["quoteId"] as `0x${string}`} />,
  },
  {
    path: "/proof/series/:seriesId",
    title: "Series proof",
    description:
      "One series' identity, published aggregate, coverage and market-layer bindings, recomputed " +
      "from chain state.",
    render: (params) => <ProofSeries seriesId={params["seriesId"] as `0x${string}`} />,
  },
  {
    path: "/proof/capsule/:capsuleId",
    title: "Capsule proof",
    description:
      "One capsule's origin, binding and scope, recomputed from chain state — the binding first, " +
      "because a decryption proof alone says nothing about which quote a value belongs to.",
    render: (params) => <ProofCapsule capsuleId={params["capsuleId"] as `0x${string}`} />,
  },
];

/**
 * The boot screen, and the refusal.
 *
 * Rendered outside the shell, because the shell reads the record to show the disclosure and the chain
 * id — and a header claiming an environment it could not load would be the first wrong statement on
 * the page.
 */
function Boot(boot: BootState): ReactElement {
  if (boot.error !== undefined) {
    return (
      <main className="page">
        <div className="wordmark">kyrve</div>
        <section className="band">
          <div className="card">
            <h1>The terminal cannot start</h1>
            <p className="lede" data-testid="boot-error">
              {boot.error}
            </p>
            <p className="lede">
              It refuses to start rather than pointing somewhere else. A confidential terminal
              showing a balance from a deployment that no longer exists is worse than one that does
              not open.
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="wordmark">kyrve</div>
      <section className="band">
        <div className="card" data-testid="booting">
          <h1>Reading the deployment record</h1>
          <p className="lede">
            The record names which contracts to ask about. Every number this terminal displays is
            then read from chain state or decrypted in this browser.
          </p>
        </div>
      </section>
    </main>
  );
}

export function App(): ReactElement {
  return (
    <KyrveProvider fallback={Boot}>
      <Router routes={ROUTES} notFound={(pathname) => <NotFound pathname={pathname} />}>
        {(match, page) => <Shell match={match}>{page}</Shell>}
      </Router>
    </KyrveProvider>
  );
}
