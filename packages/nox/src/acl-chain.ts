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

import type { PublicClient, WalletClient } from "viem";

import type { Address, Handle, Hex, NoxNetwork } from "./types.js";

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

/**
 * Grants another address permanent admin access to one handle, from the OWNER's own wallet.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS, AND WHY IT CANNOT BE DONE ANY OTHER WAY
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The Phase 2 mandate book, request book and vault each grant exactly two things per handle:
 * `allowThis` to themselves, and `allow(handle, owner)` to the owner. Neither reaches the Phase 3
 * curve engine, and all three contracts are deployed, verified and immutable — they cannot be
 * taught about a contract that did not exist when they were written.
 *
 * `INoxCompute.allow` is `external` and gated `onlyAllowed(handle)`, so the owner — and only the
 * owner — can extend access. That is why this is a wallet write and not a contract call: there is
 * no delegation path, and adding one would mean re-encrypting the mandate into the engine, which
 * nothing on chain could prove equals the mandate the book holds.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THE CALLER IS AGREEING TO — SAY THIS IN THE INTERFACE, IN THESE WORDS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *  - **It is permanent.** `sdk/Nox.sol` version 0.2.4 has no `removeAdmin`, no `removeViewer` and
 *    no un-publish. Only `disallowTransient` exists, and this is not transient.
 *  - **Admin is not read-only.** The recipient may compute on the handle, grant it onward, and call
 *    `allowPublicDecryption` on it. Kyrve's engine does none of those except for the five published
 *    results — but that is a property of reviewed code, not of the ACL, and must be described as
 *    such rather than as a guarantee the cryptography makes.
 *  - **It is per handle.** There is no batch entry point in `INoxCompute` 0.2.4, so a mandate is 35
 *    transactions. Replacing a mandate mints new handles and needs the grants again; the old ones
 *    stop authorising activity because `activeEpoch` moved, not because they were removed.
 */
export async function grantHandleAccess(
  walletClient: WalletClient,
  network: NoxNetwork,
  handle: Handle,
  recipient: Address,
  /**
   * An explicit nonce, for issuing many independent grants without waiting for each receipt.
   *
   * A mandate is 35 grants and their only ordering requirement is that they all land. On a public
   * network, waiting for each in turn is twenty minutes of block time for no benefit. The caller
   * still has to check every receipt — this makes the batch possible, not safe on its own.
   */
  options: { readonly nonce?: number } = {},
): Promise<Hex> {
  const account = walletClient.account;
  if (account === undefined) {
    throw new Error(
      "granting access is a write from the handle owner's own wallet — `INoxCompute.allow` is " +
        "gated on the caller already holding access — so the wallet client needs an account.",
    );
  }
  return walletClient.writeContract({
    address: network.noxCompute,
    abi: GRANT_ABI,
    functionName: "allow",
    args: [handle, recipient],
    account,
    chain: walletClient.chain ?? null,
    ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
  });
}

const GRANT_ABI = [
  {
    type: "function",
    name: "allow",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes32" }, { type: "address" }],
    outputs: [],
  },
] as const;
