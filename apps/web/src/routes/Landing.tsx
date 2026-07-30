/**
 * `/` — eleven sections that argue, in order, and stop when the argument is made.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE ORDER IS THE ARGUMENT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Hero, then the tagline moment, then the problem in the reader's own language, then the mechanism,
 * then the two systems, then the boundary, then the three outcomes, then the product itself, then
 * proof beside the claims, then the objections, then one action. A reader who stops at any point has
 * been told something complete.
 *
 * The previous version explained the mechanism competently and then ended. That is enough for
 * somebody already convinced and nothing for anybody else.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * NO EQUAL CARDS, ANYWHERE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Three equal cards read as a feature list. Kyrve's mechanism is a SEQUENCE whose entire point is
 * that density resolves into one point, so it is drawn as one — three Encrypted Fields at increasing
 * resolution, ending on the single Cobalt mark. The outcomes are asymmetric panels for the same
 * reason: they are three different people, not three features.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE PROOF LINE IS GENERATED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `PROOF_LINE` and `PROOF_STAGES` come from `src/generated/proof-summary.ts`, derived from the
 * evidence records those runs wrote. A stage with no record cannot appear as verified, so the only
 * way to add one to this page is to execute it — and a claim here cannot outlive what it describes.
 */

import type { ReactElement } from "react";

import { EncryptedField } from "../components/EncryptedField.js";
import { TaglineReveal } from "../components/TaglineReveal.js";
import { PROOF_LINE, PROOF_STAGES } from "../generated/proof-summary.js";
import { useKyrve } from "../lib/context.js";
import { Link } from "../router/router.js";

/** What stays private and what becomes public. Same length, deliberately. */
const PRIVATE = [
  "Lender pricing terms",
  "Borrower limits",
  "Rejected alternatives",
  "Provider allocations",
  "Exposure constraints",
  "Confidential ownership",
] as const;

const PUBLIC = [
  "Selected market",
  "Executable rate",
  "Exact amount",
  "Settlement receipt",
  "Aggregate credit position",
  "Proof record",
] as const;

/** Plain questions, in the order somebody sceptical would ask them. */
const FAQ = [
  {
    q: "What does Kyrve keep private?",
    a: "Your pricing terms, your limits, every alternative the market considered and rejected, how much each provider contributed, your exposure constraints, and who owns what after settlement.",
  },
  {
    q: "What becomes public?",
    a: "One quote: the selected market, the executable rate and the exact amount. Then its settlement receipt and the aggregate credit position it created. Nothing else.",
  },
  {
    q: "Does Kyrve custody my capital?",
    a: "Capital sits in a vault contract you can read, and a reservation moves it in one subtraction against your own balance. Kyrve holds no key that can move it elsewhere, and the settlement contracts have no upgrade path.",
  },
  {
    q: "Who can decrypt my balances?",
    a: "Your wallet, and anybody you have explicitly granted a frozen disclosure to — for that one frozen value only. Authorisation is checked on chain before any key material is released, so a refusal happens before anything is decrypted.",
  },
  {
    q: "What happens when no quote is available?",
    a: "You are told there is no fill, and nothing else. There is no public reason and none can be produced: a confidential rejection that explained itself would let anybody probe the book by asking.",
  },
  {
    q: "How does Nox fit into Kyrve?",
    a: "Nox is the confidential runtime. It evaluates the market on encrypted values and publishes exactly one result. Kyrve never sees the alternatives either.",
  },
  {
    q: "How does Morpho Midnight fit into Kyrve?",
    a: "Midnight is the settlement layer, unmodified. Kyrve builds the offer and binds it to an exact size; Midnight takes it and creates the credit position.",
  },
  {
    q: "Can a disclosure see my live balance?",
    a: "No. A disclosure freezes a copy at one block and grants access to that copy. Your live balance is a different value and was never granted. The grant is permanent, which is exactly why the frozen copy matters.",
  },
  {
    q: "Is this a production Morpho deployment?",
    a: "No. It is an unmodified, source-available Morpho Midnight testnet replica used under its non-production licence, on Ethereum Sepolia and locally.",
  },
  {
    q: "Where can I verify the contracts?",
    a: "The verification pages recompute every published claim from chain state and show both values wherever a record and the chain disagree. Nothing there is read from a cache.",
  },
] as const;

