/**
 * The real Nox handle derivation, reproduced off chain.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS REPLACES `expectedAggregateHandle`
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Phase 1 shipped `graph.ts::expectedAggregateHandle`, which computes
 *
 *     keccak256(abi.encode(root, stage, outputIndex))
 *
 * and calls the result "the handle this request's published aggregate MUST be". It is not. That
 * formula has no relationship to how NoxCompute derives a handle, so it could never equal a real
 * one, and any check comparing a real proof's handle against it would fail for every honest quote —
 * or, worse, would be relaxed until it passed and stopped checking anything. It went unnoticed
 * because Phase 1 had no live gateway to compare against.
 *
 * The real derivation, read from `modules/Compute.sol::_generateHandle` (nox-protocol-contracts
 * 0.2.4):
 *
 *     pre    = keccak256(abi.encode(operator, operands, noxCompute, uniqueSeed, outputIndex))
 *     handle = (pre >> 56)                  // 25 bytes of hash in bytes 7..31
 *            | (version  << 248)            // byte 0
 *            | (chainId  << 216)            // bytes 1..4
 *            | (teeType  << 208)            // byte 5
 *            | (attrs    << 200)            // byte 6
 *
 * and the seed, from `_generateHandleUniqueSeed`:
 *
 *     uniqueSeed = 0                  if ANY operand is confidential   -> DETERMINISTIC
 *                = ++storageCounter   if EVERY operand is public       -> NOT REPRODUCIBLE
 *
 * Recorded as delta R-4.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE LIMIT, STATED UP FRONT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * An all-public operand set makes the handle depend on a NoxCompute storage counter this package
 * cannot see. {deriveHandle} therefore REFUSES that case rather than guessing — see
 * {AllPublicOperandsError}. The curve engine is built so it never occurs on a path whose handle
 * must be predicted: `KyrveCurveBase._requireConfidential` asserts the same property on chain, from
 * the other side.
 *
 * This is verified against reality, not asserted: `packages/nox/test/handle-derivation.test.ts`
 * compares handles computed here against handles a live NoxCompute actually returned during the
 * confidential suite. If the derivation were wrong, the graph binding would be decorative.
 */

import { encodeAbiParameters, keccak256 } from "viem";

import type { Address, EncryptedType, Handle, Hex } from "./types.js";

/** `INoxCompute.Operator`, in declaration order. Nothing outside this list exists. */
export const NOX_OPERATOR = {
  wrapAsPublicHandle: 0,
  add: 1,
  sub: 2,
  mul: 3,
  div: 4,
  safeAdd: 5,
  safeSub: 6,
  safeMul: 7,
  safeDiv: 8,
  select: 9,
  eq: 10,
  ne: 11,
  lt: 12,
  le: 13,
  gt: 14,
  ge: 15,
  transfer: 16,
  mint: 17,
  burn: 18,
} as const;

export type NoxOperator = keyof typeof NOX_OPERATOR;

/**
 * `TEEType`, for the five encrypted types Kyrve uses.
 *
 * The enum is 100+ members wide — every uint width, every int width, every fixed bytes size — and
 * only these five have Solidity SDK wrappers. The indexes are read from `utils/TypeUtils.sol` and
 * are not guessable from the type name: `Uint256` is 35, not 32.
 */
export const NOX_TEE_TYPE: Record<EncryptedType, number> = {
  ebool: 0,
  euint16: 5,
  euint256: 35,
  eint16: 37,
  eint256: 67,
};

/** Bit 0 of the attribute byte. Set on every operation output; clear on every public handle. */
export const ATTR_IS_UNIQUE_HANDLE = 0x01;
const HANDLE_VERSION = 0;

export class AllPublicOperandsError extends Error {
  constructor(operands: readonly Handle[]) {
    super(
      "every operand is a PUBLIC handle, so NoxCompute derives this result from an incrementing " +
        "storage counter (`_generateHandleUniqueSeed`) and the handle cannot be reproduced off " +
        `chain. Operands: ${operands.join(", ")}. On a path whose handle must be predicted, thread ` +
        "at least one confidential operand — which is what `KyrveCurveBase._requireConfidential` " +
        "enforces from the contract side.",
    );
    this.name = "AllPublicOperandsError";
  }
}

export class HandleDerivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandleDerivationError";
  }
}

/** `HandleUtils.isPublicHandle`: bit 0 of byte 6 is clear. Public handles bypass every ACL gate. */
export function isPublicHandle(handle: Handle): boolean {
  return (byteAt(handle, 6) & ATTR_IS_UNIQUE_HANDLE) === 0;
}

/** The TEE type encoded in byte 5 of a handle. */
export function teeTypeOf(handle: Handle): number {
  return byteAt(handle, 5);
}

/** The chain id encoded in bytes 1..4. A handle minted for one chain is refused on another. */
export function chainIdOf(handle: Handle): number {
  return (
    (byteAt(handle, 1) << 24) |
    (byteAt(handle, 2) << 16) |
    (byteAt(handle, 3) << 8) |
    byteAt(handle, 4)
  );
}

