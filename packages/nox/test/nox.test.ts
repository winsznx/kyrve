import { keccak256, stringToHex } from "viem";
import { describe, expect, it } from "vitest";

import {
  assertMayReceiveTransient,
  assertReversible,
  canRevoke,
  describeSnapshotDisclosure,
  endOfAccessWording,
  GRANT_SEMANTICS,
  IrreversibleGrantError,
  isReversible,
  TransientEscalationError,
} from "../src/acl.js";
import {
  acceptDecryption,
  DecryptionProofError,
  describePublication,
  parseProof,
  verificationCalldata,
} from "../src/decryption.js";
import {
  assertHandleMatchesGraph,
  chunkId,
  expectedAggregateHandle,
  graphRoot,
  HandleBindingError,
  inputCommitment,
  type OperationDescriptor,
  requestBinding,
  stageId,
  universeBinding,
} from "../src/graph.js";
import {
  ABSENT_OPERATIONS,
  assertSupported,
  PRIMITIVES,
  UnsupportedOperationError,
} from "../src/plan.js";
import {
  backoffSchedule,
  classifyFailure,
  DEFAULT_POLL_POLICY,
  HandleNotReadyError,
  parseHandleState,
  statusUrl,
  waitForHandle,
} from "../src/runtime.js";
import { assertFitsType, ENCRYPTED_TYPES, NoxTypeError } from "../src/types.js";

const HANDLE_A = keccak256(stringToHex("handle-a"));
const HANDLE_B = keccak256(stringToHex("handle-b"));
const REQUEST = keccak256(stringToHex("request-1"));
const OWNER = "0x1111111111111111111111111111111111111111" as const;
const APP = "0x2222222222222222222222222222222222222222" as const;

const NETWORK = {
  chainId: 11155111,
  name: "Ethereum Sepolia",
  noxCompute: "0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF",
  gatewayUrl: "https://gateway.example/",
} as const;

describe("encrypted types — exactly five, nothing wider", () => {
  it("exposes only the types Nox actually has", () => {
    expect([...ENCRYPTED_TYPES].sort()).toEqual(
      ["ebool", "eint16", "eint256", "euint16", "euint256"].sort(),
    );
  });

  it("bounds a value to its type before anything is encrypted", () => {
    expect(() => assertFitsType(65_535n, "euint16")).not.toThrow();
    expect(() => assertFitsType(65_536n, "euint16")).toThrow(NoxTypeError);
    expect(() => assertFitsType(1n, "ebool")).not.toThrow();
    expect(() => assertFitsType(2n, "ebool")).toThrow(/does not fit ebool/);
    expect(() => assertFitsType(-1n, "euint256")).toThrow(/does not fit/);
  });
});

describe("the plan builder refuses to pretend booleans exist", () => {
  it("names every operation Nox actually has", () => {
    expect(PRIMITIVES).toContain("select");
    expect(PRIMITIVES).toContain("safeDiv");
    for (const absent of ABSENT_OPERATIONS) {
      expect(PRIMITIVES).not.toContain(absent as never);
    }
  });

  it.each([...ABSENT_OPERATIONS])("rejects %s with an explanation, not a crash", (op) => {
    expect(() => assertSupported(op)).toThrow(UnsupportedOperationError);
    expect(() => assertSupported(op)).toThrow(/no and\/or\/not\/xor/);
  });

  it("accepts a real primitive", () => {
    expect(() => assertSupported("safeMul")).not.toThrow();
  });
});

/**
 * These tests exist because the permanence is the single easiest thing to get wrong in a UI, and
 * getting it wrong means telling a user their data is private when it is not.
 */
describe("ACL grants are permanent and the API says so", () => {
  it("reports no inverse for any persistent grant", () => {
    for (const kind of ["allowThis", "allow", "addViewer", "allowPublicDecryption"] as const) {
      expect(GRANT_SEMANTICS[kind].reversible).toBe(false);
      expect(GRANT_SEMANTICS[kind].inverse).toBeNull();
      expect(isReversible(kind)).toBe(false);
      expect(() => assertReversible(kind)).toThrow(IrreversibleGrantError);
    }
  });

  it("reports disallowTransient as the only inverse that exists", () => {
    expect(GRANT_SEMANTICS.allowTransient.inverse).toBe("disallowTransient");
    expect(() => assertReversible("allowTransient")).not.toThrow();
  });

  it("never claims a grant can be revoked", () => {
    for (const kind of Object.keys(GRANT_SEMANTICS) as Array<keyof typeof GRANT_SEMANTICS>) {
      expect(canRevoke(kind)).toBe(false);
    }
  });

  it("never produces the words 'access revoked'", () => {
    for (const kind of Object.keys(GRANT_SEMANTICS) as Array<keyof typeof GRANT_SEMANTICS>) {
      expect(endOfAccessWording(kind).toLowerCase()).not.toContain("revoked");
    }
  });

  it("marks transient access as carrying full persistent-grant power", () => {
    expect(GRANT_SEMANTICS.allowTransient.persistent).toBe(false);
    expect(GRANT_SEMANTICS.allowTransient.permitsEscalation).toBe(true);
  });
});

