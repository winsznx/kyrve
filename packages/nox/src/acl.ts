/**
 * ACL semantics, modelled so the irreversibility is impossible to overlook.
 *
 * Verified against `sdk/Nox.sol@0.2.4` and confirmed at runtime during Day 0:
 *
 *   - there is **no `removeViewer`**
 *   - there is **no `removeAdmin`**
 *   - there is **no way to un-set `allowPublicDecryption`**
 *   - only `disallowTransient` exists
 *
 * `addViewer` and `allowPublicDecryption` were both observed flipping false -> true with no
 * inverse anywhere in the ABI. Every persistent grant is therefore PERMANENT.
 *
 * The escalation that is easy to miss: **transient access carries full persistent-grant power.**
 * Any contract handed a transient handle can permanently mark it publicly decryptable, or mint
 * persistent admins for third parties, within that one transaction. Only reviewed Kyrve contracts
 * may receive transient handles. Auditors receive fresh snapshot handles, never live portfolio
 * handles.
 */

import type { Address, Handle } from "./types.js";

export type GrantKind =
  | "allowThis"
  | "allow"
  | "addViewer"
  | "allowPublicDecryption"
  | "allowTransient";

export interface Grant {
  readonly kind: GrantKind;
  readonly handle: Handle;
  /** Absent for `allowThis` and `allowPublicDecryption`, which take no grantee. */
  readonly grantee?: Address;
}

export interface GrantSemantics {
  readonly persistent: boolean;
  readonly reversible: boolean;
  /** The function that undoes it, or null when none exists. */
  readonly inverse: string | null;
  /** Can the grantee escalate to a permanent grant from here? */
  readonly permitsEscalation: boolean;
}

export const GRANT_SEMANTICS: Record<GrantKind, GrantSemantics> = {
  allowThis: { persistent: true, reversible: false, inverse: null, permitsEscalation: true },
  allow: { persistent: true, reversible: false, inverse: null, permitsEscalation: true },
  addViewer: { persistent: true, reversible: false, inverse: null, permitsEscalation: true },
  allowPublicDecryption: {
    persistent: true,
    reversible: false,
    inverse: null,
    permitsEscalation: true,
  },
  // Scoped to one transaction — but within it, the grantee has full persistent-grant power.
  allowTransient: {
    persistent: false,
    reversible: true,
    inverse: "disallowTransient",
    permitsEscalation: true,
  },
};

export class IrreversibleGrantError extends Error {
  constructor(kind: GrantKind) {
    super(
      `${kind} is irreversible: Nox exposes no inverse for it. There is no removeViewer, no ` +
        "removeAdmin and no way to un-set allowPublicDecryption. Only disallowTransient exists. " +
        "Treat this grant as permanent.",
    );
    this.name = "IrreversibleGrantError";
  }
}

export function isReversible(kind: GrantKind): boolean {
  return GRANT_SEMANTICS[kind].reversible;
}

/** Throws for any grant that cannot be undone. Call this at the point of decision, not after. */
export function assertReversible(kind: GrantKind): void {
  if (!isReversible(kind)) throw new IrreversibleGrantError(kind);
}

/**
 * The UI copy that is permitted for a grant that has already been made.
 *
 * A viewer who could already decrypt a handle can still decrypt it forever. Saying "access
 * revoked" would be a lie about a cryptographic fact, so this returns the honest phrasing instead.
 */
export function endOfAccessWording(kind: GrantKind): string {
  switch (kind) {
    case "allowTransient":
      return "transient access ended";
    case "addViewer":
      return "live access ended; this historical snapshot remains available";
    case "allowPublicDecryption":
      return "this value is intentionally public and remains public";
    default:
      return "future snapshots disabled; previously shared values remain readable";
  }
}

/** Never returns true. Present so a caller searching for "revoke" finds this and its reason. */
export function canRevoke(_kind: GrantKind): false {
  return false;
}

export interface TransientRecipientPolicy {
  /** Reviewed Kyrve contracts permitted to receive transient handles. */
  readonly allowlist: readonly Address[];
}

export class TransientEscalationError extends Error {
  constructor(recipient: Address) {
    super(
      `${recipient} is not a reviewed Kyrve contract and must not receive a transient handle. ` +
        "Transient access carries full persistent-grant power: the recipient can permanently mark " +
        "the handle publicly decryptable or mint persistent admins for third parties.",
    );
    this.name = "TransientEscalationError";
  }
}

/** Gate every transient grant through this. The blast radius is a permanent publish. */
export function assertMayReceiveTransient(
  recipient: Address,
  policy: TransientRecipientPolicy,
): void {
  const permitted = policy.allowlist.some((a) => a.toLowerCase() === recipient.toLowerCase());
  if (!permitted) throw new TransientEscalationError(recipient);
}

/**
 * Auditor disclosure always uses a FRESH snapshot handle, never a live portfolio handle.
 *
 * Because a viewer grant is permanent, granting on a live handle would give the auditor
 * irrevocable access to every future value that handle takes. A snapshot handle freezes one
 * moment, so the permanence is bounded to what was actually disclosed.
 */
export interface SnapshotDisclosure {
  readonly snapshotHandle: Handle;
  readonly auditor: Address;
  readonly grantedAt: number;
  readonly note: string;
}

export function describeSnapshotDisclosure(
  snapshotHandle: Handle,
  liveHandle: Handle,
  auditor: Address,
  grantedAt: number,
): SnapshotDisclosure {
  if (snapshotHandle === liveHandle) {
    throw new TransientEscalationError(auditor);
  }
  return {
    snapshotHandle,
    auditor,
    grantedAt,
    note:
      "Viewer grants are permanent. This auditor can decrypt this snapshot forever, and nothing " +
      "else. Ending the engagement stops future snapshots; it cannot withdraw this one.",
  };
}
