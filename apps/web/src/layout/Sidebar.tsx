/**
 * The operations rail: identity at the top, the whole product in the middle, the session at the foot.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE SESSION MOVED OUT OF THE HEADER
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The session block is six lines of text and five controls: role, connection state, address, the
 * count of decrypted values held, the sentence explaining that locking is not revocation, then lock,
 * account, network and end-session. All of it is load-bearing and none of it is a heading.
 *
 * In a masthead it was the single largest element on every page, sitting above the page's own title
 * and pushing the actual work below the fold. It read as the most important thing on screen, which it
 * is not: it is the thing you check occasionally and act on rarely.
 *
 * A rail puts it where that weight is correct — persistent, glanceable, out of the reading column.
 * The page's own `h1` is then the first thing in the content area, which is what a reader arriving at
 * `/app/fund` came for.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE ROUTES ARE GROUPED, AND THE GROUPS ARE THE PRODUCT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Four flat destinations across a header hid the shape of the thing. Kyrve has fourteen operational
 * surfaces and a reader could not tell, because Home, Activity, Positions and Verify say nothing
 * about what is underneath them and a first-time reader has no reason to go looking.
 *
 * Grouping them under Capital, Market and Holdings does two things at once. It says what the product
 * does without a paragraph, and it puts the destination a reader wants one click away instead of two.
 * Nothing was added: every route below already existed and every one is still addressable directly.
 *
 * The four-destination model survives on the handset, where a rail does not fit and `BottomNav` owns
 * navigation. That is the same trade the bottom bar was introduced to make.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * NO COBALT LIVES HERE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `design.md` reserves Cobalt for one primary action per page. Persistent chrome cannot hold it
 * without spending the page's only allowance before the page renders, so the active route is marked
 * by a value lift and a rule, and `pnpm verify:web` counts cobalt elements per route to keep that
 * checkable rather than remembered.
 */

import type { ReactElement } from "react";

import { RoleBadge } from "../components/RoleBadge.js";
import { Link, useLocation } from "../router/router.js";

interface RailItem {
  readonly to: string;
  readonly label: string;
  /**
   * Every path this entry stands for, so a detail page keeps its parent highlighted.
   *
   * A reader on `/app/series/0x…` is still in Positions. Navigation that loses its mark on every
   * detail page leaves a screen-reader user with nothing that says where they are.
   */
  readonly owns?: readonly string[];
}

interface RailGroup {
  /** Absent on the first group: "Overview" over a single Home link is a label explaining a label. */
  readonly heading?: string;
  readonly items: readonly RailItem[];
}

const RAIL: readonly RailGroup[] = [
  {
    items: [{ to: "/app", label: "Overview" }],
  },
  {
    heading: "Capital",
    items: [
      { to: "/app/fund", label: "Add capital" },
      { to: "/app/mandates", label: "Lending terms" },
      { to: "/app/request", label: "Request a quote" },
    ],
  },
  {
    heading: "Market",
    items: [
      { to: "/app/activity", label: "Activity" },
      { to: "/app/curve", label: "Private matching" },
      { to: "/app/quotes", label: "Quotes", owns: ["/app/quotes"] },
    ],
  },
  {
    heading: "Holdings",
    items: [
      { to: "/app/series", label: "Positions", owns: ["/app/series"] },
      { to: "/app/roll", label: "Move maturity" },
      { to: "/app/capsules", label: "Disclosures", owns: ["/app/capsules", "/app/cross"] },
    ],
  },
  {
    heading: "Evidence",
    items: [{ to: "/proof", label: "Verify the deployment", owns: ["/proof"] }],
  },
];

function isActive(pathname: string, item: RailItem): boolean {
  if (pathname === item.to) return true;
  // `/app` owns only itself. Without this every entry would light up on every page.
  if (item.to === "/app") return false;
  const owned = item.owns ?? [item.to];
  return owned.some((base) => pathname.startsWith(`${base}/`));
}

export function Sidebar(): ReactElement {
  const { pathname } = useLocation();

  return (
    <aside className="rail" data-testid="rail">
      <div className="rail-top">
        <Link to="/" className="wordmark-link">
          {/*
            Text, in Ivory. The approved symbol master is a light-surface asset measuring 1.30:1 on
            Onyx, and `brand.json` forbids recolouring or plating it.
          */}
          <span className="wordmark">kyrve</span>
        </Link>
      </div>

      <nav className="rail-nav" aria-label="Kyrve">
        {RAIL.map((group, index) => (
          <div className="rail-group" key={group.heading ?? `group-${String(index)}`}>
            {group.heading === undefined ? null : (
              <p className="rail-heading">{group.heading}</p>
            )}
            <ul>
              {group.items.map((item) => {
                const active = isActive(pathname, item);
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      className={active ? "rail-link rail-link-active" : "rail-link"}
                      {...(active ? { "aria-current": "page" as const } : {})}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="rail-foot">
        <RoleBadge />
      </div>
    </aside>
  );
}