export interface DeriveHandleInput {
  readonly operator: NoxOperator;
  readonly operands: readonly Handle[];
  readonly resultType: EncryptedType;
  readonly noxCompute: Address;
  readonly chainId: number;
  /** 0 for the first result. `safeAdd`/`safeSub`/`safeMul`/`safeDiv` put the success flag last. */
  readonly outputIndex?: number;
}

/**
 * The handle an operation will produce, computed before it is executed.
 *
 * @throws {AllPublicOperandsError} when every operand is public, because the result then depends on
 *         NoxCompute's storage counter. Refusing is the only honest answer.
 */
export function deriveHandle(input: DeriveHandleInput): Handle {
  const { operator, operands, resultType, noxCompute, chainId } = input;
  const outputIndex = input.outputIndex ?? 0;

  if (operands.length === 0)
    throw new HandleDerivationError(`${operator} needs at least one operand`);
  for (const operand of operands) {
    if (operand === `0x${"00".repeat(32)}`) {
      throw new HandleDerivationError(
        "an undefined handle (bytes32(0)) is not an operand. The SDK resolves it to the type's " +
          "public zero handle first, so pass `zeroHandle(type)` explicitly rather than zero.",
      );
    }
  }
  if (operands.every(isPublicHandle)) throw new AllPublicOperandsError(operands);
  if (!Number.isInteger(outputIndex) || outputIndex < 0 || outputIndex > 255) {
    throw new HandleDerivationError(`outputIndex must be a byte, received ${outputIndex}`);
  }

  const pre = keccak256(
    encodeAbiParameters(
      [
        { type: "uint8" },
        { type: "bytes32[]" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint8" },
      ],
      [NOX_OPERATOR[operator], operands as Hex[], noxCompute, 0n, outputIndex],
    ),
  );

  return packHandle(BigInt(pre) >> 56n, chainId, NOX_TEE_TYPE[resultType], ATTR_IS_UNIQUE_HANDLE);
}

/**
 * `HandleUtils.zeroHandle`: the public handle standing for a type's zero.
 *
 * Its pre-hash is zero and its attribute byte is clear, so it has no ACL and every gate
 * short-circuits on it. This is what the SDK substitutes for an unset storage slot.
 */
export function zeroHandle(resultType: EncryptedType, chainId: number): Handle {
  return packHandle(0n, chainId, NOX_TEE_TYPE[resultType], 0);
}

/**
 * `wrapAsPublicHandle`: the deterministic public handle for a plaintext value.
 *
 * This is what `Nox.toEuint16`, `toEuint256` and `toEbool` compile to, which is why an isolation
 * tag built from `toEuint256(domain)` is deterministic in the domain — and why it can never be the
 * ONLY operand of an operation whose handle must be predicted.
 */
export function publicHandleFor(
  value: bigint,
  resultType: EncryptedType,
  noxCompute: Address,
  chainId: number,
): Handle {
  const pre = keccak256(
    encodeAbiParameters(
      [
        { type: "uint8" },
        { type: "bytes32[]" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint8" },
      ],
      [
        NOX_OPERATOR.wrapAsPublicHandle,
        [`0x${value.toString(16).padStart(64, "0")}` as Hex],
        noxCompute,
        0n,
        0,
      ],
    ),
  );
  return packHandle(BigInt(pre) >> 56n, chainId, NOX_TEE_TYPE[resultType], 0);
}

/**
 * The handle `KyrveCurveBase._isolate` produces, given the operands it will use.
 *
 * `select(epochCondition, value, toEuint256(domain))`. Reproducing it off chain is what makes the
 * graph binding checkable: a verifier can say which handle a published result must be, before the
 * gateway has issued any proof for it.
 */
export function deriveIsolatedHandle(args: {
  readonly epochCondition: Handle;
  readonly value: Handle;
  readonly domain: Hex;
  readonly resultType: "euint16" | "euint256";
  readonly noxCompute: Address;
  readonly chainId: number;
}): Handle {
  const tagValue =
    args.resultType === "euint16" ? BigInt(args.domain) & 0xffffn : BigInt(args.domain);
  const tag = publicHandleFor(tagValue, args.resultType, args.noxCompute, args.chainId);
  return deriveHandle({
    operator: "select",
    operands: [args.epochCondition, args.value, tag],
    resultType: args.resultType,
    noxCompute: args.noxCompute,
    chainId: args.chainId,
  });
}

function packHandle(preShifted: bigint, chainId: number, teeType: number, attrs: number): Handle {
  const packed =
    preShifted |
    (BigInt(HANDLE_VERSION) << 248n) |
    (BigInt(chainId >>> 0) << 216n) |
    (BigInt(teeType) << 208n) |
    (BigInt(attrs) << 200n);
  return `0x${packed.toString(16).padStart(64, "0")}` as Handle;
}

/** One byte of a handle, by position, with the length checked rather than assumed. */
function byteAt(handle: Handle, index: number): number {
  const clean = handle.slice(2);
  if (clean.length !== 64) {
    throw new HandleDerivationError(`a handle is 32 bytes; received ${clean.length / 2}`);
  }
  const byte = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  if (Number.isNaN(byte)) {
    throw new HandleDerivationError(`byte ${index} of ${handle} is not hexadecimal`);
  }
  return byte;
}
