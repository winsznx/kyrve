/**
 * The application shell: masthead, four destinations, role menu, footer.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * FOUR DESTINATIONS, NOT NINE CONTRACT SURFACES
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The first version put nine protocol nouns across the top — Fund, Mandates, Request, Curve, Quotes,
 * Series, Capsules, Roll, Proof. Every one is a real surface and not one of them is a task, so a
 * first-time reader had to model the architecture before they could do anything.
 *
 * Navigation is now Home, Activity, Positions and Verify. Which ACTIONS live under them is a
 * function of the role, and every one of those actions still resolves to the same routes as before:
 * nothing was removed, and a technical reader can still address `/app/mandates` directly.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE SHELL HOLDS NO COBALT, ANYWHERE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `design.md` reserves Cobalt for the single primary action per page. A cobalt button in a persistent
 * header would put a second one on every page that has its own, and one on pages that have none. So
 * the shell is monochrome and each route declares its own — which makes the rule checkable rather
 * than aspirational, and `pnpm verify:web` counts the cobalt elements per rendered route.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE WORDMARK IS TEXT, AND THAT IS A BRAND DECISION WITH A DATE ON IT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The approved symbol master is authored for light surfaces: measured across all 45,374 opaque
 * pixels, 0.0% clear 4.5:1 against Onyx, at a median of 1.30:1. `brand.json` forbids recolouring it,
 * plating it, or rendering it on Onyx. The dark header renders the lowercase `kyrve` wordmark set as
 * TEXT in Ivory until the reversed master is delivered.
 */

import type { ReactElement, ReactNode } from "react";

import { RoleBadge } from "../components/RoleBadge.js";
import { useKyrve } from "../lib/context.js";
import { Link, type Match, useLocation } from "../router/router.js";

interface NavItem {
  readonly to: string;
  readonly label: string;
  /** Every route this destination owns, so `aria-current` is right on a detail page too. */
  readonly owns: readonly string[];
}

/**
 * Four destinations, and what each one covers.
 *
 * `owns` exists because a reader on `/app/cross/0x…` is still in Positions, and a navigation that
 * loses its highlight on every detail page leaves a screen-reader user with nothing saying where
 * they are.
 */
const NAV: readonly NavItem[] = [
  {
    to: "/app",
    label: "Home",
    owns: ["/app", "/app/start", "/app/fund", "/app/mandates", "/app/request"],
  },
  { to: "/app/activity", label: "Activity", owns: ["/app/activity", "/app/curve", "/app/quotes"] },
  {
    to: "/app/series",
    label: "Positions",
    owns: ["/app/series", "/app/cross", "/app/roll", "/app/capsules"],
  },
  { to: "/proof", label: "Verify", owns: ["/proof"] },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.to === "/app" && pathname === "/app") return true;
  return item.owns.some((owned) => pathname === owned || pathname.startsWith(`${owned}/`));
}

export interface ShellProps {
  readonly match: Match | undefined;
  readonly children: ReactNode;
}

export function Shell({ match, children }: ShellProps): ReactElement {
  const { pathname } = useLocation();
  const { record } = useKyrve();

  /**
   * The landing page and the onboarding flow get no application chrome.
   *
   * `/` is a statement of the thesis to somebody who has connected nothing, and `/app/start` is the
   * moment they are being asked who they are — a four-item operations nav across the top of either
   * describes a product they have not been introduced to yet.
   */
  const chromeless = pathname === "/" || pathname === "/app/start";

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
                Text, in Ivory. Not the navy symbol on Onyx (1.30:1), not a plate behind it, not a
                recolour of an approved master. `brand.json` interim.
              */}
              <span className="wordmark">kyrve</span>
            </Link>

            <nav className="nav" aria-label="Kyrve">
              <ul>
                {NAV.map((item) => {
                  const active = isActive(pathname, item);
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

            <RoleBadge />
          </div>
        </header>
      )}

      <main id="main" className={chromeless ? "page page-full" : "page"}>
        {children}
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          {/*
            The qualifications live here, not in the narrative.

            A product that disclaims itself before it has explained itself reads as unfinished. Every
            statement below is unchanged and none is softened — what changed is that they no longer
            occupy the position on the page where a reader is deciding whether to care.
          */}
          <p className="disclaimer" data-testid="disclosure">
            {record.disclosure}
          </p>
          <p className="disclaimer" data-testid="environment">
            Environment <span className="mono">{record.environment}</span> · chain{" "}
            <span className="mono">{record.chainId}</span>. Not an offer of securities and not
            investment advice. Values published through the Nox handle gateway carry decryption
            proofs — signatures over a released plaintext, not zero-knowledge proofs. No gas
            indistinguishability is claimed. The confidential contract layer has no static-analysis
            coverage.
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
