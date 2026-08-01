/**
 * Who the reader is, and what that changes.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE PRODUCT ASKS THIS FIRST
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Kyrve's three audiences want different things and share almost no vocabulary. A provider commits
 * capital and never sees a borrower's terms; a borrower asks for one quote and never sees the curve
 * behind it; an auditor reads one frozen value and never sees a portfolio.
 *
 * The first version of this interface put nine protocol nouns across the top and let each of them
 * work it out — Fund, Mandates, Request, Curve, Quotes, Series, Capsules, Roll, Proof. Every one of
 * those is a real contract surface and none of them is a task. The navigation is now four
 * destinations, and which ACTIONS appear under them is a function of the role.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IS PERSISTED, AND WHAT IS EMPHATICALLY NOT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Two keys: the chosen role and whether onboarding has been completed. Both are enumerated in
 * `PERSISTED_KEYS` and both are non-secret strings a reader could have typed themselves.
 *
 * NOTHING ELSE MAY BE ADDED HERE. Decrypted values live in `session.ts`'s in-memory map and nowhere
 * else — `scripts/verify/privacy-scan.ts` forbids any storage sink on the decryption path, and the
 * Phase 2 browser suite asserts that the only keys this application ever writes are the two below
 * and that neither holds a value the browser decrypted. That assertion checks CONTENTS, not a count,
 * which is the stronger claim and the one worth making.
 */

export type Role = "provider" | "borrower" | "auditor";

export const ROLES: readonly Role[] = ["provider", "borrower", "auditor"];

export interface RoleCopy {
  /** What this person is called, in their own terms. Never "the maker" or "the taker". */
  readonly label: string;
  /** The outcome they are here for, stated as a result rather than as a feature. */
  readonly promise: string;
  /** The first thing they should do, once connected. */
  readonly firstTask: string;
  readonly firstTaskPath: string;
}

export const ROLE_COPY: Readonly<Record<Role, RoleCopy>> = {
  provider: {
    label: "Provide capital",
    promise: "Set private lending terms and receive confidential ownership of settled credit.",
    firstTask: "Add capital",
    firstTaskPath: "/app/fund",
  },
  borrower: {
    label: "Request capital",
    promise: "Submit private borrowing requirements and receive one executable quote.",
    firstTask: "Create request",
    firstTaskPath: "/app/request",
  },
  auditor: {
    label: "Verify",
    promise: "Inspect public settlement evidence, or decrypt a frozen disclosure granted to you.",
    firstTask: "Open a disclosure",
    firstTaskPath: "/app/capsules",
  },
};

/** Every key this application is permitted to persist. The browser suite asserts this exact set. */
export const PERSISTED_KEYS = ["kyrve.role", "kyrve.onboarded"] as const;

const ROLE_KEY = "kyrve.role";
const ONBOARDED_KEY = "kyrve.onboarded";

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeToRole(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The stored role, or nothing. An unrecognised value is treated as absent rather than trusted. */
export function readRole(): Role | undefined {
  try {
    const stored = window.localStorage.getItem(ROLE_KEY);
    return ROLES.includes(stored as Role) ? (stored as Role) : undefined;
  } catch {
    // Storage can be unavailable — private browsing, a blocked origin. The product works without
    // it; the reader is simply asked which role they are on every visit.
    return undefined;
  }
}

export function writeRole(role: Role): void {
  try {
    window.localStorage.setItem(ROLE_KEY, role);
  } catch {
    // Not fatal. The role lives in React state for this session either way.
  }
  notify();
}

export function hasOnboarded(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDED_KEY) === "true";
  } catch {
    return false;
  }
}

export function markOnboarded(): void {
  try {
    window.localStorage.setItem(ONBOARDED_KEY, "true");
  } catch {
    // Not fatal; the reader is offered onboarding again next visit.
  }
  notify();
}

/** Clears both keys. Offered from the account menu, so a role choice is never a trap. */
export function forgetRole(): void {
  try {
    window.localStorage.removeItem(ROLE_KEY);
    window.localStorage.removeItem(ONBOARDED_KEY);
  } catch {
    // nothing to clear
  }
  notify();
}

export interface RoleAction {
  readonly label: string;
  readonly path: string;
  /** One line saying what the reader gets, not which contract it touches. */
  readonly outcome: string;
}

/**
 * The actions a role can take, in the order the work happens.
 *
 * Every path is an EXISTING route. Nothing was removed to build this — the protocol surfaces are all
 * still addressable, and the technical proof pages are still one click away. What changed is that a
 * reader is no longer asked to know that "Mandates" is where lending terms live.
 *
 * `needsSeries` marks an action that cannot be offered until a settled position exists, because its
 * route takes a series id. Offering it without one would be a control that cannot complete.
 */
export interface RoleActionSet {
  readonly always: readonly RoleAction[];
  readonly needsSeries: readonly ((seriesId: string) => RoleAction)[];
}

export const ROLE_ACTIONS: Readonly<Record<Role, RoleActionSet>> = {
  provider: {
    always: [
      {
        label: "Add capital",
        path: "/app/fund",
        outcome: "Move public tokens into a confidential balance.",
      },
      {
        label: "Set lending terms",
        path: "/app/mandates",
        outcome: "Define privately what you will lend, where, and at what floor.",
      },
      {
        label: "View allocations",
        path: "/app/series",
        outcome: "See what you own of settled credit.",
      },
      {
        label: "Move maturity",
        path: "/app/roll",
        outcome: "Migrate a position to a later maturity, confidentially.",
      },
      {
        label: "Share disclosure",
        path: "/app/capsules",
        outcome: "Grant one reviewer one frozen value, and nothing else.",
      },
    ],
    needsSeries: [
      (seriesId) => ({
        label: "Transfer a position",
        path: `/app/cross/${seriesId}`,
        outcome:
          "Hand a confidential claim to another party without either balance becoming public.",
      }),
    ],
  },
  borrower: {
    always: [
      {
        label: "Request a quote",
        path: "/app/request",
        outcome: "State privately what you need and what you will pay.",
      },
      {
        label: "View matching status",
        path: "/app/curve",
        outcome: "See the public status of private matching without exposing the curve.",
      },
      {
        label: "Review and settle",
        path: "/app/quotes",
        outcome: "See the one executable quote, and settle it at exactly its size.",
      },
    ],
    needsSeries: [],
  },
  auditor: {
    always: [
      {
        label: "Open a disclosure",
        path: "/app/capsules",
        outcome: "Decrypt a frozen snapshot somebody granted you.",
      },
      {
        label: "Verify the deployment",
        path: "/proof/deployment",
        outcome: "Recompute every deployed address against chain state.",
      },
      {
        label: "Download evidence",
        path: "/proof",
        outcome: "Take a signed-off record of what this browser checked.",
      },
    ],
    needsSeries: [
      (seriesId) => ({
        label: "Verify a position",
        path: `/proof/series/${seriesId}`,
        outcome: "Check a series' identity, supply and coverage against the chain.",
      }),
    ],
  },
};
