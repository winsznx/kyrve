/**
 * A list of public facts, and the honest absence of one.
 *
 * Every entry is a value that is public the moment it exists: an address, an identifier, a
 * transaction hash, a public amount, a verdict bit. **No private value may be passed to this
 * component** — the fact list is the shape that gets copied into a downloadable artefact and pasted
 * into a message, and a fact list carrying a decrypted balance would be a leak with a label on it.
 * Confidential values render through `ConfidentialValue`, which knows their state.
 *
 * A missing value renders as an em dash with the reason, never as a zero and never as an empty cell.
 * "0" and "not recorded" are different statements and the first one is a claim.
 */

import type { ReactElement, ReactNode } from "react";

export interface Fact {
  readonly label: string;
  /** Public values only. `undefined` renders as an explained absence. */
  readonly value: ReactNode | undefined;
  /** Why the value is absent. Required when `value` is undefined, so no cell is silently empty. */
  readonly absent?: string;
  readonly testId?: string;
}

export interface FactsProps {
  readonly facts: readonly Fact[];
  readonly testId?: string;
}

export function Facts({ facts, testId }: FactsProps): ReactElement {
  return (
    <dl className="facts" data-testid={testId}>
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd data-testid={fact.testId}>
            {fact.value ?? <span className="tagline">— {fact.absent ?? "not recorded"}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface EmptyProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly testId?: string;
}

/**
 * Nothing here yet, and what would put something here.
 *
 * An empty collection is a real and common state in Kyrve — a deployment with no settled series, a
 * wallet with no capsule, a layer with no Cross book. Rendering it as a placeholder row or as a zero
 * would be the fake metric `.claude/rules/frontend.md` forbids. Naming the command or the action that
 * produces the missing thing is the difference between an empty state and a dead end.
 */
export function Empty({ title, children, testId }: EmptyProps): ReactElement {
  return (
    <div className="empty" data-testid={testId}>
      <strong>{title}</strong>
      {children}
    </div>
  );
}
