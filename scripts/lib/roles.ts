/**
 * The seven operational roles, resolved for one environment.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS MODULE EXISTS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Through Phase 5 every deployment script wrote `const keeper = account.address; const operator =
 * account.address; const curator = account.address;` and said so in a comment. That is honest and it
 * is also the single largest unmitigated risk in the deployment: one compromised key holds the
 * authority to advance computation, retire quotes, recover funding, create series, publish the
 * supply snapshot and pause the protocol. `docs/phase5/PHASE-6-PREREQUISITES.md` P6-0 names it as
 * the one thing Phase 5 left undone and names it a DEPLOYMENT problem.
 *
 * So role resolution moves out of the deployment scripts and into one place that CANNOT return a
 * collapsed set: {resolveRoles} throws before any transport is built if two roles share an address.
 * `KyrveRoleRegistry`'s constructor refuses the same set on chain. Two independent refusals, because
 * the off-chain one can be bypassed by deploying by hand and the on-chain one cannot.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * KEY HANDLING
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Same rules as `env.ts`, and for the same reason: a private key is never printed, never returned in
 * anything that reaches a report, and never written to a manifest. {describeRoles} exists precisely
 * so a script has something safe to log — addresses, account kind and whether the role signs.
 *
 * LOCAL keys are the published Hardhat/anvil test mnemonic. They are worthless on every public
 * network and are derived rather than hardcoded, so the local role set is reproducible by anyone
 * running the same node without a `.env` at all.
 */

import { type Address, type Hex, toHex } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

import { loadEnv, MissingSecretError } from "./env.js";

/**
 * The role order is the `KyrveRoleRegistry.Role` enum order and is part of the constructor ABI.
 * Append only. Reordering silently changes which address is declared as which role.
 */
export const ROLE_ORDER = [
  "deployer",
  "keeper",
  "operator",
  "curator",
  "emergencyAuthority",
  "residueBeneficiary",
  "auditor",
] as const;

export type RoleName = (typeof ROLE_ORDER)[number];

/** One resolved role. `privateKey` is absent for a role this machine holds no key for. */
export interface RoleAccount {
  readonly name: RoleName;
  /** PUBLIC. Safe to print, record in a manifest and publish. */
  readonly address: Address;
  /**
   * Never printed, never stored, never returned to a report.
   *
   * Explicitly `| undefined` rather than merely optional, because the repository compiles with
   * `exactOptionalPropertyTypes` and "this machine holds no key for this role" is a state the
   * verification paths must be able to represent — `verify:roles` runs on machines that hold none.
   */
  readonly privateKey?: Hex | undefined;
  /** Whether this role sends transactions in normal operation, and therefore needs gas. */
  readonly signs: boolean;
  /** One line naming what the role may do. Mirrors `docs/phase6/ROLES.md`. */
  readonly authority: string;
}

export interface RoleSet {
  readonly environment: "local" | "sepolia";
  readonly accounts: Readonly<Record<RoleName, RoleAccount>>;
  /** In `KyrveRoleRegistry.Role` order, for the constructor argument. */
  readonly holders: readonly Address[];
}

/**
 * What each role may do, in one sentence. Duplicated nowhere else in executable form — the deploy
 * manifest and `pnpm roles:status` both read these strings, so a role's stated authority and its
 * declared authority cannot drift apart.
 */
const AUTHORITY: Readonly<Record<RoleName, string>> = {
  deployer:
    "deploys contracts and performs the one-shot bindings; holds no runtime authority afterwards",
  keeper:
    "advances computation: curve stages, quote activation, chunk consumption and allocation; cannot choose inputs or change outcomes",
  operator:
    "retires a live quote before expiry and recovers UNCOMMITTED funding from a series vault; cannot reach committed capital",
  curator:
    "registers reviewed universes and markets, creates series, sets the public redemption factor, publishes the aggregate supply snapshot; moves no funds",
  emergencyAuthority:
    "pauses and unpauses protocol ENTRIES; cannot pause any recovery path and cannot seize a confidential balance",
  residueBeneficiary:
    "receives the funding residue; a destination, never an authority — holds no privilege anywhere",
  auditor:
    "receives Kyrve Capsule snapshots; read-only, and never holds access to a live balance handle",
};

