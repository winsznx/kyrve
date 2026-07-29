/**
 * The authorised-client half of `@kyrve/nox`.
 *
 * WHERE DECRYPTION IS ALLOWED TO HAPPEN. Here, and only here, in a process the user controls —
 * their browser, or a local script they ran themselves. No Kyrve server, worker, indexer, database,
 * log line, metric label or analytics event ever receives a decrypted value. Every function in this
 * file returns the plaintext to its caller and writes it nowhere.
 *
 * WHY THIS WRAPS `@iexec-nox/handle` RATHER THAN RE-EXPORTING IT.
 *
 *  - **Readiness.** `decrypt` and `publicDecrypt` fail with `NotYetComputedHandleError` while the
 *    off-chain runner is still working, and the SDK's own retry gives up after roughly 7 seconds.
 *    Kyrve polls the gateway with real backoff first (`waitForHandle`), because testnet latency is
 *    UNVERIFIED (AS-1) and a 7-second give-up is not a policy this product can adopt.
 *  - **Type discipline.** Nox supports five encrypted types and no others. `assertFitsType` bounds
 *    every plaintext *before* it is encrypted, so a value that cannot fit `euint16` fails locally
 *    with an explanation instead of silently wrapping inside the TEE.
 *  - **One import site.** Nox is version-skewed across the SDK, the Hardhat plugin, the published
 *    contracts and both testnets. `scripts/verify/import-boundary.ts` fails the build if anything
 *    outside this package imports `@iexec-nox/*` (PRD v1.1 A-15).
 *
 * WHAT THIS DELIBERATELY DOES NOT WRAP. `HandleClient.viewACL` reads a subgraph, which does not
 * exist on a local stack and is a separate availability dependency on testnet. Kyrve reads ACL
 * state from the chain instead — see {readAcl} — so an authorisation answer never depends on an
 * indexer being up.
 */

import { createViemHandleClient } from "@iexec-nox/handle";
import { publicActions, type WalletClient } from "viem";

import { readAcl } from "./acl-chain.js";
import {
  DEFAULT_POLL_POLICY,
  type HandleStatus,
  type WaitOptions,
  waitForHandle,
} from "./runtime.js";
import {
  type Address,
  assertFitsType,
  type EncryptedType,
  type Handle,
  type Hex,
  type NoxNetwork,
} from "./types.js";

/** The Solidity type names the gateway accepts, one per Nox encrypted type. */
const SOLIDITY_TYPE: Record<EncryptedType, "bool" | "uint16" | "uint256" | "int16" | "int256"> = {
  ebool: "bool",
  euint16: "uint16",
  euint256: "uint256",
  eint16: "int16",
  eint256: "int256",
};

/** One encrypted input, ready to be passed to a contract. Never contains the plaintext. */
export interface EncryptedInput {
  readonly handle: Handle;
  /** The 137-byte gateway proof: 20-byte owner, 20-byte app, 32-byte createdAt, 65-byte signature. */
  readonly proof: Hex;
  readonly type: EncryptedType;
}

export class NoxClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoxClientError";
  }
}

/**
 * Raised when a wallet asks for a value it holds no grant on.
 *
 * This is the expected, correct outcome of an unauthorised read — not a fault. It is a distinct
 * error type so a user interface can say "you are not authorised to decrypt this" rather than
 * showing a raw gateway string, and so a test can assert refusal rather than merely assert failure.
 */
export class NotAuthorisedToDecryptError extends Error {
  constructor(
    readonly handle: Handle,
    readonly wallet: Address,
  ) {
    super(
      `${wallet} holds no grant on handle ${handle}, so the gateway refuses to decrypt it. ` +
        "Nox checks authorisation on chain before it releases any key material; nothing about the " +
        "value leaks from the refusal.",
    );
    this.name = "NotAuthorisedToDecryptError";
  }
}

export interface KyrveHandleClient {
  readonly network: NoxNetwork;
  readonly account: Address;

  /**
   * Encrypts one plaintext for one application contract.
   *
   * DIRECT-CALLER RULE. The proof binds owner, application contract, chain id and a 3600 second
   * expiry. The wallet that encrypts must be the direct caller of `applicationContract`. Never
   * route the result through a relayer, paymaster, Safe module, batch router or server signer:
   * Kyrve's contracts refuse a contract caller outright.
   */
  encrypt(
    value: bigint,
    type: EncryptedType,
    applicationContract: Address,
  ): Promise<EncryptedInput>;

  /** Encrypts many plaintexts for the same contract, preserving order. */
  encryptAll(
    values: readonly { value: bigint; type: EncryptedType }[],
    applicationContract: Address,
  ): Promise<EncryptedInput[]>;

