/**
 * The application shell: rail, content column, footer.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE OWNS, AND WHAT IT DOES NOT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Identity, navigation and the session live in `Sidebar`, which explains its own arrangement. This
 * file owns the three-part frame around them and one decision: which pages get no chrome at all.
 *
 * The route table used to live here as well, in two copies — one for the header and one for
 * `BottomNav` — which meant a route could be added to the product and appear in exactly one of them.
 * There is now one table per surface and each states which paths it stands for.
 */

import type { ReactElement, ReactNode } from "react";

import { useKyrve } from "../lib/context.js";
import { type Match, useLocation } from "../router/router.js";
import { BottomNav } from "./BottomNav.js";
import { Sidebar } from "./Sidebar.js";

interface ShellProps {
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

      {chromeless ? null : <Sidebar />}

      <main id="main" className={chromeless ? "page page-full" : "page workspace-page"}>
        {children}
      </main>

      {/*
        Rendered always, shown by CSS below 720px.

        Swapping navigations in JavaScript at a breakpoint means rendering the wrong one first and a
        bar that flickers on every load. The media query decides, and both are in the DOM — which is
        also why the desktop bar carries `aria-label="Kyrve"` and this one carries
        `aria-label="Kyrve sections"`: two navigations need two names.
      */}
      {chromeless ? null : <BottomNav />}

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
            proofs. They are signatures over a released plaintext, not zero-knowledge proofs. No gas
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
