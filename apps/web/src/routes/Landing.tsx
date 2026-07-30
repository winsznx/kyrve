/**
 * `/` — the thesis, then the mechanism, then the proof, then the way in.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE PAGE SELLS BEFORE IT DISCLAIMS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The previous version put a "What this is not" card in the narrative, between the mechanism and the
 * call to action. Every sentence in it was true and every one of them is still on this page — in the
 * footer, where legal and technical qualification belongs. A product that qualifies itself before it
 * has explained itself reads as unfinished, and a reader who has not yet been told what the thing
 * does cannot evaluate a caveat about it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE CURVE MOTIF IS RATIONED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * It appears in the hero and once more, in the mechanism, where it carries meaning: three states of
 * the same field — many curves, one resolving, one resolved. Using it as a background everywhere
 * would make it wallpaper, and the one thing it has to communicate is that exactly one point becomes
 * public.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE EVIDENCE SECTION IS NOT A METRICS ROW
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * No counters, no "total value", no uptime. Each line names a stage of the lifecycle and says that it
 * has been executed on a public network — which is a claim a reader can go and check, and is the only
 * kind of number worth putting on a landing page for a product like this.
 */

import type { ReactElement } from "react";

import { RedactedCurve } from "../components/RedactedCurve.js";
import { useKyrve } from "../lib/context.js";
import { layersOf } from "../lib/records.js";
import { Link } from "../router/router.js";

/** What stays private and what becomes public. Two columns, deliberately the same length. */
const PRIVATE = [
  "Lender rate curves",
  "Provider allocations",
  "Borrower limits",
  "Exposure constraints",
  "Rejected alternatives",
  "Beneficial ownership",
] as const;

const PUBLIC = [
  "Selected market",
  "Executable rate",
  "Exact amount",
  "Settlement",
  "Public credit position",
  "Proof record",
] as const;

/**
 * What has actually been executed on a public network.
 *
 * Each line is a stage, not a count. "43 contracts verified" as a number is a vanity metric; "the
 * contracts behind this are source-verified" is a claim with a link behind it.
 */
const EVIDENCE = [
  {
    stage: "Confidential curve epoch",
    what: "A full epoch computed on ciphertext, stage by stage, against a real confidential runtime.",
  },
  {
    stage: "Exact-fill settlement",
    what: "One quote taken through unmodified Morpho Midnight at exactly its size, with a partial fill refused.",
  },
  {
    stage: "Confidential series ownership",
    what: "Providers hold encrypted claims on a public credit position. One provider cannot read another's.",
  },
  {
    stage: "Capsule",
    what: "A frozen snapshot granted to one reviewer, who can read that value and nothing else.",
  },
  {
    stage: "Cross",
    what: "A confidential claim moved between two parties without either balance becoming public.",
  },
  {
    stage: "Roll",
    what: "A position migrated between two maturities, across two complete issuance stacks.",
  },
  {
    stage: "Source-verified contracts",
    what: "Every deployed contract published and verified on Etherscan, across two compiler pins.",
  },
] as const;

