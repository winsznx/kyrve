/**
 * Public decryption — deliberately hard to use without the handle binding.
 *
 * `validateDecryptionProof` is a pure EIP-712 signature check: no ACL, no nonce, no expiry, no
 * caller binding. A proof is replayable by anyone, in any contract, forever. So an API shaped as
 *
 *     validate(proof) -> boolean
 *
 * would be an API that invites the exact mistake that breaks Kyrve: treating "a valid proof
 * exists" as "this value belongs to this quote".
 *
 * Every entry point here therefore REQUIRES the expected handle, derived from the caller's own
 * sealed operation graph. There is no overload that omits it.
 */

import { encodeAbiParameters, type Hex, keccak256 } from "viem";

import { assertHandleMatchesGraph } from "./graph.js";
import type { Handle } from "./types.js";

export interface DecryptionProof {
  readonly handle: Handle;
  /** The decrypted value the gateway attests to. */
  readonly value: bigint;
  /** 65-byte gateway signature. */
  readonly signature: Hex;
}

export class DecryptionProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptionProofError";
  }
}

const SIGNATURE_BYTES = 65;

/**
 * Parses a raw proof blob into its parts, checking only SHAPE.
 *
 * Shape validity is not authenticity and is certainly not authorisation. The Day 0 smoke run
 * produced a 97-byte proof: a 65-byte signature plus a 32-byte result.
 */
export function parseProof(handle: Handle, raw: Hex): DecryptionProof {
  const bytes = (raw.length - 2) / 2;
  if (bytes < SIGNATURE_BYTES + 32) {
    throw new DecryptionProofError(
      `decryption proof is ${bytes} bytes; expected at least ${SIGNATURE_BYTES + 32} ` +
        "(65-byte signature plus a 32-byte result). A truncated proof is rejected on chain.",
    );
  }

  const valueHex = `0x${raw.slice(2, 2 + 64)}` as Hex;
  const signature = `0x${raw.slice(raw.length - SIGNATURE_BYTES * 2)}` as Hex;

  return { handle, value: BigInt(valueHex), signature };
}

export interface VerifiedDecryption {
  readonly handle: Handle;
  readonly value: bigint;
  readonly boundTo: Hex;
}

/**
 * The ONLY way this package will hand back a decrypted value.
 *
 * @param expectedHandle the handle derived from THIS request's sealed operation graph. Not
 *        optional, and not defaulted: supplying it is the whole point.
 */
export function acceptDecryption(
  proof: DecryptionProof,
  expectedHandle: Handle,
  graphRoot: Hex,
): VerifiedDecryption {
  // Throws HandleBindingError, naming both handles, if the proof is for anything else.
  assertHandleMatchesGraph(expectedHandle, proof.handle);

  if (proof.signature.length !== 2 + SIGNATURE_BYTES * 2) {
    throw new DecryptionProofError(
      `gateway signature is ${(proof.signature.length - 2) / 2} bytes, expected ${SIGNATURE_BYTES}`,
    );
  }

  return { handle: proof.handle, value: proof.value, boundTo: graphRoot };
}

/**
 * Calldata for on-chain verification.
 *
 * The expected handle is a required argument so the on-chain call cannot be constructed without
 * it either. `QuoteActivator` must check the binding on chain as well: an off-chain check alone
 * would be bypassable by anyone calling the contract directly.
 */
export function verificationCalldata(
  proof: DecryptionProof,
  expectedHandle: Handle,
): {
  readonly handle: Handle;
  readonly value: bigint;
  readonly signature: Hex;
  readonly commitment: Hex;
} {
  assertHandleMatchesGraph(expectedHandle, proof.handle);
  return {
    handle: proof.handle,
    value: proof.value,
    signature: proof.signature,
    commitment: keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }],
        [expectedHandle, proof.value],
      ),
    ),
  };
}

/**
 * Marks a handle publicly decryptable — the single public/private boundary crossing in an epoch.
 *
 * IRREVERSIBLE. There is no un-publish in Nox. Returns the disclosure record a UI must show
 * before signing, because after this the value is public forever.
 */
export interface PublicationIntent {
  readonly handle: Handle;
  readonly reversible: false;
  readonly warning: string;
}

export function describePublication(handle: Handle): PublicationIntent {
  return {
    handle,
    reversible: false,
    warning:
      "This marks the value publicly decryptable. allowPublicDecryption is IRREVERSIBLE — Nox " +
      "exposes no way to un-publish. Everything else in this epoch stays encrypted: per-provider " +
      "capacity, per-leaf capacity, provider counts, rejected leaves and every mandate.",
  };
}
