/**
 * The off-chain handle derivation.
 *
 * The structural properties are checked here. The property that actually matters — that this
 * reproduces what a live NoxCompute returns — cannot be checked without a gateway, so it is checked
 * in `confidential/test/82-handle-derivation.ts` against handles a real stack produced, and
 * `verify:phase3` refuses to pass if that file did not run. A derivation that is merely
 * self-consistent would make the graph binding decorative.
 */

import { describe, expect, it } from "vitest";

import {
  AllPublicOperandsError,
  ATTR_IS_UNIQUE_HANDLE,
  chainIdOf,
  deriveHandle,
  deriveIsolatedHandle,
  HandleDerivationError,
  isPublicHandle,
  NOX_OPERATOR,
  NOX_TEE_TYPE,
  publicHandleFor,
  teeTypeOf,
  zeroHandle,
} from "../src/index.js";

const NOX = "0x75C6AF4430cc474b1bb9b8540b7E46D6f8e1C685" as const;
const CHAIN = 31337;

/** A stand-in confidential handle: attribute bit set, correct chain and type bytes. */
function confidential(seed: number, teeType = NOX_TEE_TYPE.euint256): `0x${string}` {
  const packed =
    (BigInt(seed) << 8n) |
    (BigInt(CHAIN) << 216n) |
    (BigInt(teeType) << 208n) |
    (BigInt(ATTR_IS_UNIQUE_HANDLE) << 200n);
  return `0x${packed.toString(16).padStart(64, "0")}`;
}

describe("handle metadata is read from the bytes the spec defines", () => {
  it("byte 6 bit 0 distinguishes confidential handles from public ones", () => {
    expect(isPublicHandle(confidential(1))).toBe(false);
    expect(isPublicHandle(zeroHandle("euint256", CHAIN))).toBe(true);
    expect(isPublicHandle(publicHandleFor(42n, "euint256", NOX, CHAIN))).toBe(true);
  });

  it("byte 5 carries the TEE type, and Uint256 is 35 rather than the guessable 32", () => {
    expect(NOX_TEE_TYPE.euint256).toBe(35);
    expect(NOX_TEE_TYPE.euint16).toBe(5);
    expect(NOX_TEE_TYPE.ebool).toBe(0);
    expect(teeTypeOf(zeroHandle("euint16", CHAIN))).toBe(5);
    expect(teeTypeOf(zeroHandle("eint256", CHAIN))).toBe(67);
  });

  it("bytes 1..4 carry the chain id, so one chain's handle is refused on another", () => {
    expect(chainIdOf(zeroHandle("euint256", CHAIN))).toBe(CHAIN);
    expect(chainIdOf(zeroHandle("euint256", 11_155_111))).toBe(11_155_111);
    expect(zeroHandle("euint256", CHAIN)).not.toBe(zeroHandle("euint256", 11_155_111));
  });

  it("the operator table matches the enum's declaration order", () => {
    expect(NOX_OPERATOR.wrapAsPublicHandle).toBe(0);
    expect(NOX_OPERATOR.add).toBe(1);
    expect(NOX_OPERATOR.select).toBe(9);
    expect(NOX_OPERATOR.ge).toBe(15);
  });
});

describe("derivation is deterministic in exactly the inputs NoxCompute hashes", () => {
  const base = {
    operator: "add",
    operands: [confidential(1), confidential(2)],
    resultType: "euint256",
    noxCompute: NOX,
    chainId: CHAIN,
  } as const;

  it("the same operation over the same operands is the same handle", () => {
    expect(deriveHandle(base)).toBe(deriveHandle({ ...base }));
  });

  it("operand ORDER is part of the identity", () => {
    expect(deriveHandle(base)).not.toBe(
      deriveHandle({ ...base, operands: [confidential(2), confidential(1)] }),
    );
  });

  it("the operator is part of the identity", () => {
    expect(deriveHandle(base)).not.toBe(deriveHandle({ ...base, operator: "sub" }));
  });

  it("the output index separates a safe operation's result from its success flag", () => {
    expect(deriveHandle({ ...base, operator: "safeSub", outputIndex: 0 })).not.toBe(
      deriveHandle({ ...base, operator: "safeSub", outputIndex: 1 }),
    );
  });

  it("the NoxCompute address is part of the identity, so two deployments never collide", () => {
    expect(deriveHandle(base)).not.toBe(
      deriveHandle({ ...base, noxCompute: "0x0000000000000000000000000000000000000001" }),
    );
  });

  it("every derived handle is tagged confidential, on the right chain, with the right type", () => {
    const handle = deriveHandle(base);
    expect(isPublicHandle(handle)).toBe(false);
    expect(chainIdOf(handle)).toBe(CHAIN);
    expect(teeTypeOf(handle)).toBe(NOX_TEE_TYPE.euint256);
  });
});

