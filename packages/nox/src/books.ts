/**
 * Client-side encoding for `EncryptedMandateBook` and `ConfidentialRequestBook`.
 *
 * WHY ORDER IS A CONTRACT. Both books take a flat `bytes[] proofs` alongside a struct of external
 * handles, and validate them positionally — Solidity gives no way to name a proof. If the client
 * and the contract disagree about the order, the submission either reverts on a type mismatch or,
 * worse, seals a mandate whose market caps are its rate indexes. The order is therefore defined
 * once, here, and the contracts publish the same order through `mandateHandleOrder()` and
 * `requestHandleOrder()` so the two can be compared rather than assumed.
 *
 * WHY THE SLOTS ARE FIXED-LENGTH. Every mandate is 35 handles and every request is 19, whatever the
 * provider actually enabled. Unused slots carry encrypted zero. A variable-length submission would
 * leak the number of markets a provider is willing to lend into — which is exactly the sort of
 * shape inference PRD §8.3 exists to prevent.
 */

import type { EncryptedInput, KyrveHandleClient } from "./client.js";
import { type Address, assertFitsType, type EncryptedType, NoxTypeError } from "./types.js";

/** Slot counts, mirroring the constants the two contracts expose. */
export const MARKET_SLOTS = 8;
export const COLLATERAL_FAMILY_SLOTS = 4;
export const MATURITY_BUCKET_SLOTS = 4;
export const MANDATE_HANDLE_COUNT = 1 + 8 + 8 + 8 + 4 + 4 + 1 + 1;
export const REQUEST_HANDLE_COUNT = 1 + 1 + 8 + 8 + 1;

/** The layout version both books stamp into their commitments. Bump together, never apart. */
export const KYRVE_SCHEMA_VERSION = 1;

/**
 * A provider's mandate in plaintext, as the user typed it.
 *
 * This object exists only inside the authorised client. It is never sent to a server, never
 * persisted, and never logged. `encryptMandate` turns it into handles; nothing turns it back.
 */
export interface MandatePlaintext {
  /** Total capital this mandate will commit, in the loan token's smallest unit. */
  readonly totalBudget: bigint;
  /** Per-market cap. Index is the market index in the universe. Absent slots become zero. */
  readonly marketCaps: readonly bigint[];
  /** Lowest rate index acceptable per market. Higher tick means cheaper borrowing (A-7). */
  readonly minRateIndexes: readonly number[];
  /** 1 to lend into a market, 0 to sit out. Arithmetised: Nox has no boolean operations. */
  readonly enabledFlags: readonly number[];
  readonly collateralFamilyCaps: readonly bigint[];
  readonly maturityBucketCaps: readonly bigint[];
  readonly maxDurationIndex: number;
  readonly allocationWeight: number;
}

/** A borrower's request in plaintext. Same rules: authorised client only, never persisted. */
export interface RequestPlaintext {
  readonly desiredAssets: bigint;
  /** The floor below which a partial fill is worse than none. Encrypted, per PRD §11.9. */
  readonly minimumAssets: bigint;
  /** Highest rate index acceptable per market — the borrower's price limit. */
  readonly maxRateIndexes: readonly number[];
  readonly enabledFlags: readonly number[];
  readonly preferredMaturityIndex: number;
}

interface Field {
  readonly name: string;
  readonly value: bigint;
  readonly type: EncryptedType;
}

