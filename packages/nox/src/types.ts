/**
 * The complete Nox surface Kyrve is allowed to depend on.
 *
 * WHY THIS PACKAGE EXISTS (PRD v1.1 A-15, mandatory). Nox is version-skewed in every direction at
 * once: no mainnet exists, the handle SDK is `0.1.0-beta.13` with no stable release, the Hardhat
 * plugin's `main` already contains an unpublished breaking redesign, published
 * `nox-protocol-contracts@0.2.4` lags repository HEAD on security fixes, the deployed testnet
 * implementations lag both, and the two supported testnets run different contract versions and
 * different KMS keys. Every Nox touchpoint therefore lives here so a breaking upstream change is a
 * one-package fix.
 *
 * WHY THE OFFICIAL SDK IS NOT A DEPENDENCY. Two of the three things Kyrve needs from it are
 * unusable as shipped: handle readiness depends on `POST /v0/public/handles/status`, which is
 * absent from both the SDK and the documentation, and the SDK's built-in retry gives up after
 * roughly 7 seconds while measured handle readiness has a p90 of 492 ms locally and is UNMEASURED
 * on testnet. Kyrve implements its own transport and its own backoff. The Solidity SDK
 * (`sdk/Nox.sol`, MIT) is still what the contracts import; this package is the TypeScript side.
 */

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

/**
 * The five encrypted types Nox supports. There is no euint8/32/64/128, no eaddress and no
 * encrypted bytes. Verified against `sdk/Nox.sol@0.2.4`.
 */
export type EncryptedType = "ebool" | "euint16" | "euint256" | "eint16" | "eint256";

export const ENCRYPTED_TYPES: readonly EncryptedType[] = [
  "ebool",
  "euint16",
  "euint256",
  "eint16",
  "eint256",
];

/** The matching external (client-supplied) types accepted by `fromExternal`. */
export const EXTERNAL_TYPES = {
  ebool: "externalEbool",
  euint16: "externalEuint16",
  euint256: "externalEuint256",
  eint16: "externalEint16",
  eint256: "externalEint256",
} as const satisfies Record<EncryptedType, string>;

export function isEncryptedType(value: string): value is EncryptedType {
  return (ENCRYPTED_TYPES as readonly string[]).includes(value);
}

/** Bit width of each encrypted type, used to bound plaintext before it is ever encrypted. */
export const TYPE_BOUNDS: Record<EncryptedType, { min: bigint; max: bigint }> = {
  ebool: { min: 0n, max: 1n },
  euint16: { min: 0n, max: 2n ** 16n - 1n },
  euint256: { min: 0n, max: 2n ** 256n - 1n },
  eint16: { min: -(2n ** 15n), max: 2n ** 15n - 1n },
  eint256: { min: -(2n ** 255n), max: 2n ** 255n - 1n },
};

export class NoxTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoxTypeError";
  }
}

/** Throws unless `value` fits `type`, before anything is encrypted or sent. */
export function assertFitsType(value: bigint, type: EncryptedType): void {
  const bounds = TYPE_BOUNDS[type];
  if (value < bounds.min || value > bounds.max) {
    throw new NoxTypeError(
      `${value} does not fit ${type} (range ${bounds.min}..${bounds.max}). ` +
        "Nox has no wider unsigned type than euint256 and no euint8/32/64/128 at all.",
    );
  }
}

/** A handle: the 32-byte on-chain reference to an encrypted value. Never the value itself. */
export type Handle = Hex;

export interface NoxNetwork {
  readonly chainId: number;
  readonly name: string;
  readonly noxCompute: Address;
  /** Handle gateway base URL. The local stack publishes this on a Docker-assigned port. */
  readonly gatewayUrl: string;
}

/**
 * `fromExternal` binds a proof to owner, application contract, chain id and a 3600 s expiry.
 * Verified at runtime during Day 0: wrong owner, wrong application contract, tampered signature
 * and truncated proof all revert.
 */
export const PROOF_EXPIRY_SECONDS = 3600;
