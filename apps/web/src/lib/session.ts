/**
 * The wallet session, and the privacy lock.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHERE DECRYPTED VALUES LIVE, AND FOR HOW LONG
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * They live in this module's in-memory map and nowhere else. Not in `localStorage`, not in
 * `sessionStorage`, not in IndexedDB, not in a URL, not in a fetch body, not in a console line.
 * `scripts/verify/privacy-scan.ts` fails the build if any of those appears on the decryption path,
 * and it is proven to fail by planting one.
 *
 * `lock()` clears the map immediately, as `.claude/rules/frontend.md` requires. It does not mark
 * values stale or schedule a cleanup — it deletes them, so a screenshot taken a moment later cannot
 * contain a private balance.
 *
 * WHAT LOCKING DOES NOT DO, and what the interface must therefore never claim: it does not revoke
 * anything. The wallet still holds every ACL grant it held before, and Nox has no `removeAdmin`.
 * Locking is a local-display action.
 */

import { createHandleClient, type KyrveHandleClient, type NoxNetwork } from "@kyrve/nox";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat, sepolia } from "viem/chains";

export interface Session {
  readonly account: Address;
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
  readonly nox: KyrveHandleClient;
  readonly network: NoxNetwork;
}

interface InjectedProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: InjectedProvider;
    /**
     * A local-only development key, used when no wallet is injected.
     *
     * Present so the local flow can run headless without a browser extension. It is read from the
     * page, never from a Kyrve server, and the terminal displays which mode it is in so nobody can
     * mistake a development account for their own wallet.
     */
    __KYRVE_LOCAL_KEY__?: `0x${string}`;
    __KYRVE_RPC_URL__?: string;
    /** The local Nox handle gateway, whose Docker host port is assigned at stack startup. */
    __KYRVE_NOX_GATEWAY__?: string;
  }
}

export async function openSession(network: NoxNetwork, rpcUrl: string): Promise<Session> {
  const chain = network.chainId === 11155111 ? sepolia : hardhat;
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
    cacheTime: 0,
  }) as PublicClient;

  const localKey = window.__KYRVE_LOCAL_KEY__;
  let walletClient: WalletClient;
  let account: Address;

  if (localKey !== undefined) {
    const local = privateKeyToAccount(localKey);
    account = local.address;
    walletClient = createWalletClient({ account: local, chain, transport: http(rpcUrl) });
  } else if (window.ethereum !== undefined) {
    const accounts = (await window.ethereum.request({
      method: "eth_requestAccounts",
    })) as Address[];
    const first = accounts[0];
    if (first === undefined) {
      throw new Error("the wallet returned no account, so nothing can be bound to an owner");
    }
    account = first;
    walletClient = createWalletClient({ account, chain, transport: custom(window.ethereum) });
  } else {
    throw new Error(
      "no wallet is available. Kyrve binds every encrypted input to the wallet that submits it, " +
        "so there is no read-only mode that could stand in for one.",
    );
  }

  const nox = await createHandleClient(walletClient, network);
  return { account, publicClient, walletClient, nox, network };
}

/** Handle -> decrypted value, held only for as long as the session is unlocked. */
const revealed = new Map<string, bigint>();
const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function remember(handle: string, value: bigint): void {
  revealed.set(handle.toLowerCase(), value);
  notify();
}

export function recall(handle: string | undefined): bigint | undefined {
  if (handle === undefined) return undefined;
  return revealed.get(handle.toLowerCase());
}

export function revealedCount(): number {
  return revealed.size;
}

/** Clears every decrypted value from memory. Immediate, not deferred. */
export function lock(): void {
  revealed.clear();
  notify();
}
