/**
 * Typed operation-plan builders.
 *
 * DESIGN CONSTRAINT, and the reason this file looks the way it does: **Nox has no encrypted
 * boolean operations.** There is no `and`, no `or`, no `not`, no `xor`, and `select` has no
 * `ebool` overload — so even the usual workaround `and(a,b) = select(a, b, false)` is unavailable.
 * Verified by enumerating the full callable surface of `sdk/Nox.sol@0.2.4`.
 *
 * This package therefore exposes NO boolean API. Offering `and()` here would be a lie that
 * compiles. Predicates are combined arithmetically, and the builders below make the real cost
 * visible: every primitive is a separate external call, and there is no batch entry point, so op
 * count is the budget (docs/day0/OPERATION-BUDGET.md).
 */

import { COMPOSITE_GAS, PRIMITIVE_GAS, STAGE_GAS } from "@kyrve/config";

import type { EncryptedType, Handle } from "./types.js";

export type PrimitiveOp =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "safeAdd"
  | "safeSub"
  | "safeMul"
  | "safeDiv"
  | "eq"
  | "ne"
  | "lt"
  | "le"
  | "gt"
  | "ge"
  | "select"
  | "toEbool"
  | "toEuint16"
  | "toEuint256"
  | "toEint16"
  | "toEint256";

/** Every primitive that exists. Nothing outside this list may be planned. */
export const PRIMITIVES: readonly PrimitiveOp[] = [
  "add",
  "sub",
  "mul",
  "div",
  "safeAdd",
  "safeSub",
  "safeMul",
  "safeDiv",
  "eq",
  "ne",
  "lt",
  "le",
  "gt",
  "ge",
  "select",
  "toEbool",
  "toEuint16",
  "toEuint256",
  "toEint16",
  "toEint256",
];

/**
 * Operations a caller might reasonably expect and which DO NOT EXIST. Named explicitly so a
 * mistaken call fails with an explanation rather than `undefined is not a function`.
 */
export const ABSENT_OPERATIONS = [
  "and",
  "or",
  "not",
  "xor",
  "min",
  "max",
  "rem",
  "mod",
  "shl",
  "shr",
  "mulDiv",
] as const;

export class UnsupportedOperationError extends Error {
  constructor(op: string) {
    super(
      `Nox has no "${op}" operation. The complete surface is: ${PRIMITIVES.join(" ")} plus ACL ` +
        "functions. In particular there is no and/or/not/xor and select has no ebool overload, so " +
        "booleans cannot be combined directly — arithmetise instead. There is also no fused mulDiv " +
        "and no batch entry point: every primitive is a separate external call.",
    );
    this.name = "UnsupportedOperationError";
  }
}

export function assertSupported(op: string): asserts op is PrimitiveOp {
  if (!(PRIMITIVES as readonly string[]).includes(op)) {
    throw new UnsupportedOperationError(op);
  }
}

export interface PlannedOp {
  readonly op: PrimitiveOp;
  readonly resultType: EncryptedType;
  readonly inputs: readonly Handle[];
  readonly note: string;
  /** Measured marginal gas for this primitive. */
  readonly gas: number;
}

export interface OperationPlan {
  readonly label: string;
  readonly ops: readonly PlannedOp[];
  readonly totalGas: number;
}

function plan(label: string, ops: readonly PlannedOp[]): OperationPlan {
  return { label, ops, totalGas: ops.reduce((sum, o) => sum + o.gas, 0) };
}

function op(
  operation: PrimitiveOp,
  resultType: EncryptedType,
  inputs: readonly Handle[],
  note: string,
  gas: number,
): PlannedOp {
  return { op: operation, resultType, inputs, note, gas };
}

/** A comparison producing an `ebool`. */
export function comparison(
  kind: "eq" | "ne" | "lt" | "le" | "gt" | "ge",
  left: Handle,
  right: Handle,
): OperationPlan {
  const gas =
    kind === "ge" ? PRIMITIVE_GAS.ge : kind === "lt" ? PRIMITIVE_GAS.lt : PRIMITIVE_GAS.eq;
  return plan(`${kind}`, [op(kind, "ebool", [left, right], `${kind} -> ebool`, gas)]);
}

/**
 * Converts an `ebool` predicate to a 0/1 `euint16` indicator.
 *
 * This is the ONLY way to combine predicates, because no boolean operation exists. Prefer
 * `selectAsMask` where possible: it tests and applies in a single operation and is cheaper.
 */
export function predicateIndicator(predicate: Handle, one: Handle, zero: Handle): OperationPlan {
  return plan("indicator", [
    op(
      "select",
      "euint16",
      [predicate, one, zero],
      "ebool -> euint16 0/1; the only way to combine predicates",
      COMPOSITE_GAS.indicator,
    ),
  ]);
}

/**
 * `select(cond, cachedValue, 0)` — tests eligibility AND applies it in one operation.
 *
 * This is the optimisation that makes the full 16x128 universe executable. It removes both the
 * indicator conversion and the multiply, taking one eligibility cell from 146,865 gas to 76,402.
 */
export function selectAsMask(
  predicate: Handle,
  valueIfTrue: Handle,
  zero: Handle,
  resultType: "euint16" | "euint256" = "euint256",
): OperationPlan {
  const gas = resultType === "euint16" ? PRIMITIVE_GAS.select16 : PRIMITIVE_GAS.select256;
  return plan("selectAsMask", [
    op(
      "select",
      resultType,
      [predicate, valueIfTrue, zero],
      "tests and applies eligibility in one operation, replacing indicator + multiply",
      gas,
    ),
  ]);
}