  /**
   * Decrypts a value this wallet is authorised to read.
   *
   * Waits for the off-chain runner first, then asks the gateway. Throws
   * {@link NotAuthorisedToDecryptError} when the wallet holds no grant — which is the whole point
   * of the confidentiality model, and is asserted as a passing outcome in the suite.
   */
  decrypt(handle: Handle, options?: WaitOptions): Promise<bigint>;

  /** Waits for a handle to become computable without decrypting it. */
  waitReady(handle: Handle, options?: WaitOptions): Promise<HandleStatus>;

  /**
   * Reads a handle that was deliberately published, and returns the gateway's proof with it.
   *
   * THE PROOF IS THE POINT, AND IT IS REPLAYABLE. `validateDecryptionProof` is a pure EIP-712
   * signature check — no ACL, no nonce, no expiry, no caller binding — so this proof attests that
   * the gateway decrypted SOME handle to SOME value and nothing more. Anyone may replay it, in any
   * contract, forever. It becomes a statement about a quote only once `CurveGraphRegistry` has
   * confirmed the handle is the one this epoch's sealed graph committed to for that role.
   *
   * Works for anyone: publication is `allowPublicDecryption`, which is IRREVERSIBLE.
   */
  publicDecrypt(
    handle: Handle,
    options?: WaitOptions,
  ): Promise<{ value: bigint; decryptionProof: Hex }>;
}

/**
 * Builds a Kyrve handle client bound to one wallet.
 *
 * @param walletClient a viem wallet client with an account. In a browser this is the injected
 *        wallet; in a script it is a local account. Either way the private key never leaves the
 *        caller's process — this package neither reads nor stores it.
 */
export async function createHandleClient(
  walletClient: WalletClient,
  network: NoxNetwork,
): Promise<KyrveHandleClient> {
  const account = walletClient.account?.address;
  if (account === undefined) {
    throw new NoxClientError(
      "the wallet client has no account. Encryption binds the proof to an owner address, so an " +
        "account is required before anything can be encrypted.",
    );
  }

  const sdk = await createViemHandleClient(bindToAccount(walletClient, account as Address), {
    smartContractAddress: network.noxCompute,
    gatewayUrl: assertHttpUrl(network.gatewayUrl, "gatewayUrl"),
    // The SDK validates this field even on paths that never query it. A local stack has no
    // subgraph at all, so Kyrve supplies a placeholder and reads ACL state from the chain instead.
    subgraphUrl: assertHttpUrl(
      network.subgraphUrl ?? "https://example.invalid/subgraphs/id/none",
      "subgraphUrl",
    ),
  });

  async function encrypt(
    value: bigint,
    type: EncryptedType,
    applicationContract: Address,
  ): Promise<EncryptedInput> {
    // Bound the plaintext locally, before it is sent anywhere. Nox would wrap silently.
    assertFitsType(value, type);

    if (type === "ebool") {
      const result = await sdk.encryptInput(value !== 0n, "bool", applicationContract);
      return { handle: result.handle as Handle, proof: result.handleProof as Hex, type };
    }

    const result = await sdk.encryptInput(value, SOLIDITY_TYPE[type], applicationContract);
    return { handle: result.handle as Handle, proof: result.handleProof as Hex, type };
  }

  return {
    network,
    account: account as Address,
    encrypt,

    async encryptAll(values, applicationContract) {
      // Sequential on purpose. Each call mints a gateway secret; issuing dozens concurrently is
      // how a local stack starts dropping them, and ordering is part of the submission contract.
      const out: EncryptedInput[] = [];
      for (const entry of values) {
        out.push(await encrypt(entry.value, entry.type, applicationContract));
      }
      return out;
    },

    async waitReady(handle, options) {
      return waitForHandle(network, handle, options);
    },

    async publicDecrypt(handle, options) {
      // Readiness first, with real backoff. The SDK's own retry inside `publicDecrypt` gives up
      // after three attempts at 1s/2s/4s, which is not a policy a keeper can adopt when testnet
      // latency is UNVERIFIED (AS-1).
      await waitForHandle(network, handle, options);
      const result = await sdk.publicDecrypt(handle);
      const { value, decryptionProof } = result;
      if (typeof value === "bigint") return { value, decryptionProof: decryptionProof as Hex };
      if (typeof value === "boolean") {
        return { value: value ? 1n : 0n, decryptionProof: decryptionProof as Hex };
      }
      throw new NoxClientError(
        `the gateway returned a ${typeof value} for published handle ${handle}; Kyrve only ` +
          "publishes numeric and boolean values.",
      );
    },

    /**
     * Decrypts, tolerating the gateway's authorisation view lagging the chain.
     *
     * MEASURED ON SEPOLIA, not anticipated. `NoxCompute.isAllowed(handle, owner)` returned true
     * while the hosted gateway answered `403 access_denied: not a viewer` for the same handle and
     * the same account. The gateway authorises from its own indexed view of ACL state, which is
     * eventually consistent with the chain, and neither the SDK nor the documentation says so.
     *
     * The rule below, and why it is safe: **the chain is authoritative.** If the chain agrees the
     * account holds no grant, the refusal is final and correct — that is the confidentiality model
     * working, and every unauthorised-read test depends on it failing fast rather than hanging. If
     * the chain says the account IS allowed, a refusal can only be lag, so it is retried with
     * backoff until the caller's own timeout. Recorded as delta R-9.
     */
    async decrypt(handle, options) {
      await waitForHandle(network, handle, options);

      const policy = { ...DEFAULT_POLL_POLICY, ...options?.policy };
      const reader = walletClient.extend(publicActions);
      const deadline = Date.now() + policy.timeoutMs;
      let delay = policy.initialDelayMs;

      for (;;) {
        try {
          const { value } = await sdk.decrypt(handle);
          if (typeof value === "bigint") return value;
          if (typeof value === "boolean") return value ? 1n : 0n;
          throw new NoxClientError(
            `the gateway returned a ${typeof value} for handle ${handle}; Kyrve only stores ` +
              "numeric and boolean encrypted values.",
          );
        } catch (error) {
          if (!isAuthorisationRefusal(error)) throw error;

          const acl = await readAcl(reader as never, network, handle, account as Address);
          if (!acl.canDecrypt) throw new NotAuthorisedToDecryptError(handle, account as Address);

          if (Date.now() >= deadline) {
            throw new NoxClientError(
              `the chain says ${account} may decrypt ${handle}, but the gateway still refuses ` +
                `after ${policy.timeoutMs} ms. Its authorisation view is indexed and eventually ` +
                "consistent with the chain, so this is lag rather than a permission problem — the " +
                "timeout is a Kyrve policy choice, not a limit of the protocol.",
            );
          }
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay = Math.min(delay * policy.multiplier, policy.maxDelayMs);
        }
      }
    },
  };
}

