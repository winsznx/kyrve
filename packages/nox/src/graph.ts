/**
 * Operation-graph binding — consensus-critical, not evidentiary (PRD v1.1 A-11).
 *
 * THE PROBLEM. `validateDecryptionProof` is a pure EIP-712 signature check: no ACL check, no
 * nonce, no expiry, no caller binding. A valid proof establishes only
 *
 *     "the gateway attests that handle H decrypts to V"
 *
 * and never
 *
 *     "V is this quote's aggregate".
 *
 * Once issued, a proof is replayable by anyone, in any contract, forever. So "a valid proof
 * exists" must never be treated as authorisation to activate a quote.
 *
 * THE FIX. Handles are derived deterministically from the operation graph, so Kyrve can compute,
 * before any proof arrives, exactly which handle THIS request's aggregate must be. `QuoteActivator`
 * then checks that the proven handle is that handle. This module produces those expected handles
 * and the graph root that commits to them.
 *
 * Every identifier here is DETERMINISTIC. Cloudflare Workflow step names are memoisation keys, so
 * a stage or chunk id containing a timestamp or random value would silently break resumption
 * (A-20).
 */

import { concatHex, encodeAbiParameters, keccak256, stringToHex, toHex } from "viem";

import type { EncryptedType, Handle, Hex } from "./types.js";

/** The epoch stages, in execution order (A-10). */
export const EPOCH_STAGES = [
  "seedProvider",
  "cacheProvider",
  "accumulateLeafChunk",
  "finalizeLeaf",
  "reduceWinnerChunk",
  "publishWinner",
  "allocate",
] as const;

export type EpochStage = (typeof EPOCH_STAGES)[number];

export interface OperationDescriptor {
  /** The Nox primitive invoked, e.g. "ge", "select", "add", "safeMul". */
  readonly op: string;
  readonly resultType: EncryptedType;
  /** Input handles, in argument order. Order is part of the identity. */
  readonly inputs: readonly Handle[];
  /** Public scalars folded into the operation, in argument order. */
  readonly publicInputs?: readonly bigint[];
}

export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphError";
  }
}

/** Commitment to a client-supplied input handle, binding it to its owner and application. */
export function inputCommitment(handle: Handle, owner: Hex, app: Hex, chainId: number): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
      [handle, owner, app, BigInt(chainId)],
    ),
  );
}

/**
 * Deterministic identifier for one stage invocation within an epoch.
 *
 * Used directly as a Cloudflare Workflow step name, which is why it must never contain a
 * timestamp, a random value or an address that could be re-resolved differently.
 */
export function stageId(requestId: Hex, stage: EpochStage, chunkIndex: number): string {
  assertIndex(chunkIndex, "chunkIndex");
  return `${requestId}:${stage}:${chunkIndex}`;
}

/** Deterministic identifier for one (leaf, provider-chunk) accumulation unit. */
export function chunkId(
  requestId: Hex,
  leafIndex: number,
  providerStart: number,
  providerCount: number,
): string {
  assertIndex(leafIndex, "leafIndex");
  assertIndex(providerStart, "providerStart");
  if (!Number.isInteger(providerCount) || providerCount <= 0) {
    throw new GraphError(`providerCount must be a positive integer, received ${providerCount}`);
  }
  return `${requestId}:leaf${leafIndex}:p${providerStart}+${providerCount}`;
}

/**
 * Binds a request to the universe it was quoted against.
 *
 * The rate grid is public and hashed; a request bound to grid A can never be activated with a
 * value computed against grid B.
 */
export function requestBinding(requestId: Hex, universeHash: Hex, epoch: number): Hex {
  assertIndex(epoch, "epoch");
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
      [requestId, universeHash, BigInt(epoch)],
    ),
  );
}

/** Commits to the published rate grid for one market. */
export function universeBinding(marketId: Hex, gridHash: Hex, tickSpacing: number): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
      [marketId, gridHash, BigInt(tickSpacing)],
    ),
  );
}

/** Canonical encoding of one operation. Field order is part of the identity. */
export function encodeOperation(op: OperationDescriptor): Hex {
  const publicInputs = op.publicInputs ?? [];
  return keccak256(
    concatHex([
      keccak256(stringToHex(op.op)),
      keccak256(stringToHex(op.resultType)),
      keccak256(concatHex(op.inputs.length > 0 ? op.inputs : ["0x"])),
      keccak256(
        publicInputs.length > 0 ? concatHex(publicInputs.map((v) => toHex(v, { size: 32 }))) : "0x",
      ),
    ]),
  );
}

/**
 * The root committing to an entire sealed operation graph, in order.
 *
 * A sequential fold rather than a Merkle tree, deliberately: the graph is executed in a fixed
 * order across a multi-transaction epoch, so order IS the structure, and a fold makes an
 * out-of-order or omitted operation change the root.
 */
export function graphRoot(binding: Hex, operations: readonly OperationDescriptor[]): Hex {
  if (operations.length === 0) {
    throw new GraphError("an empty operation graph cannot be committed to");
  }
  let acc = binding;
  for (const op of operations) {
    acc = keccak256(concatHex([acc, encodeOperation(op)]));
  }
  return acc;
}

/**
 * A commitment to a stage output's POSITION in the graph. NOT a Nox handle.
 *
 * ⚠ THIS WAS WRITTEN AS "the handle this request's published aggregate MUST be" AND IT IS NOT ONE.
 *
 * NoxCompute derives a handle as
 *
 *     keccak256(abi.encode(operator, operands, noxCompute, uniqueSeed, outputIndex))
 *
 * shifted and tagged with a version, chain id, TEE type and attribute byte
 * (`modules/Compute.sol::_generateHandle`). The fold below shares none of those inputs, so it can
 * never equal a real handle — any check comparing a live decryption proof's handle against it would
 * fail for every honest quote, and the obvious "fix" would be to weaken the check until it passed.
 * Phase 1 could not catch this because it had no live gateway to compare against.
 *
 * **Use {deriveHandle} and {deriveIsolatedHandle} from `handle-derivation.ts` for handle
 * prediction.** This function is retained under an honest name because the ordered position of a
 * stage output is still worth committing to inside {graphRoot}. Recorded as delta R-4.
 */
export function stageOutputCommitment(root: Hex, stage: EpochStage, outputIndex: number): Handle {
  assertIndex(outputIndex, "outputIndex");
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "string" }, { type: "uint256" }],
      [root, stage, BigInt(outputIndex)],
    ),
  );
}

export class HandleBindingError extends Error {
  constructor(
    readonly expected: Handle,
    readonly actual: Handle,
  ) {
    super(
      `decryption proof is for handle ${actual}, but this request's sealed operation graph derives ` +
        `${expected}. A valid proof only attests that the gateway decrypted SOME handle to SOME ` +
        "value; it says nothing about which quote that value belongs to, and it is replayable by " +
        "anyone forever (PRD v1.1 A-11).",
    );
    this.name = "HandleBindingError";
  }
}

/** The check that turns a replayable proof into an authorisation. Never skip it. */
export function assertHandleMatchesGraph(expected: Handle, actual: Handle): void {
  if (expected.toLowerCase() !== actual.toLowerCase()) {
    throw new HandleBindingError(expected, actual);
  }
}

function assertIndex(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new GraphError(`${name} must be a non-negative integer, received ${value}`);
  }
}
