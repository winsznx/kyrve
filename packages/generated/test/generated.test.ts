import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getAbiItem, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";

import {
  IBuyCallbackAbi,
  IMidnightAbi,
  IRatifierAbi,
  KyrveDeploymentVerifierAbi,
  KyrveExactFillVaultAbi,
  KyrveOsakaProbeAbi,
  KyrveProtocolRegistryAbi,
  KyrveQuoteRatifierAbi,
  MidnightAbi,
} from "../src/index.js";

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../abi-manifest.json", import.meta.url)), "utf8"),
) as {
  commit: string;
  contracts: Record<string, { source: string; abiEntries: number; contentHash: string }>;
  deferred: Array<{ name: string; reason: string }>;
};

describe("the generated bindings describe the contracts Kyrve actually calls", () => {
  it("exposes the Midnight entry points the settlement path uses", () => {
    for (const name of ["take", "touchMarket", "setConsumed", "setIsAuthorized", "settlementFee"]) {
      expect(getAbiItem({ abi: IMidnightAbi, name }), `IMidnight.${name}`).toBeDefined();
    }
  });

  /**
   * The structural fact the whole design rests on: the ratifier is `view` and its signature
   * contains no `units`, so it cannot enforce fill size however it is written.
   */
  it("proves isRatified is view and receives no units", () => {
    const item = getAbiItem({ abi: IRatifierAbi, name: "isRatified" });
    expect(item).toBeDefined();
    expect(item?.stateMutability).toBe("view");
    const inputNames = item?.inputs.map((i) => i.name) ?? [];
    expect(inputNames).not.toContain("units");
    expect(inputNames).toContain("taker");
  });

  /** ...and that `onBuy` does receive it, which is why exact fill is enforced there. */
  it("proves onBuy receives units and pendingFeeIncrease", () => {
    const item = getAbiItem({ abi: IBuyCallbackAbi, name: "onBuy" });
    expect(item).toBeDefined();
    expect(item?.stateMutability).not.toBe("view");
    const inputNames = item?.inputs.map((i) => i.name) ?? [];
    expect(inputNames).toContain("units");
    expect(inputNames).toContain("pendingFeeIncrease");
    expect(inputNames).toContain("buyerAssets");
  });

  it("exposes the registry and verifier surface the deployment scripts call", () => {
    for (const name of [
      "registerDeployment",
      "isSupportedMidnight",
      "isSupportedNoxCompute",
      "emergencyStopped",
    ]) {
      expect(getAbiItem({ abi: KyrveProtocolRegistryAbi, name }), name).toBeDefined();
    }
    for (const name of [
      "verify",
      "verifyVersion",
      "runtimeCodeHash",
      "eip1967ImplementationSlot",
    ]) {
      expect(getAbiItem({ abi: KyrveDeploymentVerifierAbi, name }), name).toBeDefined();
    }
  });

  it("exposes the Osaka probe used by every deployment preflight", () => {
    expect(getAbiItem({ abi: KyrveOsakaProbeAbi, name: "verifyOsaka" })).toBeDefined();
    expect(getAbiItem({ abi: KyrveOsakaProbeAbi, name: "assertOsaka" })).toBeDefined();
    expect(getAbiItem({ abi: KyrveOsakaProbeAbi, name: "clz" })).toBeDefined();
  });

  it("carries the exact-fill errors with their offending values, so a revert names the mismatch", () => {
    const wrongUnits = KyrveExactFillVaultAbi.find(
      (item) => item.type === "error" && item.name === "WrongUnits",
    );
    expect(wrongUnits).toBeDefined();
    expect(toFunctionSelector("WrongUnits(uint256,uint256)")).toBeDefined();

    const altered = KyrveQuoteRatifierAbi.find(
      (item) => item.type === "error" && item.name === "AlteredOffer",
    );
    expect(altered).toBeDefined();
  });

  it("includes the cancellation primitive PRD v1.1 A-5 requires", () => {
    expect(getAbiItem({ abi: KyrveExactFillVaultAbi, name: "cancelQuote" })).toBeDefined();
    expect(getAbiItem({ abi: IMidnightAbi, name: "setConsumed" })).toBeDefined();
  });

  it("generates the concrete Midnight core, not only its interface", () => {
    expect(MidnightAbi.length).toBeGreaterThan(IMidnightAbi.length);
  });
});

describe("the manifest records provenance honestly", () => {
  it("names a source file for every generated contract", () => {
    for (const [name, entry] of Object.entries(manifest.contracts)) {
      expect(entry.source, name).toMatch(/^(contracts|vendor)\//);
      expect(entry.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(entry.abiEntries).toBeGreaterThan(0);
    }
  });

  it("records what is deliberately NOT generated yet, rather than leaving a silent gap", () => {
    const names = manifest.deferred.map((d) => d.name);
    expect(names.some((n) => n.includes("Nox"))).toBe(true);
    expect(names.some((n) => n.includes("ERC-7984"))).toBe(true);
    for (const entry of manifest.deferred) {
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });

  it("emits no generation timestamp, so regeneration is byte-stable", () => {
    const raw = readFileSync(
      fileURLToPath(new URL("../src/KyrveOsakaProbe.ts", import.meta.url)),
      "utf8",
    );
    expect(raw).toContain("TIMESTAMP POLICY");
    // An ISO-8601 timestamp anywhere in a generated file would break `verify:generated`.
    expect(raw).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });
});
