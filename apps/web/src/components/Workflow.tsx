/**
 * The guided flow: a stepper whose position is read from chain state, and the one action that follows.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * NO STORED STEP NUMBER, ANYWHERE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A wizard that remembers where you were is wrong the moment anything happens outside the tab — a
 * keeper transaction, another device, a page left open since yesterday. Every step here corresponds
 * to a fact on chain, so the position is derived (`lib/journey.ts`) rather than remembered.
 *
 * Refresh is therefore correct by construction rather than by a restore path: reloading runs exactly
 * the same reads as arriving for the first time. That is also why the required "refreshing restores
 * public workflow state" check has nothing to restore.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ONE ACTION, AND IT IS THE PAGE'S ONLY COBALT ELEMENT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The stepper shows where the reader is; the panel below it shows the single next thing. A flow
 * offering three equally weighted choices has not decided for the reader, which puts them back to
 * modelling the protocol — the exact problem this correction exists to remove.
 */

import type { ReactElement } from "react";

import type { JourneyState, Stage } from "../lib/journey.js";
import type { Role } from "../lib/role.js";
import { Link } from "../router/router.js";

export interface WorkflowProps {
  readonly journey: JourneyState;
  /** The same chain facts need different language for each person using the workspace. */
  readonly role?: Role;
  /** The route the reader is on, so the stepper can mark the step they are looking at. */
  readonly here?: Stage;
  readonly testId?: string;
}

/** The timeline. Only the stages this role's task actually passes through are rendered. */
export function Workflow({
  journey,
  role = "provider",
  here,
  testId,
}: WorkflowProps): ReactElement | null {
  if (journey.stages.length === 0) return null;

  return (
    <ol className="workflow" data-testid={testId ?? "workflow"}>
      {journey.stages.map((stage) => {
        const done = journey.reached.has(stage);
        const current =
          stage === here || (here === undefined && !done && firstUnreached(journey) === stage);
        return (
          <li
            key={stage}
            className={
              done
                ? "workflow-step workflow-done"
                : current
                  ? "workflow-step workflow-current"
                  : "workflow-step"
            }
            data-stage={stage}
            data-done={done}
            {...(current ? { "aria-current": "step" as const } : {})}
          >
            <span className="workflow-mark" aria-hidden="true">
              {done ? "◆" : current ? "◇" : "·"}
            </span>
            <span className="workflow-label">{stageLabel(role, stage)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function stageLabel(role: Role, stage: Stage): string {
  const labels: Readonly<Record<Role, Readonly<Record<Stage, string>>>> = {
    provider: {
      submitted: "Capital ready",
      encrypted: "Terms live",
      computing: "Matching run",
      "quote-ready": "Quote ready",
      settled: "Settled",
      "ownership-allocated": "Ownership issued",
    },
    borrower: {
      submitted: "Request submitted",
      encrypted: "Terms encrypted",
      computing: "Matching run",
      "quote-ready": "Quote ready",
      settled: "Settled",
      "ownership-allocated": "Ownership issued",
    },
    auditor: {
      submitted: "Request received",
      encrypted: "Snapshot sealed",
      computing: "Checking",
      "quote-ready": "Ready",
      settled: "Settlement verified",
      "ownership-allocated": "Disclosure granted",
    },
  };

  return labels[role][stage];
}

function firstUnreached(journey: JourneyState): Stage | undefined {
  return journey.stages.find((stage) => !journey.reached.has(stage));
}

export interface NextActionProps {
  readonly journey: JourneyState;
  readonly testId?: string;
}

/**
 * The dominant panel: one imperative, one sentence saying why, one link.
 *
 * When the flow is complete it says so rather than inventing a next step — "what has completed" is
 * one of the seven questions the product has to answer, and a screen that always demands something
 * next can never answer it.
 */
export function NextAction({ journey, testId }: NextActionProps): ReactElement {
  const { next } = journey;

  return (
    <section
      className={next.complete === true ? "next-action next-action-complete" : "next-action"}
      data-testid={testId ?? "next-action"}
      data-complete={next.complete === true}
    >
      <span className="eyebrow">
        {next.complete === true ? "Current status" : "Your next step"}
      </span>
      <h2>{next.heading}</h2>
      <p>{next.why}</p>
      <Link
        to={next.path}
        className={next.complete === true ? "ghost" : "primary"}
        data-testid="next-action-go"
      >
        {next.complete === true ? "Open it" : next.label}
      </Link>
    </section>
  );
}