describe("transient handles reach reviewed contracts only", () => {
  const policy = { allowlist: [APP] } as const;

  it("permits a reviewed Kyrve contract", () => {
    expect(() => assertMayReceiveTransient(APP, policy)).not.toThrow();
  });

  it("refuses anything else, naming the escalation", () => {
    expect(() => assertMayReceiveTransient(OWNER, policy)).toThrow(TransientEscalationError);
    expect(() => assertMayReceiveTransient(OWNER, policy)).toThrow(/permanently mark/);
  });

  it("refuses to disclose a live handle to an auditor", () => {
    expect(() => describeSnapshotDisclosure(HANDLE_A, HANDLE_A, OWNER, 0)).toThrow(
      TransientEscalationError,
    );
  });

  it("discloses a fresh snapshot with an honest permanence note", () => {
    const disclosure = describeSnapshotDisclosure(HANDLE_A, HANDLE_B, OWNER, 100);
    expect(disclosure.snapshotHandle).toBe(HANDLE_A);
    expect(disclosure.note).toMatch(/permanent/i);
    expect(disclosure.note).not.toMatch(/revok/i);
  });
});

describe("operation graph identifiers are deterministic", () => {
  it("produces stable stage and chunk ids", () => {
    expect(stageId(REQUEST, "accumulateLeafChunk", 3)).toBe(
      stageId(REQUEST, "accumulateLeafChunk", 3),
    );
    expect(chunkId(REQUEST, 5, 0, 16)).toBe(chunkId(REQUEST, 5, 0, 16));
  });

  it("contains no timestamp or random component, since these are memoisation keys", () => {
    const id = stageId(REQUEST, "finalizeLeaf", 0);
    expect(id).toBe(`${REQUEST}:finalizeLeaf:0`);
  });

  it("distinguishes different chunks", () => {
    expect(chunkId(REQUEST, 5, 0, 16)).not.toBe(chunkId(REQUEST, 5, 16, 16));
    expect(stageId(REQUEST, "finalizeLeaf", 0)).not.toBe(stageId(REQUEST, "finalizeLeaf", 1));
  });

  it("rejects a negative or fractional index", () => {
    expect(() => stageId(REQUEST, "finalizeLeaf", -1)).toThrow(/non-negative integer/);
    expect(() => chunkId(REQUEST, 1.5, 0, 16)).toThrow(/non-negative integer/);
    expect(() => chunkId(REQUEST, 0, 0, 0)).toThrow(/positive integer/);
  });

  it("binds a request to its universe", () => {
    const a = requestBinding(REQUEST, universeBinding(HANDLE_A, HANDLE_B, 4), 1);
    const b = requestBinding(REQUEST, universeBinding(HANDLE_A, HANDLE_B, 8), 1);
    expect(a).not.toBe(b);
  });
});

describe("graph root commits to the whole sealed graph, in order", () => {
  const ops: OperationDescriptor[] = [
    { op: "ge", resultType: "ebool", inputs: [HANDLE_A, HANDLE_B] },
    { op: "select", resultType: "euint256", inputs: [HANDLE_A] },
  ];
  const binding = requestBinding(REQUEST, HANDLE_A, 0);

  it("is deterministic", () => {
    expect(graphRoot(binding, ops)).toBe(graphRoot(binding, ops));
  });

  it("changes when the order changes, because order IS the structure", () => {
    expect(graphRoot(binding, [...ops].reverse())).not.toBe(graphRoot(binding, ops));
  });

  it("changes when an operation is omitted", () => {
    expect(graphRoot(binding, ops.slice(0, 1))).not.toBe(graphRoot(binding, ops));
  });

  it("refuses to commit to an empty graph", () => {
    expect(() => graphRoot(binding, [])).toThrow(/empty operation graph/);
  });

  it("derives a distinct expected handle per stage and output index", () => {
    const root = graphRoot(binding, ops);
    expect(expectedAggregateHandle(root, "publishWinner", 0)).not.toBe(
      expectedAggregateHandle(root, "publishWinner", 1),
    );
    expect(expectedAggregateHandle(root, "publishWinner", 0)).not.toBe(
      expectedAggregateHandle(root, "finalizeLeaf", 0),
    );
  });

  it("binds an input commitment to owner, app and chain", () => {
    expect(inputCommitment(HANDLE_A, OWNER, APP, 11155111)).not.toBe(
      inputCommitment(HANDLE_A, OWNER, APP, 421614),
    );
    expect(inputCommitment(HANDLE_A, OWNER, APP, 1)).not.toBe(
      inputCommitment(HANDLE_A, APP, APP, 1),
    );
  });
});

/**
 * The most important behaviour in this package. A decryption proof is replayable by anyone
 * forever, so "a valid proof exists" must never be sufficient.
 */