describe("it refuses the cases it genuinely cannot compute", () => {
  it("refuses an all-public operand set rather than guessing the storage counter", () => {
    // This is the case `KyrveCurveBase._requireConfidential` blocks from the contract side. Both
    // halves exist because a wrong answer here would be silent and a missing answer is not.
    expect(() =>
      deriveHandle({
        operator: "add",
        operands: [zeroHandle("euint256", CHAIN), publicHandleFor(1n, "euint256", NOX, CHAIN)],
        resultType: "euint256",
        noxCompute: NOX,
        chainId: CHAIN,
      }),
    ).toThrow(AllPublicOperandsError);
  });

  it("accepts the mixed case, because one confidential operand is enough for seed 0", () => {
    expect(() =>
      deriveHandle({
        operator: "select",
        operands: [
          confidential(9, NOX_TEE_TYPE.ebool),
          confidential(1),
          zeroHandle("euint256", CHAIN),
        ],
        resultType: "euint256",
        noxCompute: NOX,
        chainId: CHAIN,
      }),
    ).not.toThrow();
  });

  it("refuses the undefined handle as an operand, because the SDK resolves it first", () => {
    expect(() =>
      deriveHandle({
        operator: "add",
        operands: [`0x${"00".repeat(32)}`, confidential(1)],
        resultType: "euint256",
        noxCompute: NOX,
        chainId: CHAIN,
      }),
    ).toThrow(HandleDerivationError);
  });

  it("refuses an empty operand list and an out-of-range output index", () => {
    expect(() =>
      deriveHandle({
        operator: "add",
        operands: [],
        resultType: "euint256",
        noxCompute: NOX,
        chainId: CHAIN,
      }),
    ).toThrow(/at least one operand/);
    expect(() =>
      deriveHandle({
        ...{
          operator: "add",
          operands: [confidential(1), confidential(2)],
          resultType: "euint256",
          noxCompute: NOX,
          chainId: CHAIN,
        },
        outputIndex: 256,
      }),
    ).toThrow(/outputIndex must be a byte/);
  });
});

describe("isolation is what makes two equal values two handles", () => {
  const epochCondition = confidential(7, NOX_TEE_TYPE.ebool);
  const value = confidential(11);
  const domainA = `0x${"aa".repeat(32)}` as const;
  const domainB = `0x${"bb".repeat(32)}` as const;

  it("the same value under two domains produces two handles", () => {
    const a = deriveIsolatedHandle({
      epochCondition,
      value,
      domain: domainA,
      resultType: "euint256",
      noxCompute: NOX,
      chainId: CHAIN,
    });
    const b = deriveIsolatedHandle({
      epochCondition,
      value,
      domain: domainB,
      resultType: "euint256",
      noxCompute: NOX,
      chainId: CHAIN,
    });
    expect(a).not.toBe(b);
  });

  it("the same value in two epochs produces two handles, even under the same domain", () => {
    const a = deriveIsolatedHandle({
      epochCondition,
      value,
      domain: domainA,
      resultType: "euint256",
      noxCompute: NOX,
      chainId: CHAIN,
    });
    const b = deriveIsolatedHandle({
      epochCondition: confidential(8, NOX_TEE_TYPE.ebool),
      value,
      domain: domainA,
      resultType: "euint256",
      noxCompute: NOX,
      chainId: CHAIN,
    });
    expect(a).not.toBe(b);
  });

  it("the euint16 form truncates the tag, which is exactly why the epoch condition carries the epoch", () => {
    // Two domains agreeing in their low 16 bits collapse to one tag. The epoch condition is what
    // still separates them, and this test is the reason that design exists rather than the simpler
    // `select(eq(v,v), v, tag)`.
    const low = `0x${"00".repeat(30)}dead` as const;
    const other = `0x${"11".repeat(30)}dead` as const;
    const a = deriveIsolatedHandle({
      epochCondition,
      value,
      domain: low,
      resultType: "euint16",
      noxCompute: NOX,
      chainId: CHAIN,
    });
    const b = deriveIsolatedHandle({
      epochCondition,
      value,
      domain: other,
      resultType: "euint16",
      noxCompute: NOX,
      chainId: CHAIN,
    });
    expect(a).toBe(b);

    const differentEpoch = deriveIsolatedHandle({
      epochCondition: confidential(99, NOX_TEE_TYPE.ebool),
      value,
      domain: low,
      resultType: "euint16",
      noxCompute: NOX,
      chainId: CHAIN,
    });
    expect(differentEpoch).not.toBe(a);
  });

  it("isolated handles are confidential, so they can be granted and published", () => {
    const handle = deriveIsolatedHandle({
      epochCondition,
      value,
      domain: domainA,
      resultType: "euint256",
      noxCompute: NOX,
      chainId: CHAIN,
    });
    expect(isPublicHandle(handle)).toBe(false);
  });
});
