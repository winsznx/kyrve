/**
 * One header per route, so a title and the sentence explaining it can never drift apart.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE DESCRIPTION IS PART OF THE HEADER, NOT AN OPTIONAL EXTRA
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `description` is required. A screen in this product named only by a noun — Quotes, Mandates, Cross
 * — tells a reader what it is filed under and nothing about what they are looking at or where the
 * numbers came from. Every route here reads live chain state, and the difference between a figure
 * this page recomputed and a figure it was handed is the difference the whole product argues about.
 *
 * Making it optional would make it skippable, and the routes that skipped it would be the technical
 * ones that needed it most.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE ACTION SLOT HOLDS AT MOST ONE THING
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `design.md` allows one cobalt action per page. A header that accepted an array would let a route
 * put two of them side by side, so it accepts a single node and the type says so.
 */

import type { ReactElement, ReactNode } from "react";

export interface PageHeaderProps {
  /** A short category word above the title. Optional: not every screen belongs to a journey. */
  readonly eyebrow?: string;
  readonly title: string;
  /**
   * What this screen is, and where its numbers come from.
   *
   * Written as a complete sentence rather than a fragment, because it is read once and then skipped
   * forever, and a fragment wastes the one time it gets read.
   */
  readonly description: string;
  /** A status marker — the network, the layer, the lifecycle state. Never an action. */
  readonly badge?: ReactNode;
  /** At most one. See above. */
  readonly action?: ReactNode;
  readonly testId?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  badge,
  action,
  testId,
}: PageHeaderProps): ReactElement {
  return (
    <header className="page-header" data-testid={testId ?? "page-header"}>
      <div className="page-header-text">
        {eyebrow === undefined ? null : <span className="eyebrow">{eyebrow}</span>}
        <div className="page-header-title">
          <h1>{title}</h1>
          {badge}
        </div>
        <p className="lede">{description}</p>
      </div>
      {action === undefined ? null : <div className="page-header-action">{action}</div>}
    </header>
  );
}

/**
 * A small status marker.
 *
 * Not a button and never inside one. `tone` is a closed union because a free-form colour prop is how
 * a second chromatic note gets into a design system that permits exactly one.
 */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "live" | "private";
  children: ReactNode;
}): ReactElement {
  return (
    <span className="badge" data-tone={tone}>
      {children}
    </span>
  );
}

/**
 * A scannable public figure, four across at the top of a screen.
 *
 * Distinct from `Figure` in `primitives.tsx`, which carries a confidentiality state and can render a
 * redaction. Everything shown through this component is public deployment fact — how many series
 * exist, which network, how many contracts — so there is no state to carry and no value to protect.
 * Keeping them as separate components means a confidential amount cannot be rendered here by
 * accident: this one has nowhere to put the marker that would be required.
 */
export function Stat({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: string;
  hint: string;
  testId?: string;
}): ReactElement {
  return (
    <div className="stat" data-testid={testId}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-hint">{hint}</span>
    </div>
  );
}