/** Roles that send transactions in normal operation and therefore need gas on a public network. */
const SIGNS: Readonly<Record<RoleName, boolean>> = {
  deployer: true,
  keeper: true,
  operator: true,
  curator: true,
  // Pausing is an exceptional action. The key exists so the authority is real; it is funded only
  // when an emergency drill is actually run, and `roles:status` reports the balance either way.
  emergencyAuthority: false,
  residueBeneficiary: false,
  // Decryption is a gateway request signed off chain, not a transaction. An auditor never needs gas
  // to read a capsule — which is itself a property worth having, because it means an auditor's
  // access does not depend on anyone funding them.
  auditor: false,
};

/** The environment variable holding each role's key. The deployer keeps its Phase 1 name. */
const KEY_VARIABLE: Readonly<Record<RoleName, string>> = {
  deployer: "DEPLOYER_PRIVATE_KEY",
  keeper: "KYRVE_KEEPER_PRIVATE_KEY",
  operator: "KYRVE_OPERATOR_PRIVATE_KEY",
  curator: "KYRVE_CURATOR_PRIVATE_KEY",
  emergencyAuthority: "KYRVE_GUARDIAN_PRIVATE_KEY",
  residueBeneficiary: "KYRVE_RESIDUE_PRIVATE_KEY",
  auditor: "KYRVE_AUDITOR_PRIVATE_KEY",
};

export function keyVariableFor(role: RoleName): string {
  return KEY_VARIABLE[role];
}

/**
 * The published Hardhat/anvil test mnemonic. Account 0 derives
 * `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`, which is the key
 * `scripts/deploy/*.ts` already uses for local deployment — so the local deployer is unchanged and
 * only the other six roles are new.
 */
const LOCAL_MNEMONIC = "test test test test test test test test test test test junk";

/**
 * Local role indexes.
 *
 * Deliberately ABOVE the range the confidential suite hands to providers and borrowers, so a role
 * key and a user key can never be the same wallet in a local demonstration. `confidential/test`
 * uses 0-7 for participants and the harness reserves 8 and 9; Phase 6 takes 10 upward for the roles
 * that were previously collapsed onto wallet 0.
 */
const LOCAL_INDEX: Readonly<Record<RoleName, number>> = {
  deployer: 0,
  keeper: 9,
  operator: 8,
  curator: 10,
  emergencyAuthority: 11,
  residueBeneficiary: 7,
  auditor: 12,
};

export class RoleCollapseError extends Error {
  constructor(
    readonly first: RoleName,
    readonly second: RoleName,
    readonly address: Address,
  ) {
    super(
      `the ${first} and the ${second} are the same address (${address}). Phase 6 requires seven ` +
        "distinct addresses, and `KyrveRoleRegistry`'s constructor refuses a collapsed set on " +
        "chain as well. Run `pnpm roles:generate` to mint the missing keys.",
    );
    this.name = "RoleCollapseError";
  }
}

function normaliseKey(raw: string, variable: string): Hex {
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    // Deliberately does not echo the value, not even its prefix.
    throw new Error(`${variable} is not a 32-byte hex key. Its value is not shown here by design.`);
  }
  return key;
}

function localAccount(role: RoleName): RoleAccount {
  const account = mnemonicToAccount(LOCAL_MNEMONIC, { addressIndex: LOCAL_INDEX[role] });
  const raw = account.getHdKey().privateKey;
  if (raw === null) throw new Error(`the local ${role} account derived no private key`);
  return {
    name: role,
    address: account.address,
    privateKey: toHex(raw),
    signs: SIGNS[role],
    authority: AUTHORITY[role],
  };
}

/**
 * The local signer for a role, as an HD account the wallet client can use directly.
 *
 * Separate from {resolveRoles} because it returns something that can sign, and a signer must never
 * be reachable from the value a report prints.
 */
