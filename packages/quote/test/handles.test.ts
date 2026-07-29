/**
 * The R-14 regression: the partial published-handle set, reproduced and refused.
 *
 * This is the failure that cost a real Sepolia epoch. Four handles were valid, the fifth had never
 * been written, and the gateway answered `unknown_chain: chain_id 0 not configured` — a message
 * that names neither the handle nor the role. The test that matters is not "a complete set passes";
 * it is that each incomplete shape fails LOCALLY, by name, before anything is sent anywhere.
 */

import type { Hex } from "viem";
import { describe, expect, it } from "vitest";

import {
  assertSettleableSnapshot,
  CurveEpochStage,
  CurveResultRole,
  EpochNotSettleable,
  isSettleableSnapshot,
  type PublishedHandleSnapshot,
  StalePublishedHandleSet,
  ZERO_HANDLE,
} from "../src/index.js";

const EPOCH = `0x${"11".repeat(32)}` as Hex;
const REQUEST = `0x${"22".repeat(32)}` as Hex;
const ROOT = `0x${"33".repeat(32)}` as Hex;

const HANDLES = {
  marketIndex: `0x${"a1".repeat(32)}` as Hex,
  rateIndex: `0x${"a2".repeat(32)}` as Hex,
  floorPassed: `0x${"a3".repeat(32)}` as Hex,
  quoteReady: `0x${"a4".repeat(32)}` as Hex,
  aggregateFill: `0x${"a5".repeat(32)}` as Hex,
} as const;

const REGISTERED: readonly Hex[] = [
  HANDLES.marketIndex,
  HANDLES.rateIndex,
  HANDLES.floorPassed,
  HANDLES.quoteReady,
  HANDLES.aggregateFill,
];

const EXPECTED = { epochId: EPOCH, requestId: REQUEST, graphRoot: ROOT } as const;

function snapshot(overrides: Partial<PublishedHandleSnapshot> = {}): PublishedHandleSnapshot {
  return {
    epochId: EPOCH,
    requestId: REQUEST,
    graphRoot: ROOT,
    blockNumber: 1234n,
    stage: CurveEpochStage.Complete,
    sealed: true,
    handles: HANDLES,
    registered: REGISTERED,
    ...overrides,
  };
}

describe("a complete, sealed, bound snapshot", () => {
  it("is settleable", () => {
    expect(() => assertSettleableSnapshot(snapshot(), EXPECTED)).not.toThrow();
    expect(isSettleableSnapshot(snapshot(), EXPECTED)).toBe(true);
  });

  it("is bound to a block number, an epoch, a request and a graph root", () => {
    const bound = snapshot();
    expect(bound.blockNumber).toBeGreaterThan(0n);
    expect(bound.epochId).toBe(EPOCH);
    expect(bound.requestId).toBe(REQUEST);
    expect(bound.graphRoot).toBe(ROOT);
  });
});

describe("delta R-14 — the partial handle set", () => {
  it("refuses a set read between publishWinner and publishAggregate", () => {
    // Exactly the shape that produced `unknown_chain: chain_id 0 not configured`: four valid
    // handles, and an aggregate that has never been written.
    const partial = snapshot({
      handles: { ...HANDLES, aggregateFill: ZERO_HANDLE },
    });

    expect(() => assertSettleableSnapshot(partial, EXPECTED)).toThrow(StalePublishedHandleSet);
    try {
      assertSettleableSnapshot(partial, EXPECTED);
    } catch (error) {
      const stale = error as StalePublishedHandleSet;
      expect(stale.role).toBe(CurveResultRole.AggregateFillAmount);
      expect(stale.message).toContain("aggregateFillAmount");
      expect(stale.message).toContain("R-14");
    }
  });

  it("refuses a set whose stage has not reached Complete, before looking at any handle", () => {
    // The cheaper check must fire first: at stage Allocate the aggregate cannot exist yet, and
    // saying so is more useful than naming a handle.
    const midEpoch = snapshot({
      stage: CurveEpochStage.Allocate,
      handles: { ...HANDLES, aggregateFill: ZERO_HANDLE },
    });
    expect(() => assertSettleableSnapshot(midEpoch, EXPECTED)).toThrow(EpochNotSettleable);
  });

  it("refuses an unsealed graph", () => {
    expect(() => assertSettleableSnapshot(snapshot({ sealed: false }), EXPECTED)).toThrow(
      EpochNotSettleable,
    );
  });

  it("refuses a handle that is real but belongs to another epoch", () => {
    const foreign = `0x${"ff".repeat(32)}` as Hex;
    const swapped = snapshot({ handles: { ...HANDLES, aggregateFill: foreign } });

    expect(() => assertSettleableSnapshot(swapped, EXPECTED)).toThrow(StalePublishedHandleSet);
    try {
      assertSettleableSnapshot(swapped, EXPECTED);
    } catch (error) {
      expect((error as StalePublishedHandleSet).role).toBe(CurveResultRole.AggregateFillAmount);
    }
  });

  it("names the role for every one of the five, not just the aggregate", () => {
    const roles: readonly [keyof typeof HANDLES, CurveResultRole][] = [
      ["marketIndex", CurveResultRole.SelectedMarketIndex],
      ["rateIndex", CurveResultRole.SelectedRateIndex],
      ["floorPassed", CurveResultRole.PrivacyFloorPassed],
      ["quoteReady", CurveResultRole.QuoteReady],
      ["aggregateFill", CurveResultRole.AggregateFillAmount],
    ];

    for (const [field, role] of roles) {
      const broken = snapshot({ handles: { ...HANDLES, [field]: ZERO_HANDLE } });
      try {
        assertSettleableSnapshot(broken, EXPECTED);
        throw new Error(`${field} was accepted as zero`);
      } catch (error) {
        expect(error).toBeInstanceOf(StalePublishedHandleSet);
        expect((error as StalePublishedHandleSet).role).toBe(role);
      }
    }
  });

  it("refuses a set whose registered handles were never read", () => {
    expect(() => assertSettleableSnapshot(snapshot({ registered: [] }), EXPECTED)).toThrow(
      EpochNotSettleable,
    );
  });
});

describe("identity binding", () => {
  it("refuses a snapshot for a different epoch", () => {
    const other = snapshot({ epochId: `0x${"99".repeat(32)}` as Hex });
    expect(() => assertSettleableSnapshot(other, EXPECTED)).toThrow(EpochNotSettleable);
  });

  it("refuses a stale graph root", () => {
    const stale = snapshot({ graphRoot: `0x${"44".repeat(32)}` as Hex });
    expect(() => assertSettleableSnapshot(stale, EXPECTED)).toThrow(EpochNotSettleable);
  });

  it("refuses a zero graph root", () => {
    const zeroRoot = snapshot({ graphRoot: ZERO_HANDLE });
    expect(() =>
      assertSettleableSnapshot(zeroRoot, { ...EXPECTED, graphRoot: ZERO_HANDLE }),
    ).toThrow(EpochNotSettleable);
  });

  it("refuses a snapshot answering a different request", () => {
    const other = snapshot({ requestId: `0x${"55".repeat(32)}` as Hex });
    expect(() => assertSettleableSnapshot(other, EXPECTED)).toThrow(EpochNotSettleable);
  });
});