const VERDICT_WORD: Record<string, string> = {
  verified: "verified",
  unavailable: "not present here",
  "reported-not-verified": "reported, not verified here",
};

export function Landing(): ReactElement {
  const { record } = useKyrve();

  return (
    <>
      <header className="landing-nav">
        {/*
          Text in Ivory. The approved symbol master is authored for light surfaces and measures
          1.30:1 against Onyx; `brand.json` forbids recolouring it or plating it.
        */}
        <span className="wordmark">kyrve</span>
        <nav aria-label="Kyrve">
          <Link to="/proof" className="row-link">
            Verify the deployment
          </Link>
        </nav>
      </header>

      {/* ── 1. Hero. Approved concept and headline, refined spacing. ─────────────────────── */}
      <section className="hero">
        <EncryptedField name="hero" priority className="hero-field" testId="hero-field" />
        <div className="hero-inner">
          <h1>
            One quote.
            <br />
            The curve stays private.
          </h1>
          <p>
            Lenders set private terms. Borrowers ask the market privately. Kyrve reveals one
            executable quote and settles it exactly on Morpho Midnight.
          </p>
          {/*
            One filled action above the fold. The secondary is a text link, not a second button —
            two competing fills is the most common way a hero stops converting, and Cobalt is
            rationed to one element per page regardless.
          */}
          <div className="hero-actions">
            <Link to="/app" className="primary" data-testid="open-terminal">
              Enter the terminal
            </Link>
            <Link to="/proof/deployment" className="row-link">
              Verify the deployment
            </Link>
          </div>
          <p className="hero-proof" data-testid="proof-line">
            {PROOF_LINE}
          </p>
        </div>
      </section>

      {/* ── 2. Tagline reveal. ───────────────────────────────────────────────────────────── */}
      <section className="landing-section tagline-section" data-testid="tagline">
        <TaglineReveal testId="tagline-reveal">
          The market can settle your price without seeing the book that produced it.
        </TaglineReveal>
      </section>

      {/* ── 3. The problem, in the reader's language. Asymmetric, not a centred card. ────── */}
      <section className="landing-section problem" data-testid="problem">
        <div className="problem-head">
          <span className="eyebrow">The problem</span>
          <h2>Publishing a quote publishes your position.</h2>
        </div>
        <div className="problem-body">
          <p>
            A lender who posts a full curve reveals where they will lend, how much they can deploy
            and the rate where they stop. A borrower who shops publicly reveals what they need.
          </p>
          <p>
            Kyrve lets both sides ask the market without publishing the strategy behind the trade.
          </p>
        </div>
      </section>

      {/* ── 4. How one quote is formed. A sequence, resolving. ───────────────────────────── */}
      <section className="landing-section" data-testid="mechanism">
        <span className="eyebrow">How one quote is formed</span>
        <h2>Dense, then ordered, then one point.</h2>

        <ol className="sequence">
          <li>
            <EncryptedField name="mechanism-1" className="sequence-field" />
            <div className="sequence-copy">
              <span className="sequence-step">1 · Set terms privately</span>
              <p>Your terms are encrypted before they enter the market.</p>
            </div>
          </li>
          <li>
            <EncryptedField name="mechanism-2" className="sequence-field" />
            <div className="sequence-copy">
              <span className="sequence-step">2 · Compute the market</span>
              <p>
                Nox evaluates rate, maturity, collateral, capacity and exposure without publishing
                the alternatives.
              </p>
            </div>
          </li>
          <li>
            <EncryptedField name="mechanism-3" resolved at={0.7} className="sequence-field" />
            <div className="sequence-copy">
              <span className="sequence-step">3 · Settle one quote</span>
              <p>Kyrve releases one executable result. Midnight settles it exactly.</p>
            </div>
          </li>
        </ol>
      </section>

      {/* ── 5. Two systems, one market. ──────────────────────────────────────────────────── */}
      <section className="landing-section" data-testid="two-systems">
        <span className="eyebrow">Two systems, one market</span>
        <h2>Private computation. Public settlement.</h2>

        <div className="split-three">
          <div>
            <span className="split-name">Nox</span>
            <p>Computes the market in private.</p>
          </div>
          <div className="split-bind">
            <span className="split-name">Kyrve</span>
            <p>Turns the proven result into an exact executable offer.</p>
          </div>
          <div>
            <span className="split-name">Morpho Midnight</span>
            <p>Settles the public quote and creates the credit position.</p>
          </div>
        </div>

        <details className="advanced">
          <summary>View technical flow</summary>
          <p className="note">
            Encrypted mandates and one encrypted request are sealed into an epoch's operation graph.
            The curve engine computes eligibility, capacity, the privacy floor and leaf selection on
            ciphertext, then publishes one leaf through the handle gateway.{" "}
            <code>KyrveSettlementRatifier</code> authenticates the exact offer and the approved
            taker; because <code>isRatified</code> is a view and never receives <code>units</code>,
            exact fill is enforced separately in <code>KyrveSeriesVault.onBuy</code>, which is the
            only place actual fill size reaches maker code.
          </p>
        </details>
      </section>

      {/* ── 6. What stays private. ───────────────────────────────────────────────────────── */}
      <section className="landing-section" data-testid="boundary">
        <span className="eyebrow">The boundary</span>
        <h2>Every value is on exactly one side of this line.</h2>

        <div className="boundary-columns">
          <div>
            <h3>
              <span className="glyph" aria-hidden="true">
                ▨
              </span>{" "}
              Stays private
            </h3>
            <ul data-testid="boundary-private">
              {PRIVATE.map((item) => (
                <li key={item}>
                  {item}
                  {/*
                    Deliberate redacted structure, never a blur. A blur suggests the value is present
                    in the page and merely obscured; these bars carry no information at all, which is
                    the honest picture of something this reader cannot read.
                  */}
                  <span className="redacted" role="img" aria-label="encrypted and unavailable">
                    <span />
                    <span />
                    <span />
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>
              <span className="glyph" aria-hidden="true">
                ○
              </span>{" "}
              Becomes public
            </h3>
            <ul data-testid="boundary-public">
              {PUBLIC.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="note">
          Any screen that moves a value across this line says so at the point of action, before you
          sign, in a warning that cannot be collapsed.
        </p>
      </section>

      {/* ── 7. Three outcomes, as asymmetric panels. ─────────────────────────────────────── */}
      <section className="landing-section" data-testid="outcomes">
        <span className="eyebrow">Three outcomes</span>
        <h2>What you get, depending on why you came.</h2>

        <div className="outcomes">
          <Link to="/app/start" className="outcome outcome-wide">
            <span className="outcome-role">Provider</span>
            <strong>Put capital to work without publishing your rate floor.</strong>
            <span className="outcome-go">Start providing capital</span>
          </Link>
          <Link to="/app/start" className="outcome">
            <span className="outcome-role">Borrower</span>
            <strong>Ask the market without announcing your limit.</strong>
            <span className="outcome-go">Request a quote</span>
          </Link>
          <Link to="/app/start" className="outcome">
            <span className="outcome-role">Auditor</span>
            <strong>Verify the position without seeing the live book.</strong>
            <span className="outcome-go">Verify a position</span>
          </Link>
        </div>
      </section>

      {/* ── 8. The product in use. Real screens, one large, then supporting. ─────────────── */}
      <section className="landing-section" data-testid="product">
        <span className="eyebrow">The product</span>
        <h2>Every state names itself.</h2>
        <p className="lede">
          These are the real interface, captured from a running deployment. Nothing here is a
          mockup.
        </p>

        <figure className="product-frame">
          <picture>
            <source type="image/avif" srcSet="/brand/screens/quote.avif" />
            <source type="image/webp" srcSet="/brand/screens/quote.webp" />
            <img
              src="/brand/screens/quote.png"
              alt="The selected quote, showing the market, rate and exact amount that become public"
              width={1600}
              height={1000}
              loading="lazy"
              decoding="async"
            />
          </picture>
          <figcaption>
            The one public result. Everything the market considered and rejected stays encrypted.
          </figcaption>
        </figure>

        <div className="product-details">
          <figure>
            <picture>
              <source type="image/avif" srcSet="/brand/screens/terms.avif" />
              <source type="image/webp" srcSet="/brand/screens/terms.webp" />
              <img
                src="/brand/screens/terms.png"
                alt="Setting private lending terms, with public and private fields listed before signing"
                width={1600}
                height={1000}
                loading="lazy"
                decoding="async"
              />
            </picture>
            <figcaption>Private terms, with the boundary named before you sign.</figcaption>
          </figure>
          <figure>
            <picture>
              <source type="image/avif" srcSet="/brand/screens/position.avif" />
              <source type="image/webp" srcSet="/brand/screens/position.webp" />
              <img
                src="/brand/screens/position.png"
                alt="A confidential position, showing ownership readable only by its holder"
                width={1600}
                height={1000}
                loading="lazy"
                decoding="async"
              />
            </picture>
            <figcaption>Confidential ownership of a public credit position.</figcaption>
          </figure>
          <figure>
            <picture>
              <source type="image/avif" srcSet="/brand/screens/verify.avif" />
              <source type="image/webp" srcSet="/brand/screens/verify.webp" />
              <img
                src="/brand/screens/verify.png"
                alt="The verification page, recomputing published claims from chain state"
                width={1600}
                height={1000}
                loading="lazy"
                decoding="async"
              />
            </picture>
            <figcaption>Verification that recomputes rather than displays.</figcaption>
          </figure>
        </div>
      </section>

      {/* ── 9. Proof beside the claim. ───────────────────────────────────────────────────── */}
      <section className="landing-section" data-testid="evidence">
        <span className="eyebrow">Proof</span>
        <h2>Each stage has run, and says how it is known.</h2>

        <ul className="evidence">
          {PROOF_STAGES.map((stage) => (
            <li key={stage.id} data-verdict={stage.verdict}>
              <strong>{stage.label}</strong>
              <span className="evidence-verdict">{VERDICT_WORD[stage.verdict]}</span>
              <span className="evidence-detail">{stage.detail}</span>
            </li>
          ))}
        </ul>
        <p className="note">
          Four verdicts, and two are neither pass nor fail. <em>Not present here</em> means this
          checkout has no record of it. <em>Reported, not verified here</em> means a record asserts
          it and this page did not check — listed rather than dropped, so it cannot be mistaken for
          a recomputation.{" "}
          <Link to="/proof" className="row-link">
            Recompute all of it from chain state
          </Link>
          .
        </p>
      </section>

      {/* ── 10. FAQ, editorial rather than an accordion stack. ───────────────────────────── */}
      <section className="landing-section" data-testid="faq">
        <span className="eyebrow">Questions</span>
        <h2>The things people ask first.</h2>
        <dl className="faq">
          {FAQ.map((entry) => (
            <div key={entry.q}>
              <dt>{entry.q}</dt>
              <dd>{entry.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── 11. Final CTA. The field resolves to one point. ──────────────────────────────── */}
      <section className="landing-close" data-testid="close">
        <EncryptedField name="close" resolved at={0.72} className="close-field" />
        <div className="close-inner">
          <h2>Bring your terms. Publish only the trade.</h2>
          <div className="close-actions">
            <Link to="/app/start" className="ghost ghost-strong" data-testid="enter-terminal">
              Enter the terminal
            </Link>
            <Link to="/proof" className="row-link">
              Inspect the proof
            </Link>
          </div>
        </div>
      </section>

      <section className="landing-section landing-legal">
        <p className="disclaimer">{record.disclosure}</p>
        <p className="disclaimer">
          Not an offer of securities and not investment advice. This is an unmodified,
          source-available Morpho Midnight testnet replica under its non-production licence, and is
          not an official Morpho deployment. Values published through the Nox handle gateway carry
          decryption proofs — signatures over a released plaintext, not zero-knowledge proofs. No
          gas indistinguishability is claimed. The confidential contract layer has no
          static-analysis coverage.
        </p>
      </section>
    </>
  );
}