export function localSigner(role: RoleName): ReturnType<typeof mnemonicToAccount> {
  return mnemonicToAccount(LOCAL_MNEMONIC, { addressIndex: LOCAL_INDEX[role] });
}

/**
 * Resolves all seven roles, refusing any collapsed pair.
 *
 * @param environment `local` derives from the published test mnemonic; `sepolia` reads `.env`.
 * @param options.requireKeys roles whose signing key must be present. A deployment needs the four
 *        that sign; a read-only verification needs none, and demanding them all would make
 *        `verify:roles` unrunnable on a machine that holds no keys.
 */
export function resolveRoles(
  environment: "local" | "sepolia",
  options: { readonly requireKeys?: readonly RoleName[] } = {},
): RoleSet {
  loadEnv();
  const required = new Set(options.requireKeys ?? []);
  const accounts = {} as Record<RoleName, RoleAccount>;

  for (const role of ROLE_ORDER) {
    if (environment === "local") {
      accounts[role] = localAccount(role);
      continue;
    }

    const variable = KEY_VARIABLE[role];
    const raw = (process.env[variable] ?? "").trim();
    if (raw.length === 0) {
      if (required.has(role)) {
        throw new MissingSecretError(
          variable,
          `act as the ${role}. Phase 6 refuses to reuse the deployer for it — run ` +
            "`pnpm roles:generate`",
        );
      }
      // A role with no key still needs an address, or the role table cannot be declared at all.
      const addressOnly = (process.env[`${variable.replace(/_PRIVATE_KEY$/, "")}_ADDRESS`] ?? "")
        .trim()
        .toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(addressOnly)) {
        throw new MissingSecretError(
          variable,
          `resolve the ${role}'s address. Either set the key, or set ` +
            `${variable.replace(/_PRIVATE_KEY$/, "")}_ADDRESS for a role this machine holds no key for`,
        );
      }
      accounts[role] = {
        name: role,
        address: addressOnly as Address,
        privateKey: undefined,
        signs: SIGNS[role],
        authority: AUTHORITY[role],
      };
      continue;
    }

    const key = normaliseKey(raw, variable);
    accounts[role] = {
      name: role,
      address: privateKeyToAccount(key).address,
      privateKey: key,
      signs: SIGNS[role],
      authority: AUTHORITY[role],
    };
  }

  // Pairwise, and it throws rather than warning. A deployment that proceeded with a collapsed set
  // would produce a layer whose immutables cannot be corrected without redeploying all of it.
  for (let i = 0; i < ROLE_ORDER.length; i += 1) {
    for (let j = i + 1; j < ROLE_ORDER.length; j += 1) {
      const first = ROLE_ORDER[i] as RoleName;
      const second = ROLE_ORDER[j] as RoleName;
      if (accounts[first].address.toLowerCase() === accounts[second].address.toLowerCase()) {
        throw new RoleCollapseError(first, second, accounts[first].address);
      }
    }
  }

  return {
    environment,
    accounts,
    holders: ROLE_ORDER.map((role) => accounts[role].address),
  };
}

/** Everything about a role set that is safe to print. Never includes a key. */
export interface RoleDescription {
  readonly role: RoleName;
  readonly address: Address;
  readonly signs: boolean;
  readonly keyHeld: boolean;
  readonly authority: string;
}

export function describeRoles(set: RoleSet): readonly RoleDescription[] {
  return ROLE_ORDER.map((role) => {
    const account = set.accounts[role];
    return {
      role,
      address: account.address,
      signs: account.signs,
      keyHeld: account.privateKey !== undefined,
      authority: account.authority,
    };
  });
}

/** The signing key for a role, or a clear failure. Callers must not hold the result. */
export function signingKey(set: RoleSet, role: RoleName): Hex {
  const key = set.accounts[role].privateKey;
  if (key === undefined) {
    throw new MissingSecretError(
      KEY_VARIABLE[role],
      `send a transaction as the ${role}. This machine holds the address but not the key`,
    );
  }
  return key;
}
