/**
 * The published-handle freshness rule, off chain — delta R-14.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE FAILURE THIS EXISTS TO MAKE IMPOSSIBLE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * An epoch's five public results are written across TWO transactions: `publishWinner` sets four
 * handles, `publishAggregate` sets the fifth and seals the graph. Read the set in between and four
 * entries are valid while the fifth has never been written.
 *
 * The undefined handle is not obviously wrong. It carries an embedded chain id of 0, so the handle
 * gateway answers
 *
 *     unknown_chain: chain_id 0 not configured
 *
 * which names neither the handle nor the role nor the mistake — on a path where the other four
 * decrypt perfectly, which is exactly the shape that sends someone looking at their RPC
 * configuration instead of at their read ordering.
 *
 * So the rule is: **fetch each expected handle only after the stage that produces it, re-read the
 * whole set after the last one, and refuse a set that is not complete, current and bound — locally,
 * with a named error, before any gateway request is made.**
 *
 * `KyrvePublicResultVerifier` enforces the same rule on chain, so a keeper that skipped this module
 * would still be refused. This exists so the refusal costs nothing and says what is wrong.
 */

import type { Hex } from "viem";

import {
  CURVE_RESULT_ROLE_NAMES,
  CURVE_RESULT_ROLES,
  CurveEpochStage,
  type CurveResultRole,
  type PublishedHandles,
  ZERO_HANDLE,
} from "./types.js";

export class StalePublishedHandleSet extends Error {
  constructor(
    readonly role: CurveResultRole,
    readonly reason: string,
    readonly epochId: Hex,
  ) {
    super(
      `the published handle for ${CURVE_RESULT_ROLE_NAMES[role]} of epoch ${epochId} ${reason}. ` +
        "The handle set was read before the stage that writes it, or belongs to another epoch. " +
        "Re-read every published handle from chain state after the last publishing stage; never " +
        "reuse a cached partial set. This is Phase 3 delta R-14.",
    );
    this.name = "StalePublishedHandleSet";
  }
}

export class EpochNotSettleable extends Error {
  constructor(
    readonly epochId: Hex,
    readonly reason: string,
  ) {
    super(`epoch ${epochId} cannot be settled against: ${reason}`);
    this.name = "EpochNotSettleable";
  }
}

/**
 * A handle set, bound to the exact chain state it was read at.
 *
 * The binding is the point. A set of five handles on its own says nothing about which epoch, which
 * request or which computation it belongs to, and a snapshot carried between processes with those
 * fields missing is the same mistake as caching a partial set.
 */
export interface PublishedHandleSnapshot {
  readonly epochId: Hex;
  readonly requestId: Hex;
  readonly graphRoot: Hex;
  readonly blockNumber: bigint;
  readonly stage: CurveEpochStage;
  readonly sealed: boolean;
  readonly handles: PublishedHandles;
  /** What `CurveGraphRegistry.expectedResultHandle` returned for each role, in role order. */
  readonly registered: readonly Hex[];
}

function handleFor(handles: PublishedHandles, role: CurveResultRole): Hex {
  switch (role) {
    case 0:
      return handles.marketIndex;
    case 1:
      return handles.rateIndex;
    case 2:
      return handles.floorPassed;
    case 3:
      return handles.quoteReady;
    default:
      return handles.aggregateFill;
  }
}

/**
 * Refuses anything the settlement layer would refuse, before a gateway is touched.
 *
 * Checks, in order, cheapest and most diagnostic first:
 *
 *   1. the epoch is `Complete` and its graph is sealed — a partially computed epoch is a quote over
 *      part of the universe;
 *   2. the graph root is non-zero and matches what the caller expects;
 *   3. every one of the five handles is present, non-zero, and exactly the handle the graph
 *      registered for its role.
 */
export function assertSettleableSnapshot(
  snapshot: PublishedHandleSnapshot,
  expected: { readonly epochId: Hex; readonly requestId: Hex; readonly graphRoot: Hex },
): void {
  const { epochId } = snapshot;

  if (snapshot.epochId !== expected.epochId) {
    throw new EpochNotSettleable(epochId, `the snapshot is for epoch ${expected.epochId}`);
  }
  if (snapshot.stage !== CurveEpochStage.Complete) {
    throw new EpochNotSettleable(
      epochId,
      `it is at stage ${CurveEpochStage[snapshot.stage]}, not Complete. Every published handle ` +
        "read before the final stage may be undefined.",
    );
  }
  if (!snapshot.sealed) {
    throw new EpochNotSettleable(epochId, "its operation graph is not sealed");
  }
  if (snapshot.graphRoot === ZERO_HANDLE) {
    throw new EpochNotSettleable(epochId, "its graph root is zero");
  }
  if (snapshot.graphRoot !== expected.graphRoot) {
    throw new EpochNotSettleable(
      epochId,
      `its graph root is ${snapshot.graphRoot}, not the expected ${expected.graphRoot}`,
    );
  }
  if (snapshot.requestId !== expected.requestId) {
    throw new EpochNotSettleable(
      epochId,
      `it answers request ${snapshot.requestId}, not ${expected.requestId}`,
    );
  }
  if (snapshot.registered.length !== CURVE_RESULT_ROLES.length) {
    throw new EpochNotSettleable(
      epochId,
      `${snapshot.registered.length} registered handles were read, not ${CURVE_RESULT_ROLES.length}`,
    );
  }

  for (const role of CURVE_RESULT_ROLES) {
    const published = handleFor(snapshot.handles, role);
    const registered = snapshot.registered[role];

    if (published === undefined || published === ZERO_HANDLE) {
      throw new StalePublishedHandleSet(role, "is zero or was never written", epochId);
    }
    if (registered === undefined || registered === ZERO_HANDLE) {
      throw new StalePublishedHandleSet(role, "was never registered by the graph", epochId);
    }
    if (published !== registered) {
      throw new StalePublishedHandleSet(
        role,
        `is ${published}, but the graph registered ${registered}`,
        epochId,
      );
    }
  }
}

/** Whether a snapshot would pass {assertSettleableSnapshot}, without throwing. */
export function isSettleableSnapshot(
  snapshot: PublishedHandleSnapshot,
  expected: { readonly epochId: Hex; readonly requestId: Hex; readonly graphRoot: Hex },
): boolean {
  try {
    assertSettleableSnapshot(snapshot, expected);
    return true;
  } catch {
    return false;
  }
}
