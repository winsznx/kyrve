/**
 * ACL state read from the chain, never from an indexer.
 *
 * `HandleClient.viewACL` answers the same questions from a subgraph. Kyrve does not use it, for two
 * reasons that both matter in production: a local Nox stack has no subgraph at all, and on testnet
 * an indexer that is behind or down would turn "who may decrypt this" — a security answer — into an
 * availability question. `NoxCompute` holds the authoritative mapping and answers with a `view`
 * call, so that is what Kyrve asks.
 *
 * Everything here is public information. Knowing that an address holds a grant reveals nothing
 * about the value behind the handle.
 */

import type { PublicClient } from "viem";

import type { Address, Handle, NoxNetwork } from "./types.js";

const ACL_ABI = [
  {
    type: "function",
    name: "isAllowed",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "isViewer",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "isPubliclyDecryptable",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export interface HandleAcl {
  readonly handle: Handle;
  readonly account: Address;
  /** Admin access: may compute on the handle and may grant it onward. PERMANENT once given. */
  readonly isAdmin: boolean;
  /** May decrypt. True for admins, viewers, and everyone once the handle is public. */
  readonly canDecrypt: boolean;
  /** Marked publicly decryptable. IRREVERSIBLE — Nox exposes no un-publish. */
  readonly isPublic: boolean;
}

/** Reads the authoritative ACL for one handle and one account. */
export async function readAcl(
  client: PublicClient,
  network: NoxNetwork,
  handle: Handle,
  account: Address,
): Promise<HandleAcl> {
  const [isAdmin, canDecrypt, isPublic] = await Promise.all([
    client.readContract({
      address: network.noxCompute,
      abi: ACL_ABI,
      functionName: "isAllowed",
      args: [handle, account],
    }),
    client.readContract({
      address: network.noxCompute,
      abi: ACL_ABI,
      functionName: "isViewer",
      args: [handle, account],
    }),
    client.readContract({
      address: network.noxCompute,
      abi: ACL_ABI,
      functionName: "isPubliclyDecryptable",
      args: [handle],
    }),
  ]);

  return { handle, account, isAdmin, canDecrypt, isPublic };
}

/**
 * The four confidential states of `design.md`, derived from real ACL state.
 *
 * A user interface must show exactly one of these per value, and must never invent a fifth. In
 * particular there is no "revoked" state, because no grant here can be withdrawn.
 */
export type ConfidentialState =
  | "encrypted-and-unavailable"
  | "available-to-decrypt"
  | "intentionally-public";

export function confidentialStateOf(acl: HandleAcl): ConfidentialState {
  if (acl.isPublic) return "intentionally-public";
  if (acl.canDecrypt) return "available-to-decrypt";
  return "encrypted-and-unavailable";
}

/**
 * The wording permitted for each state.
 *
 * Kept next to the state machine rather than in the interface layer so a copy change cannot quietly
 * reintroduce a claim the cryptography does not support.
 */
export const CONFIDENTIAL_STATE_COPY: Record<
  ConfidentialState,
  { readonly label: string; readonly explanation: string }
> = {
  "encrypted-and-unavailable": {
    label: "Encrypted",
    explanation:
      "This value is encrypted and this wallet holds no grant on it. Nothing about it — not its " +
      "size, not its sign — is available here.",
  },
  "available-to-decrypt": {
    label: "Available to decrypt",
    explanation:
      "This wallet is authorised to decrypt this value. Decryption happens in this browser; no " +
      "Kyrve server ever receives the result.",
  },
  "intentionally-public": {
    label: "Intentionally public",
    explanation:
      "This value was deliberately published and is readable by anyone, permanently. Nox has no " +
      "un-publish.",
  },
};
