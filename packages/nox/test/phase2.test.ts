import { describe, expect, it } from "vitest";

import { CONFIDENTIAL_STATE_COPY, confidentialStateOf, type HandleAcl } from "../src/acl-chain.js";
import {
  COLLATERAL_FAMILY_SLOTS,
  MANDATE_HANDLE_COUNT,
  MARKET_SLOTS,
  MATURITY_BUCKET_SLOTS,
  type MandatePlaintext,
  mandateDisclosure,
  mandateFields,
  REQUEST_HANDLE_COUNT,
  type RequestPlaintext,
  requestDisclosure,
  requestFields,
} from "../src/books.js";
import { parseHandleState } from "../src/runtime.js";
import { NoxTypeError } from "../src/types.js";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const UNIVERSE = `0x${"22".repeat(32)}` as const;
const HANDLE_A = `0x${"aa".repeat(32)}` as const;
const HANDLE_B = `0x${"bb".repeat(32)}` as const;

const MANDATE: MandatePlaintext = {
  totalBudget: 5_000n,
  marketCaps: [1_000n, 2_000n],
  minRateIndexes: [10, 20],
  enabledFlags: [1, 1],
  collateralFamilyCaps: [3_000n],
  maturityBucketCaps: [4_000n],
  maxDurationIndex: 2,
  allocationWeight: 50,
};

const REQUEST: RequestPlaintext = {
  desiredAssets: 900n,
  minimumAssets: 800n,
  maxRateIndexes: [30],
  enabledFlags: [1],
  preferredMaturityIndex: 1,
};

describe("book encoding — order and shape are a contract, not a convention", () => {
  it("produces exactly the field count both books validate positionally", () => {
    expect(mandateFields(MANDATE)).toHaveLength(MANDATE_HANDLE_COUNT);
    expect(requestFields(REQUEST)).toHaveLength(REQUEST_HANDLE_COUNT);
    expect(MANDATE_HANDLE_COUNT).toBe(
      1 + MARKET_SLOTS * 3 + COLLATERAL_FAMILY_SLOTS + MATURITY_BUCKET_SLOTS + 2,
    );
  });

  it("emits fields in the exact order the contracts publish", () => {
    const names = mandateFields(MANDATE).map((field) => field.name);
    expect(names[0]).toBe("totalBudget");
    expect(names[1]).toBe("marketCaps[0]");
    expect(names[1 + MARKET_SLOTS]).toBe("minRateIndexes[0]");
    expect(names[1 + MARKET_SLOTS * 2]).toBe("enabledFlags[0]");
    expect(names[1 + MARKET_SLOTS * 3]).toBe("collateralFamilyCaps[0]");
    expect(names.at(-2)).toBe("maxDurationIndex");
    expect(names.at(-1)).toBe("allocationWeight");

    const requestNames = requestFields(REQUEST).map((field) => field.name);
    expect(requestNames[0]).toBe("desiredAssets");
    expect(requestNames[1]).toBe("minimumAssets");
    expect(requestNames[2]).toBe("maxRateIndexes[0]");
    expect(requestNames.at(-1)).toBe("preferredMaturityIndex");
  });

  it("pads unused slots with encrypted ZERO rather than omitting them", () => {
    // A variable-length submission would leak how many markets a provider will lend into, which is
    // exactly the shape inference PRD §8.3 exists to prevent.
    const fields = mandateFields(MANDATE);
    const caps = fields.filter((field) => field.name.startsWith("marketCaps["));
    expect(caps).toHaveLength(MARKET_SLOTS);
    expect(caps.slice(2).every((field) => field.value === 0n)).toBe(true);
  });

  it("assigns the right encrypted type to each field", () => {
    const byName = new Map(mandateFields(MANDATE).map((field) => [field.name, field.type]));
    expect(byName.get("totalBudget")).toBe("euint256");
    expect(byName.get("marketCaps[0]")).toBe("euint256");
    expect(byName.get("minRateIndexes[0]")).toBe("euint16");
    expect(byName.get("enabledFlags[0]")).toBe("euint16");
    expect(byName.get("allocationWeight")).toBe("euint16");
  });

  it("refuses an array longer than the universe has slots", () => {
    const tooMany: MandatePlaintext = {
      ...MANDATE,
      marketCaps: Array.from({ length: MARKET_SLOTS + 1 }, () => 1n),
    };
    expect(() => mandateFields(tooMany)).toThrow(NoxTypeError);
    expect(() => mandateFields(tooMany)).toThrow(/cannot be padded away/);
  });

  it("refuses a value that will not fit its encrypted type, before anything is encrypted", () => {
    // Nox has no euint32/64/128. A rate index above 65,535 would wrap silently inside the TEE.
    const overflowing: MandatePlaintext = { ...MANDATE, minRateIndexes: [70_000] };
    expect(() => mandateFields(overflowing)).toThrow(NoxTypeError);
  });
});