/**
 * Distinguishes "you may not read this" from "something broke".
 *
 * The SDK signals the refusal with a plain `Error` whose message names the handle and the
 * unauthorised user, so string matching is the only option available. It is narrow deliberately: a
 * transport failure must not be reported to a user as an authorisation refusal, because that would
 * teach them the wrong thing about who can see their data.
 */
/**
 * Forces the SDK to use the account this client was built for.
 *
 * THE DEFECT THIS WORKS AROUND, verified against `@iexec-nox/handle@0.1.0-beta.13`
 * (`services/blockchain/ViemBlockchainService.ts`, `WalletClientAdapter.getAddress`) and recorded
 * as delta Q-4:
 *
 *     const addresses = await this.walletClient.getAddresses();
 *     const address = addresses[0];
 *
 * `walletClient.account` is ignored. `getAddresses()` is an `eth_accounts` round trip, so against
 * any node that exposes more than one account — every local development node, and any wallet with
 * several accounts unlocked — EVERY client resolves to account zero regardless of which account it
 * was constructed with.
 *
 * The consequences are not cosmetic. Input proofs get minted for the wrong owner, so the
 * submission reverts `Owner mismatch` inside NoxCompute; and decryption authorises as the wrong
 * account, so a holder is refused their own balance while account zero is offered it. Both were
 * observed against the real local stack before this wrapper existed.
 *
 * The proxy overrides exactly one method and forwards everything else untouched, so the SDK's own
 * `signTypedData` path — which does prefer `walletClient.account` — is unaffected.
 */
function bindToAccount(walletClient: WalletClient, account: Address): WalletClient {
  return new Proxy(walletClient, {
    get(target, property, receiver) {
      if (property === "getAddresses") {
        return async (): Promise<Address[]> => [account];
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

/** The SDK types its URLs as literal-prefixed strings, so an unchecked cast would hide a typo. */
function assertHttpUrl(value: string, field: string): `http://${string}` | `https://${string}` {
  if (value.startsWith("http://")) return value as `http://${string}`;
  if (value.startsWith("https://")) return value as `https://${string}`;
  throw new NoxClientError(
    `${field} must be an http or https base URL, received "${value}". The local Nox gateway is ` +
      "published on a Docker-assigned port, so this is usually a missing NOX_GATEWAY_URL.",
  );
}

function isAuthorisationRefusal(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("not authorized to decrypt") || message.includes("is not a viewer");
}