export function Landing(): ReactElement {
  const { record } = useKyrve();
  const layers = layersOf(record);

  return (
    <>
      <header className="landing-nav">
        {/*
          Text in Ivory, not the navy symbol. The approved master is authored for light surfaces and
          measures 1.30:1 against Onyx; `brand.json` forbids recolouring it or plating it.
        */}
        <span className="wordmark">kyrve</span>
        <nav aria-label="Kyrve">
          <Link to="/app" className="ghost">
            Terminal
          </Link>{" "}
          <Link to="/proof" className="ghost">
            Verify
          </Link>
        </nav>
      </header>

      {/* ── The hero, unchanged. ─────────────────────────────────────────────────────────── */}
      <section className="hero">
        <RedactedCurve className="hero-field" resolved at={0.68} testId="hero-field" />
        <div className="hero-inner">
          <h1>One quote. The curve stays private.</h1>
          <p>
            Encrypted lender mandates and one encrypted borrower requirement become a single
            executable Morpho Midnight offer. The full yield curve, provider allocations, exposure
            limits, rejected alternatives and beneficial ownership never become public.
          </p>
          <Link to="/app" className="primary" data-testid="open-terminal">
            Enter the terminal
          </Link>
        </div>
      </section>

      {/* ── A. Three-step mechanism, as one progression. ─────────────────────────────────── */}
      <section className="landing-section" data-testid="mechanism">
        <span className="eyebrow">How it works</span>
        <h2>Three steps, and only the last one is public</h2>

        <ol className="mechanism">
          <li>
            <div className="mechanism-figure" aria-hidden="true">
              <RedactedCurve resolved={false} />
            </div>
            <span className="mechanism-number">1</span>
            <h3>Submit privately</h3>
            <p>
              Lenders define encrypted mandates and borrowers define encrypted requirements. Nothing
              about either is readable — not the size, not the limits, not the shape.
            </p>
          </li>
          <li>
            <div className="mechanism-figure" aria-hidden="true">
              <RedactedCurve resolved={false} at={0.5} />
            </div>
            <span className="mechanism-number">2</span>
            <h3>Compute the curve</h3>
            <p>
              Nox evaluates rate, maturity, collateral, capacity and exposure without publishing the
              alternatives. A rejection produces no public reason, because a reason would be an
              oracle.
            </p>
          </li>
          <li>
            <div className="mechanism-figure" aria-hidden="true">
              <RedactedCurve resolved at={0.68} />
            </div>
            <span className="mechanism-number">3</span>
            <h3>Settle one quote</h3>
            <p>
              Kyrve reveals one executable result and Morpho Midnight settles it exactly. That
              single cobalt point is everything that becomes public.
            </p>
          </li>
        </ol>
      </section>

      {/* ── B. Two systems, one market. ──────────────────────────────────────────────────── */}
      <section className="landing-section" data-testid="two-systems">
        <span className="eyebrow">The architecture, in five seconds</span>
        <h2>Two systems, one market</h2>
        <div className="systems">
          <div className="system">
            <span className="system-name">Nox</span>
            <p>computes privately</p>
          </div>
          <div className="system-join" aria-hidden="true">
            →
          </div>
          <div className="system system-bind">
            <span className="system-name">Kyrve</span>
            <p>binds the result to exact execution</p>
          </div>
          <div className="system-join" aria-hidden="true">
            →
          </div>
          <div className="system">
            <span className="system-name">Midnight</span>
            <p>settles publicly</p>
          </div>
        </div>
        <p className="note">
          Neither half is modified. The confidential runtime never learns who settles, and the
          settlement layer never learns what was rejected.
        </p>
      </section>

      {/* ── C. What remains private, what becomes public. ────────────────────────────────── */}
      <section className="landing-section" data-testid="boundary">
        <span className="eyebrow">The boundary</span>
        <h2>What stays private, and what does not</h2>
        <div className="boundary-columns">
          <div>
            <h3>Stays private</h3>
            <ul data-testid="boundary-private">
              {PRIVATE.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Becomes public</h3>
            <ul data-testid="boundary-public">
              {PUBLIC.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="note">
          Every value in Kyrve is in exactly one of these columns, and any screen that moves one
          across says so before you sign.
        </p>
      </section>

      {/* ── D. Product journeys. ─────────────────────────────────────────────────────────── */}
      <section className="landing-section" data-testid="journeys">
        <span className="eyebrow">Where you fit</span>
        <h2>Three ways in</h2>
        <div className="journey-cards">
          <Link to="/app/start" className="journey-card">
            <strong>Provide capital</strong>
            <span>
              Set lending terms nobody can read and receive confidential ownership of the credit
              that settles against them.
            </span>
          </Link>
          <Link to="/app/start" className="journey-card">
            <strong>Request a quote</strong>
            <span>
              State what you need privately and receive one executable price. Nothing about your
              limits is published, whether or not you settle.
            </span>
          </Link>
          <Link to="/app/start" className="journey-card">
            <strong>Verify a position</strong>
            <span>
              Recompute every public claim from chain state, or decrypt one frozen disclosure
              granted to you — and nothing beyond it.
            </span>
          </Link>
        </div>
      </section>

      {/* ── E. Real proof. ───────────────────────────────────────────────────────────────── */}
      <section className="landing-section" data-testid="evidence">
        <span className="eyebrow">Executed, not described</span>
        <h2>Every stage has run on a public network</h2>
        <ul className="evidence">
          {EVIDENCE.map((item) => (
            <li key={item.stage}>
              <strong>{item.stage}</strong>
              <span>{item.what}</span>
            </li>
          ))}
        </ul>
        <p className="note">
          {layers.length === 0
            ? "This deployment is serving no settled series yet — every claim above is still checkable against the chain it points at."
            : `This deployment is serving ${layers.length} settled series, and every claim above is checkable against it.`}
        </p>
      </section>

      {/*
        F. One action.

        The closing call is a large GHOST rather than a second cobalt fill, because the hero already
        holds this page's one cobalt element and `design.md` rations it to a single primary action per
        page. `pnpm verify:web` counts them, so a second fill here would fail the build rather than
        quietly breaking the rule — and the constraint is a good one: the eye should land on the hero's
        point, which is the whole visual argument of the mark.
      */}
      <section className="landing-section landing-close" data-testid="close">
        <h2>One quote. The curve stays private.</h2>
        <div className="actions actions-close">
          <Link to="/app/start" className="ghost ghost-strong" data-testid="enter-terminal">
            Enter the terminal
          </Link>
          <Link to="/proof/deployment" className="row-link">
            Verify the deployment
          </Link>
        </div>
      </section>
    </>
  );
}
