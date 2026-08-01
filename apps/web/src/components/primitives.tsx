/**
 * Design primitives.
 *
 * Small on purpose. Every one of these exists because the same shape appears in three or more places
 * and getting it wrong in one of them would break the visual system. Anything used once lives at its
 * call site.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE RULES ARE ENCODED, NOT REMEMBERED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `design.md` forbids several things outright: shadows, a second chromatic colour, a value rendered
 * without its confidentiality state, an exact provider count where the count is meant to be private.
 * A rule enforced by remembering it at each call site is a rule that survives until somebody is in a
 * hurry.
 *
 * So `Surface` has a `tone` and no `shadow`. `Figure` has a `state` and no way to render a number
 * without one. `Tone` is a closed union and adding a fifth member is a deliberate edit rather than a
 * plausible-looking string. The wrong thing is not available to type.
 */

import type { ReactElement, ReactNode } from "react";

/**
 * A surface.
 *
 * `design.md`: cards are Graphite at 12px radius with 32px padding and **no shadow**. Separation
 * comes from the one-step value lift off the Onyx canvas and nothing else, which is why this takes a
 * `tone` and offers no `shadow`, no `elevation` and no `border` prop.
 */
export function Surface({
  tone = "card",
  className = "",
  children,
  testId,
}: {
  tone?: "card" | "control" | "bare";
  className?: string;
  children: ReactNode;
  testId?: string;
}): ReactElement {
  const surface =
    tone === "control" ? "surface-control" : tone === "bare" ? "surface-bare" : "card";
  return (
    <div className={`${surface} ${className}`.trim()} data-testid={testId}>
      {children}
    </div>
  );
}

/**
 * The four confidentiality states, and nothing else.
 *
 * `design.md` fixes this vocabulary: encrypted and unavailable, available to decrypt, decrypted
 * locally, intentionally public. Each has one icon, one label and one explanation, and they are
 * never substituted or restyled per surface.
 */
export type Confidentiality = "encrypted" | "available" | "decrypted" | "public";

const STATE: Readonly<Record<Confidentiality, { glyph: string; label: string }>> = {
  encrypted: { glyph: "▨", label: "encrypted and unavailable" },
  available: { glyph: "◇", label: "available to decrypt" },
  decrypted: { glyph: "◈", label: "decrypted locally" },
  public: { glyph: "○", label: "intentionally public" },
};

/**
 * A labelled figure that cannot be rendered without its state.
 *
 * `state` is required. A number on this product with no confidentiality marker is a bug, because the
 * reader cannot tell whether they are looking at plaintext they decrypted, a published figure, or
 * something they are not authorised to read at all. Making the prop optional would make that bug
 * available.
 *
 * An `encrypted` figure renders deliberate structure rather than its `value`, so passing one by
 * mistake cannot leak it: the component simply does not use it in that state.
 */
export function Figure({
  label,
  value,
  state,
  hint,
  testId,
}: {
  label: string;
  value?: ReactNode;
  state: Confidentiality;
  hint?: string;
  testId?: string;
}): ReactElement {
  const { glyph, label: stateLabel } = STATE[state];
  return (
    <div className="figure" data-testid={testId} data-state={state}>
      <span className="figure-label">{label}</span>
      {state === "encrypted" ? (
        <span className="figure-value">
          {/*
            Redacted structure, never a zero and never sample data. A zero would be a claim about
            contents; these bars carry no information at all, which is the honest picture of a value
            this reader cannot read.
          */}
          <span className="redacted" role="img" aria-label={stateLabel}>
            <span />
            <span />
            <span />
          </span>
        </span>
      ) : (
        <span className="figure-value">{value}</span>
      )}
      <span className="figure-state">
        <span aria-hidden="true">{glyph}</span> {stateLabel}
      </span>
      {hint === undefined ? null : <span className="figure-hint">{hint}</span>}
    </div>
  );
}

/**
 * One public fact beside one private one.
 *
 * Kept adjacent deliberately. The distinction only means something when both halves are visible at
 * once, and splitting them into separate sections is how a product ends up claiming privacy in prose
 * while never showing the line.
 */
export function Boundary({
  publicSide,
  privateSide,
}: {
  publicSide: string;
  privateSide: string;
}): ReactElement {
  return (
    <div className="boundary-row">
      <span>
        <span className="boundary-dot" aria-hidden="true">
          ○
        </span>{" "}
        {publicSide}
      </span>
      <span className="boundary-private">
        <span className="boundary-dot" aria-hidden="true">
          ▨
        </span>{" "}
        {privateSide}
      </span>
    </div>
  );
}