describe("disclosure preview — what the user is told before signing", () => {
  it("classifies every mandate field as private and names the public ones", () => {
    const preview = mandateDisclosure(ADDRESS, UNIVERSE, 1, MANDATE);
    expect(preview.privateFields).toHaveLength(MANDATE_HANDLE_COUNT);
    expect(preview.publicFields.map((field) => field.name)).toContain("commitment");
    // A mandate never crosses the boundary, so there is nothing irreversible to warn about.
    expect(preview.permanentDisclosureWarning).toBeNull();
  });

  it("keeps a request's bond public and its price limit private", () => {
    const preview = requestDisclosure(ADDRESS, UNIVERSE, 1_000n, 42, REQUEST);
    const publicNames = preview.publicFields.map((field) => field.name);
    expect(publicNames).toContain("bond");
    expect(publicNames).toContain("expiry");
    expect(publicNames.some((name) => name.includes("maxRateIndexes"))).toBe(false);
    expect(preview.privateFields).toContain("maxRateIndexes[0]");
    expect(preview.privateFields).toContain("desiredAssets");
  });

  it("derives both halves from the same field list, so neither can drift", () => {
    const preview = mandateDisclosure(ADDRESS, UNIVERSE, 1, MANDATE);
    expect(preview.privateFields).toEqual(mandateFields(MANDATE).map((field) => field.name));
  });
});

describe("confidential state — derived from real ACL, never invented", () => {
  const acl = (partial: Partial<HandleAcl>): HandleAcl => ({
    handle: HANDLE_A,
    account: ADDRESS,
    isAdmin: false,
    canDecrypt: false,
    isPublic: false,
    ...partial,
  });

  it("maps each ACL shape to exactly one of design.md's states", () => {
    expect(confidentialStateOf(acl({}))).toBe("encrypted-and-unavailable");
    expect(confidentialStateOf(acl({ canDecrypt: true, isAdmin: true }))).toBe(
      "available-to-decrypt",
    );
    expect(confidentialStateOf(acl({ isPublic: true, canDecrypt: true }))).toBe(
      "intentionally-public",
    );
  });

  it("treats public as public even when the account also holds a grant", () => {
    expect(confidentialStateOf(acl({ isPublic: true, isAdmin: true, canDecrypt: true }))).toBe(
      "intentionally-public",
    );
  });

  it("offers no wording that claims a grant was withdrawn", () => {
    for (const copy of Object.values(CONFIDENTIAL_STATE_COPY)) {
      const text = `${copy.label} ${copy.explanation}`.toLowerCase();
      expect(text).not.toContain("revoke");
      expect(text).not.toContain("removed");
      expect(text).not.toContain("deleted");
    }
    expect(CONFIDENTIAL_STATE_COPY["intentionally-public"].explanation).toContain("permanently");
  });
});

describe("gateway readiness — the shape the real gateway actually returns (delta Q-3)", () => {
  // Measured against nox-handle-gateway 0.6.0. The Day 0 implementation guessed `{state}` and
  // `{ready}` from the endpoint's name, met no live gateway, and would have timed out on every
  // real response.
  const real = (resolved: boolean, handle = HANDLE_A) => ({
    payload: { statuses: [{ handle, resolved }] },
  });

  it("reads the measured payload/statuses/resolved shape", () => {
    expect(parseHandleState(real(true))).toBe("ready");
    expect(parseHandleState(real(false))).toBe("pending");
  });

  it("selects the entry for the handle asked about, not merely the first", () => {
    const many = {
      payload: {
        statuses: [
          { handle: HANDLE_B, resolved: false },
          { handle: HANDLE_A, resolved: true },
        ],
      },
    };
    expect(parseHandleState(many, HANDLE_A)).toBe("ready");
    expect(parseHandleState(many, HANDLE_B)).toBe("pending");
  });

  it("matches handles case-insensitively, because hex casing is not semantic", () => {
    const upper = HANDLE_A.toUpperCase().replace("0X", "0x") as `0x${string}`;
    expect(parseHandleState(real(true, upper), HANDLE_A)).toBe("ready");
  });

  it("reports unknown for a handle the gateway did not answer about", () => {
    expect(parseHandleState(real(true, HANDLE_B), HANDLE_A)).toBe("unknown");
  });

  it("still understands the shapes Day 0 guessed, in case the endpoint changes again", () => {
    // The endpoint is absent from both the SDK and the documentation, so it is treated as unstable.
    expect(parseHandleState({ state: "ready" })).toBe("ready");
    expect(parseHandleState({ ready: false })).toBe("pending");
    expect(parseHandleState("resolved")).toBe("ready");
    expect(parseHandleState(null)).toBe("unknown");
  });
});