/** Encrypted multiplication. There is no plaintext operand overload: wrap the scalar first. */
export function multiply(
  left: Handle,
  right: Handle,
  resultType: "euint16" | "euint256" = "euint256",
): OperationPlan {
  const gas = resultType === "euint16" ? PRIMITIVE_GAS.mul16 : PRIMITIVE_GAS.mul;
  return plan("mul", [
    op("mul", resultType, [left, right], "wrapping on overflow — bound the operands", gas),
  ]);
}

/**
 * `safeSub`, returning `(ebool success, T result)`.
 *
 * On failure `success` is encrypted false AND the result is encrypted ZERO, while the transaction
 * still succeeds. `success` is a ciphertext, so it cannot be branched on in Solidity — it must be
 * threaded through `select`. Never let a silent zero become an allocation.
 */
export function safeSubtract(left: Handle, right: Handle): OperationPlan {
  return plan("safeSub", [
    op(
      "safeSub",
      "euint256",
      [left, right],
      "returns (ebool success, T result); result is encrypted ZERO on failure and the transaction " +
        "still succeeds — thread success through select",
      PRIMITIVE_GAS.safeSub,
    ),
  ]);
}

/** One eligibility cell in the cached form: ge -> select256 -> add -> select16 -> add16. */
export function capacityReduction(
  publicTick: Handle,
  providerMinTick: Handle,
  capacityIfEligible: Handle,
  countIfEligible: Handle,
  capacityAcc: Handle,
  countAcc: Handle,
  zero256: Handle,
  zero16: Handle,
): OperationPlan {
  return plan("accumulateCell", [
    op(
      "ge",
      "ebool",
      [publicTick, providerMinTick],
      "public leaf tick >= encrypted provider minimum",
      PRIMITIVE_GAS.ge,
    ),
    op(
      "select",
      "euint256",
      [publicTick, capacityIfEligible, zero256],
      "capacity if eligible",
      PRIMITIVE_GAS.select256,
    ),
    op(
      "add",
      "euint256",
      [capacityAcc, capacityIfEligible],
      "accumulate capacity",
      PRIMITIVE_GAS.add,
    ),
    op(
      "select",
      "euint16",
      [publicTick, countIfEligible, zero16],
      "count if eligible",
      PRIMITIVE_GAS.select16,
    ),
    op(
      "add",
      "euint16",
      [countAcc, countIfEligible],
      "accumulate provider count",
      PRIMITIVE_GAS.add16,
    ),
  ]);
}

/**
 * Privacy floor: a leaf below the minimum provider count contributes encrypted zero.
 *
 * It does NOT revert and emits no public reason — a private rejection must never become a public
 * oracle (PRD invariant 1).
 */
export function providerCountReduction(
  countAcc: Handle,
  minProviders: Handle,
  capacityAcc: Handle,
  zero256: Handle,
): OperationPlan {
  return plan("privacyFloor", [
    op(
      "ge",
      "ebool",
      [countAcc, minProviders],
      "provider count >= privacy floor",
      PRIMITIVE_GAS.ge,
    ),
    op(
      "select",
      "euint256",
      [countAcc, capacityAcc, zero256],
      "below the floor contributes encrypted ZERO — never a public reason",
      PRIMITIVE_GAS.select256,
    ),
  ]);
}

/** Balanced reduction over leaves. There is no `max`, so this is compare-then-select. */
export function leafWinnerReduction(
  leafFillable: Handle,
  bestFillable: Handle,
  leafIndex: Handle,
  bestIndex: Handle,
): OperationPlan {
  return plan("reduceWinner", [
    op(
      "gt",
      "ebool",
      [leafFillable, bestFillable],
      "no max exists: compare then select",
      PRIMITIVE_GAS.eq,
    ),
    op(
      "select",
      "euint256",
      [leafFillable, leafFillable, bestFillable],
      "carry the better fill",
      PRIMITIVE_GAS.select256,
    ),
    op(
      "select",
      "euint16",
      [leafIndex, leafIndex, bestIndex],
      "carry its index",
      PRIMITIVE_GAS.select16,
    ),
  ]);
}

/**
 * Pro-rata allocation: `fillable * contribution / totalCapacity`.
 *
 * There is no fused `mulDiv`, so this is `safeMul` then `safeDiv`, and BOTH encrypted success
 * flags are threaded through `select`. Unsafe `div` saturates to the type maximum on divide-by-
 * zero rather than reverting, and a failed safe op returns encrypted zero silently — either would
 * turn a failure into a plausible-looking allocation.
 */
export function proportionalAllocation(
  fillable: Handle,
  contribution: Handle,
  totalCapacity: Handle,
  zero256: Handle,
): OperationPlan {
  return plan("allocate", [
    op(
      "safeMul",
      "euint256",
      [fillable, contribution],
      "no fused mulDiv exists",
      PRIMITIVE_GAS.safeMul,
    ),
    op(
      "safeDiv",
      "euint256",
      [fillable, totalCapacity],
      "unsafe div SATURATES on zero rather than reverting",
      PRIMITIVE_GAS.safeDiv,
    ),
    op(
      "select",
      "euint256",
      [fillable, fillable, zero256],
      "thread the safeMul success flag",
      PRIMITIVE_GAS.select256,
    ),
    op(
      "select",
      "euint256",
      [fillable, fillable, zero256],
      "thread the safeDiv success flag",
      PRIMITIVE_GAS.select256,
    ),
  ]);
}

/** Measured cost of one cached eligibility cell, for budget assertions. */
export const CELL_GAS = STAGE_GAS.accumulateCell;
