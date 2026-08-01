/**
 * One mechanism per page, explained before somebody misreads it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY EVERY ROUTE CARRIES ONE OF THESE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Kyrve has a dozen behaviours that look like defects until they are explained. An open order that
 * says nothing about its remaining escrow. A disclosure whose expiry does not stop the recipient
 * reading it. A refusal with no reason attached. A retire button with no undo.
 *
 * Every one of those is deliberate, every one is load-bearing, and every one reads as broken to
 * somebody encountering it for the first time. Documentation does not help, because the person who
 * needs it is looking at the screen rather than at a file.
 *
 * So each route states the one thing about itself that is most likely to be misread, at the place
 * where it would be misread. `.claude/rules/frontend.md` requires a page to name what is private and
 * what becomes public; this is the same obligation applied to mechanism rather than to data.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * IT IS NOT A TOOLTIP AND IT DOES NOT COLLAPSE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A disclosure widget hides the explanation behind a click that most readers never make, which
 * leaves the misreading in place for everyone who needed it. This renders open, in the flow, below
 * the work rather than above it, so it teaches without interrupting.
 */

import type { ReactElement, ReactNode } from "react";

export interface WhyProps {
  /**
   * The heading, written as the CLAIM rather than as a topic.
   *
   * "Unwrapping is the same crossing in reverse" teaches on its own; "About unwrapping" makes the
   * reader work for it. A heading a reader can skim and still learn from is the whole point.
   */
  readonly title: string;
  readonly children: ReactNode;
  readonly testId?: string;
}

export function Why({ title, children, testId }: WhyProps): ReactElement {
  return (
    <aside className="why" data-testid={testId ?? "why"}>
      <h3>{title}</h3>
      <div>{children}</div>
    </aside>
  );
}
