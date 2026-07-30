/**
 * The application shell: masthead, navigation, footer, disclosure.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE SHELL HOLDS NO COBALT, ANYWHERE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `design.md` reserves Cobalt for the single primary action per page. A cobalt button in a persistent
 * header would put a second one on every page that has its own primary action, and would put one on
 * pages that have no action at all. So the shell is entirely monochrome and each route declares its
 * own single primary action — which makes the rule checkable rather than aspirational, and
 * `pnpm verify:web` counts the cobalt elements per rendered route to prove it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE WORDMARK IS TEXT, AND THAT IS A BRAND DECISION WITH A DATE ON IT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The approved symbol master is authored for light surfaces: measured across all 45,374 opaque
 * pixels, 0.0% clear 4.5:1 against Onyx, at a median of 1.30:1. `brand.json` forbids recolouring it,
 * plating it, or rendering it on Onyx. So a dark header renders the lowercase `kyrve` wordmark set as
 * TEXT in Ivory, which is the interim recorded in `logo.backgrounds.interim` and ends when the
 * reversed master is delivered and passes acceptance. The positive master still ships — as the
 * favicon, the OG card and the CTA panel, all of which are light surfaces.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * NAVIGATION IS ANCHORS, AND THE SKIP LINK IS FIRST
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every nav item is a real `<a href>` inside a `<nav aria-label>`, the active one carries
 * `aria-current="page"`, and the first focusable element on every page is a skip link to `#main`.
 * A terminal whose ten sections can only be reached by mouse is a terminal a keyboard user cannot
 * operate, and `pnpm verify:web` walks the tab order of every route to check it.
 */

import type { ReactElement, ReactNode } from "react";
import { WalletBadge } from "../components/WalletBadge.js";
import { useKyrve } from "../lib/context.js";
import { Link, type Match, useLocation } from "../router/router.js";

interface NavItem {
  readonly to: string;
  readonly label: string;
}

/**
 * Every section, reachable by keyboard, in the order the work happens.
 *
 * `/app/cross/:seriesId` is deliberately absent: a Cross order is against ONE series and there is no
 * "cross" surface that exists without one, so it is reached from that series' own page. A nav item
 * pointing at a cross book with no series would be a control that cannot complete.
 */
const NAV: readonly NavItem[] = [
  { to: "/app", label: "Overview" },
  { to: "/app/fund", label: "Fund" },
  { to: "/app/mandates", label: "Mandates" },
  { to: "/app/request", label: "Request" },
  { to: "/app/curve", label: "Curve" },
  { to: "/app/quotes", label: "Quotes" },
  { to: "/app/series", label: "Series" },
  { to: "/app/capsules", label: "Capsules" },
  { to: "/app/roll", label: "Roll" },
  { to: "/proof", label: "Proof" },
];

/**
 * Whether a nav item owns the current path.
 *
 * `/app` only matches itself, or it would own every application route. `/app/cross/:seriesId` has no
 * nav item of its own — a Cross order is always against ONE series and is reached from that series'
 * page — so Series owns it. Leaving it unowned would put a whole route outside the navigation, with
 * nothing carrying `aria-current` and a screen-reader user unable to tell where they are.
 */
function isActive(pathname: string, to: string): boolean {
  if (to === "/app") return pathname === "/app";
  if (to === "/app/series" && pathname.startsWith("/app/cross/")) return true;
  return pathname === to || pathname.startsWith(`${to}/`);
}

export interface ShellProps {
  readonly match: Match | undefined;
  readonly children: ReactNode;
}

export function Shell({ match, children }: ShellProps): ReactElement {
  const { pathname } = useLocation();
  const { record } = useKyrve();

  /**
   * The landing page gets no application chrome.
   *
   * It is a statement of the thesis to someone who has not connected anything, and a ten-item
   * operations nav across the top of it would describe a product the reader has not been introduced
   * to yet. `/` carries its own header.
   */
  const chromeless = pathname === "/";

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to the main content
      </a>

      {chromeless ? null : (
        <header className="masthead" data-testid="masthead">
          <div className="masthead-inner">
            <Link to="/" className="wordmark-link">
              {/*
                Text, in Ivory, at the display weight. Not the navy symbol on Onyx (1.30:1), not a
                plate behind it, not a recolour of an approved master. `brand.json` interim.
              */}
              <span className="wordmark">kyrve</span>
              <span className="tagline">One quote. The curve stays private.</span>
            </Link>

            <nav className="nav" aria-label="Kyrve sections">
              <ul>
                {NAV.map((item) => {
                  const active = isActive(pathname, item.to);
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        className={active ? "nav-pill nav-pill-active" : "nav-pill"}
                        {...(active ? { "aria-current": "page" as const } : {})}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <WalletBadge />
          </div>
        </header>
      )}

      <main id="main" className={chromeless ? "page page-full" : "page"}>
        {children}
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <p className="disclaimer" data-testid="disclosure">
            {record.disclosure}
          </p>
          {/*
            Which chain, on every page.

            It used to live beside the connected account, which meant it disappeared for anyone who
            had not connected a wallet — including every reader of a proof page, who is exactly the
            person who needs to know which deployment they are looking at.
          */}
          <p className="disclaimer" data-testid="environment">
            Environment <span className="mono">{record.environment}</span> · chain{" "}
            <span className="mono">{record.chainId}</span>. Not an offer of securities and not
            investment advice. Values published through the Nox handle gateway carry decryption
            proofs — signatures over a released plaintext, not zero-knowledge proofs.
          </p>
          <p className="disclaimer">
            {match === undefined
              ? "This path does not exist."
              : `${match.route.title} · ${match.route.path}`}
          </p>
        </div>
      </footer>
    </>
  );
}
