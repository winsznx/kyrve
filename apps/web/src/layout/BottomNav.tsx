/**
 * The mobile shell's four destinations, at the thumb.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY NOT THE TOP BAR, SHRUNK
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The desktop navigation wraps into pills at 360px and remains reachable — that was already checked
 * and passing. Reachable is not the standard. On a handset the top of the screen is the furthest
 * point from the hand, and these four are destinations somebody switches between constantly rather
 * than settings they visit once.
 *
 * Same four destinations, same routes, same `aria-current`. Nothing new is reachable here and
 * nothing is hidden from the desktop bar — it is the same navigation, placed where the hand is.
 *
 * Rendered alongside the top bar rather than instead of it, with CSS deciding which is visible.
 * Swapping them in JavaScript at a breakpoint would mean the wrong one during hydration and a
 * navigation that flickers on every load.
 */

import type { ReactElement } from "react";

import { Link, useLocation } from "../router/router.js";

interface Item {
  readonly to: string;
  readonly label: string;
  /** A monospace glyph, from the same restrained set the confidentiality states use. */
  readonly mark: string;
  readonly owns: readonly string[];
}

const ITEMS: readonly Item[] = [
  {
    to: "/app",
    label: "Home",
    mark: "◆",
    owns: ["/app", "/app/fund", "/app/mandates", "/app/request"],
  },
  {
    to: "/app/activity",
    label: "Activity",
    mark: "≡",
    owns: ["/app/activity", "/app/curve", "/app/quotes"],
  },
  {
    to: "/app/series",
    label: "Positions",
    mark: "◇",
    owns: ["/app/series", "/app/cross", "/app/roll"],
  },
  { to: "/proof", label: "Verify", mark: "○", owns: ["/proof", "/app/capsules"] },
];

function isActive(pathname: string, item: Item): boolean {
  if (item.to === "/app" && pathname === "/app") return true;
  return item.owns.some((owned) => pathname === owned || pathname.startsWith(`${owned}/`));
}

export function BottomNav(): ReactElement {
  const { pathname } = useLocation();

  return (
    <nav className="bottom-nav" aria-label="Kyrve sections" data-testid="bottom-nav">
      {ITEMS.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link key={item.to} to={item.to} {...(active ? { "aria-current": "page" as const } : {})}>
            <span className="bottom-mark" aria-hidden="true">
              {item.mark}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