describe("decryption requires the expected handle, always", () => {
  const proof = { handle: HANDLE_A, value: 42n, signature: `0x${"11".repeat(65)}` } as const;

  it("accepts a proof for the handle this request's graph derives", () => {
    const accepted = acceptDecryption(proof, HANDLE_A, HANDLE_B);
    expect(accepted.value).toBe(42n);
    expect(accepted.boundTo).toBe(HANDLE_B);
  });

  it("rejects a proof for any other handle, however valid", () => {
    expect(() => acceptDecryption(proof, HANDLE_B, HANDLE_B)).toThrow(HandleBindingError);
    expect(() => acceptDecryption(proof, HANDLE_B, HANDLE_B)).toThrow(/replayable by anyone/);
  });

  it("refuses to build verification calldata without the binding", () => {
    expect(() => verificationCalldata(proof, HANDLE_B)).toThrow(HandleBindingError);
    expect(verificationCalldata(proof, HANDLE_A).handle).toBe(HANDLE_A);
  });

  it("rejects a signature of the wrong length", () => {
    expect(() => acceptDecryption({ ...proof, signature: "0x1234" }, HANDLE_A, HANDLE_B)).toThrow(
      DecryptionProofError,
    );
  });

  it("rejects a truncated proof blob", () => {
    expect(() => parseProof(HANDLE_A, "0x1234")).toThrow(/truncated proof is rejected on chain/);
  });

  it("parses a Day 0 shaped proof: 65-byte signature plus a 32-byte result", () => {
    const raw = `0x${"00".repeat(31)}2a${"11".repeat(65)}` as const;
    const parsed = parseProof(HANDLE_A, raw);
    expect(parsed.value).toBe(42n);
    expect((parsed.signature.length - 2) / 2).toBe(65);
  });

  it("assertHandleMatchesGraph is case-insensitive but not value-blind", () => {
    expect(() => assertHandleMatchesGraph(HANDLE_A, HANDLE_A.toUpperCase() as never)).not.toThrow();
    expect(() => assertHandleMatchesGraph(HANDLE_A, HANDLE_B)).toThrow(HandleBindingError);
  });

  it("describes publication as irreversible", () => {
    const intent = describePublication(HANDLE_A);
    expect(intent.reversible).toBe(false);
    expect(intent.warning).toMatch(/IRREVERSIBLE/);
  });
});

describe("handle polling implements Kyrve's policy, not the SDK's ~7s give-up", () => {
  it("builds the status URL without a double slash", () => {
    expect(statusUrl(NETWORK)).toBe("https://gateway.example/v0/public/handles/status");
  });

  it("backs off exponentially within the stage timeout", () => {
    const schedule = backoffSchedule(DEFAULT_POLL_POLICY);
    expect(schedule.length).toBeGreaterThan(1);
    expect(schedule[0]).toBe(250);
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i]).toBeGreaterThanOrEqual(schedule[i - 1] as number);
    }
    expect(schedule.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(DEFAULT_POLL_POLICY.timeoutMs);
  });

  it("polls well past the ~7 second point the SDK gives up at, when asked to", () => {
    const schedule = backoffSchedule({ ...DEFAULT_POLL_POLICY, timeoutMs: 60_000 });
    expect(schedule.reduce((a, b) => a + b, 0)).toBeGreaterThan(7_000);
  });

  it.each([
    ["ready", "ready"],
    ["RESOLVED", "ready"],
    ["pending", "pending"],
    ["computing", "pending"],
    ["failed", "failed"],
    ["something-new", "unknown"],
  ])("parses gateway state %s as %s", (raw, expected) => {
    expect(parseHandleState(raw)).toBe(expected);
    expect(parseHandleState({ state: raw })).toBe(expected);
  });

  it("treats a boolean ready flag as a state", () => {
    expect(parseHandleState({ ready: true })).toBe("ready");
    expect(parseHandleState({ ready: false })).toBe("pending");
  });

  it("classifies retryable and terminal failures apart", () => {
    expect(classifyFailure(503, "").retryable).toBe(true);
    expect(classifyFailure(429, "").retryable).toBe(true);
    // Normal immediately after submission: the ingestor may not have seen the handle yet.
    expect(classifyFailure(404, "").retryable).toBe(true);
    expect(classifyFailure(400, "").retryable).toBe(false);
    expect(classifyFailure(403, "").retryable).toBe(false);
  });

  it("resolves as soon as the gateway reports ready", async () => {
    let calls = 0;
    const status = await waitForHandle(NETWORK, HANDLE_A, {
      sleep: async () => {},
      transport: async () => {
        calls++;
        return { status: 200, body: JSON.stringify({ state: calls >= 3 ? "ready" : "pending" }) };
      },
    });
    expect(status.state).toBe("ready");
    expect(calls).toBe(3);
  });

  it("throws a terminal error immediately rather than burning the retry budget", async () => {
    await expect(
      waitForHandle(NETWORK, HANDLE_A, {
        sleep: async () => {},
        transport: async () => ({ status: 400, body: "bad request" }),
      }),
    ).rejects.toThrow(/terminal/);
  });

  it("times out with a message naming the unmeasured testnet risk", async () => {
    await expect(
      waitForHandle(NETWORK, HANDLE_A, {
        sleep: async () => {},
        transport: async () => ({ status: 200, body: JSON.stringify({ state: "pending" }) }),
      }),
    ).rejects.toThrow(HandleNotReadyError);
  });
});