/** The canonical mandate order. Must equal `EncryptedMandateBook.mandateHandleOrder()`. */
export function mandateFields(mandate: MandatePlaintext): Field[] {
  const fields: Field[] = [{ name: "totalBudget", value: mandate.totalBudget, type: "euint256" }];

  pushSlots(fields, "marketCaps", mandate.marketCaps, MARKET_SLOTS, "euint256");
  pushSlots(fields, "minRateIndexes", mandate.minRateIndexes, MARKET_SLOTS, "euint16");
  pushSlots(fields, "enabledFlags", mandate.enabledFlags, MARKET_SLOTS, "euint16");
  pushSlots(
    fields,
    "collateralFamilyCaps",
    mandate.collateralFamilyCaps,
    COLLATERAL_FAMILY_SLOTS,
    "euint256",
  );
  pushSlots(
    fields,
    "maturityBucketCaps",
    mandate.maturityBucketCaps,
    MATURITY_BUCKET_SLOTS,
    "euint256",
  );

  fields.push({
    name: "maxDurationIndex",
    value: BigInt(mandate.maxDurationIndex),
    type: "euint16",
  });
  fields.push({
    name: "allocationWeight",
    value: BigInt(mandate.allocationWeight),
    type: "euint16",
  });

  assertCount(fields.length, MANDATE_HANDLE_COUNT, "mandate");
  return fields;
}

/** The canonical request order. Must equal `ConfidentialRequestBook.requestHandleOrder()`. */
export function requestFields(request: RequestPlaintext): Field[] {
  const fields: Field[] = [
    { name: "desiredAssets", value: request.desiredAssets, type: "euint256" },
    { name: "minimumAssets", value: request.minimumAssets, type: "euint256" },
  ];

  pushSlots(fields, "maxRateIndexes", request.maxRateIndexes, MARKET_SLOTS, "euint16");
  pushSlots(fields, "enabledFlags", request.enabledFlags, MARKET_SLOTS, "euint16");

  fields.push({
    name: "preferredMaturityIndex",
    value: BigInt(request.preferredMaturityIndex),
    type: "euint16",
  });

  assertCount(fields.length, REQUEST_HANDLE_COUNT, "request");
  return fields;
}

/** Encrypted handles and proofs in submission order, plus the struct shape the contract wants. */
export interface EncodedMandate {
  readonly inputs: readonly EncryptedInput[];
  readonly proofs: readonly `0x${string}`[];
  readonly struct: {
    readonly totalBudget: `0x${string}`;
    readonly marketCaps: readonly `0x${string}`[];
    readonly minRateIndexes: readonly `0x${string}`[];
    readonly enabledFlags: readonly `0x${string}`[];
    readonly collateralFamilyCaps: readonly `0x${string}`[];
    readonly maturityBucketCaps: readonly `0x${string}`[];
    readonly maxDurationIndex: `0x${string}`;
    readonly allocationWeight: `0x${string}`;
  };
}

export interface EncodedRequest {
  readonly inputs: readonly EncryptedInput[];
  readonly proofs: readonly `0x${string}`[];
  readonly struct: {
    readonly desiredAssets: `0x${string}`;
    readonly minimumAssets: `0x${string}`;
    readonly maxRateIndexes: readonly `0x${string}`[];
    readonly enabledFlags: readonly `0x${string}`[];
    readonly preferredMaturityIndex: `0x${string}`;
  };
}

/**
 * Encrypts a whole mandate for one book contract.
 *
 * Every handle is bound to `book`, to this chain, to the caller's wallet and to a 3600 second
 * expiry. Submitting them to a different contract, from a different wallet, on a different chain,
 * or an hour later, all fail inside NoxCompute — proven in the Phase 2 suite rather than assumed.
 */
export async function encryptMandate(
  client: KyrveHandleClient,
  book: Address,
  mandate: MandatePlaintext,
): Promise<EncodedMandate> {
  const fields = mandateFields(mandate);
  const inputs = await client.encryptAll(fields, book);
  const handles = inputs.map((input) => input.handle);

  let cursor = 0;
  const take = (): `0x${string}` => handles[cursor++] as `0x${string}`;
  const takeMany = (count: number): `0x${string}`[] => Array.from({ length: count }, () => take());

  return {
    inputs,
    proofs: inputs.map((input) => input.proof),
    struct: {
      totalBudget: take(),
      marketCaps: takeMany(MARKET_SLOTS),
      minRateIndexes: takeMany(MARKET_SLOTS),
      enabledFlags: takeMany(MARKET_SLOTS),
      collateralFamilyCaps: takeMany(COLLATERAL_FAMILY_SLOTS),
      maturityBucketCaps: takeMany(MATURITY_BUCKET_SLOTS),
      maxDurationIndex: take(),
      allocationWeight: take(),
    },
  };
}

