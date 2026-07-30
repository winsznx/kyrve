/**
 * `/` — the thesis, stated to someone who has connected nothing.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IS ON THIS PAGE AND WHAT IS DELIBERATELY NOT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * No metrics. Not total value locked, not a provider count, not a spread, not an uptime figure.
 * `.claude/rules/frontend.md` forbids a fabricated metric and this is where one would be tempting —
 * a landing page with no number on it looks unfinished until you remember that every number Kyrve
 * could show here is either private or would have to be read from a chain the reader has not chosen.
 *
 * No photography, no gradients, no network art, no token bubbles. The only image is the redacted
 * curve field, which carries no data, and the approved CTA raster, which is a light-surface asset
 * used unmodified as `design.md` specifies.
 *
 * ONE COBALT ELEMENT. The single primary action is "Open the terminal", and nothing else on the page
 * may be cobalt — including the navigation, which is why the landing header is monochrome text.
 */

import type { ReactElement } from "react";

import { RedactedCurve } from "../components/RedactedCurve.js";
import { useKyrve } from "../lib/context.js";
import { Link } from "../router/router.js";

export function Landing(): ReactElement {
  const { record } = useKyrve();

  return (
    <>
      <header className="landing-nav">
        {/*
          Text in Ivory, not the navy symbol. The approved master is authored for light surfaces and
          measures 1.30:1 against Onyx; `brand.json` forbids recolouring it or plating it, and the
          interim is the lowercase wordmark set as text until the reversed master is delivered.
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
            Open the terminal
          </Link>
        </div>
      </section>

      <section className="landing-section">
        <div className="split">
          <div>
            <span className="eyebrow">The problem</span>
            <h2>Price discovery leaks the book</h2>
          </div>
          <div className="stack">
            <p className="lede">
              A lender who quotes a curve has published their appetite: which markets they will
              touch, how much they hold, and the rate below which they stop. A borrower who shops a
              requirement has published their need. In fixed income, both of those are the position.
            </p>
            <p className="lede">
              The usual answer is a private venue with a trusted operator. Kyrve's answer is that
              the computation itself is confidential, and that the one thing which becomes public is
              the one thing that has to be: the offer that settles.
            </p>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="split">
          <div>
            <span className="eyebrow">The mechanism</span>
            <h2>Confidential in, one public offer out</h2>
          </div>
          <div className="stack">
            <div className="card">
              <h3>Encrypted mandates and one encrypted request</h3>
              <p className="lede">
                Every submission carries the same handle count whether one market is enabled or
                eight, so the shape of a mandate is not readable from the transaction.
              </p>
            </div>
            <div className="card">
              <h3>An epoch computes on ciphertext</h3>
              <p className="lede">
                Eligibility, capacity, the privacy floor and leaf selection, all on encrypted
                values. Every encrypted primitive is a separate transaction, so an epoch advances in
                visible steps rather than behind a spinner.
              </p>
            </div>
            <div className="card">
              <h3>Exactly one leaf is published</h3>
              <p className="lede">
                A market, a rate and an aggregate amount. Everything rejected stays encrypted, and a
                confidential rejection never produces a public reason — a private failure that
                explained itself would be a public oracle.
              </p>
            </div>
            <div className="card">
              <h3>Settlement is unmodified Morpho Midnight</h3>
              <p className="lede">
                The credit position is public. Who owns how much of it is a confidential ERC-7984
                balance, and is not derivable from anything on chain.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="split">
          <div>
            <span className="eyebrow">What you can check</span>
            <h2>Verification recomputes, it does not display</h2>
          </div>
          <div className="stack">
            <p className="lede">
              Every verification page states a fact, reads the chain for that fact, and compares
              against the deployment record. The record supplies addresses and is never the source
              of a verdict — where the two disagree, the check fails and shows both. That property
              is proven the only way it can be: by serving a record with a false series id and
              requiring the page to disagree with it.
            </p>
            <p className="lede">
              Values published through the Nox handle gateway carry{" "}
              <strong>decryption proofs</strong>— signatures over a released plaintext. They are not
              zero-knowledge proofs and Kyrve never calls them that.
            </p>
            <div>
              <Link to="/proof" className="ghost">
                Verify this deployment
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="card">
          <h2>What this is not</h2>
          <p className="lede">
            Not an offer of securities and not investment advice. The Midnight deployment behind
            this is an unmodified, source-available testnet replica used under its non-production
            licence, and is not an official Morpho deployment. There is no Nox mainnet.
          </p>
          <p className="lede">
            No gas indistinguishability is claimed, for any path. The confidential contract layer
            has no static-analysis coverage — crytic-compile cannot be made to drive its compiler —
            which is reported on every gate run rather than folded into a pass.
          </p>
          <p className="note">{record.disclosure}</p>
        </div>
      </section>
    </>
  );
}