/** Encrypts a whole request for one book contract. Same binding rules as {encryptMandate}. */
export async function encryptRequest(
  client: KyrveHandleClient,
  book: Address,
  request: RequestPlaintext,
): Promise<EncodedRequest> {
  const fields = requestFields(request);
  const inputs = await client.encryptAll(fields, book);
  const handles = inputs.map((input) => input.handle);

  let cursor = 0;
  const take = (): `0x${string}` => handles[cursor++] as `0x${string}`;
  const takeMany = (count: number): `0x${string}`[] => Array.from({ length: count }, () => take());

  return {
    inputs,
    proofs: inputs.map((input) => input.proof),
    struct: {
      desiredAssets: take(),
      minimumAssets: take(),
      maxRateIndexes: takeMany(MARKET_SLOTS),
      enabledFlags: takeMany(MARKET_SLOTS),
      preferredMaturityIndex: take(),
    },
  };
}

/**
 * Every field of a mandate or request that becomes public on submission, and every field that does
 * not.
 *
 * This is the data behind the interface's pre-signature disclosure. It is derived from the same
 * field lists the encoders use, so a field added to one cannot be forgotten in the other.
 */
export interface DisclosurePreview {
  readonly publicFields: readonly { readonly name: string; readonly value: string }[];
  readonly privateFields: readonly string[];
  readonly permanentDisclosureWarning: string | null;
}

export function mandateDisclosure(
  provider: Address,
  universeId: `0x${string}`,
  epoch: number,
  mandate: MandatePlaintext,
): DisclosurePreview {
  return {
    publicFields: [
      { name: "provider", value: provider },
      { name: "universe", value: universeId },
      { name: "epoch", value: String(epoch) },
      { name: "schema version", value: String(KYRVE_SCHEMA_VERSION) },
      { name: "submission time", value: "the block timestamp of this transaction" },
      { name: "commitment", value: "a keccak over the handle references, not over any value" },
    ],
    privateFields: mandateFields(mandate).map((field) => field.name),
    // Nothing in a mandate crosses the boundary. It is sealed encrypted and stays encrypted.
    permanentDisclosureWarning: null,
  };
}

export function requestDisclosure(
  borrower: Address,
  universeId: `0x${string}`,
  bondWei: bigint,
  expiresAt: number,
  request: RequestPlaintext,
): DisclosurePreview {
  return {
    publicFields: [
      { name: "borrower", value: borrower },
      { name: "universe", value: universeId },
      { name: "bond", value: `${bondWei} wei — visible, it is ETH` },
      { name: "expiry", value: String(expiresAt) },
      { name: "exact-fill requirement", value: "public, the keeper must agree on it" },
      { name: "collateral reference", value: "public, collateral is a public Midnight position" },
      { name: "nonce", value: "public, it is the replay guard" },
    ],
    privateFields: requestFields(request).map((field) => field.name),
    permanentDisclosureWarning: null,
  };
}

function pushSlots(
  fields: Field[],
  name: string,
  values: readonly (bigint | number)[],
  slots: number,
  type: EncryptedType,
): void {
  if (values.length > slots) {
    throw new NoxTypeError(
      `${name} has ${values.length} entries but the universe has ${slots} slots. A longer array ` +
        "cannot be padded away and would change the submission shape, which is itself a leak.",
    );
  }
  for (let i = 0; i < slots; i++) {
    // Absent slots are encrypted ZERO, not omitted. Every mandate must have the same shape.
    const raw = values[i] ?? 0;
    const value = typeof raw === "bigint" ? raw : BigInt(raw);
    assertFitsType(value, type);
    fields.push({ name: `${name}[${i}]`, value, type });
  }
}

function assertCount(actual: number, expected: number, what: string): void {
  if (actual !== expected) {
    throw new NoxTypeError(
      `${what} encoding produced ${actual} fields, but the contract expects exactly ${expected}. ` +
        "The two must never drift: the book validates proofs positionally.",
    );
  }
}
