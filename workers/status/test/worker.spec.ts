import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const SERVICE = "status";

/**
 * Runs inside workerd, not Node. These assert the Phase 1 contract: every Worker reports which
 * build is running against which deployment, and exposes nothing it cannot honestly back.
 */
describe(`${SERVICE} worker — Phase 1 contract`, () => {
  it("reports health with the workerd runtime", async () => {
    const response = await SELF.fetch("https://kyrve.test/health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(body["service"]).toBe(SERVICE);
    expect(body["runtime"]).toBe("workerd");
  });

  it("reports its version and environment", async () => {
    const body = (await (await SELF.fetch("https://kyrve.test/version")).json()) as Record<
      string,
      unknown
    >;
    expect(body["service"]).toBe(SERVICE);
    expect(body["environment"]).toBe(env.KYRVE_ENVIRONMENT);
    expect(body["phase"]).toBe("phase-1-substrate");
  });

  it("reports the embedded deployment it is configured against", async () => {
    const response = await SELF.fetch("https://kyrve.test/config");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;

    expect(body.chainId).toBeGreaterThan(0);
    expect(body.manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(body.midnightCommit).toBe("dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0");
    expect(body.supportedDeployment.midnight).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(body.markets).toHaveLength(4);
  });

  /**
   * The freshness field is the one place a Worker could quietly lie. "Nothing has ever run" and
   * "perfectly caught up" must never render identically.
   */
  it("reports index freshness as not-started rather than zero blocks behind", async () => {
    const body = (await (await SELF.fetch("https://kyrve.test/config")).json()) as Record<
      string,
      any
    >;
    expect(body.indexFreshness.state).toBe("not-started");
    expect(JSON.stringify(body.indexFreshness)).not.toMatch(/"blocksBehind":\s*0/);
  });

  it("carries the non-production licence disclosure", async () => {
    const body = (await (await SELF.fetch("https://kyrve.test/config")).json()) as Record<
      string,
      any
    >;
    expect(body.disclosure).toMatch(/source-available/);
    expect(body.disclosure).toMatch(/not an official Morpho deployment/i);
  });

  it("exposes no protocol surface it cannot back, and lists what it does expose", async () => {
    const response = await SELF.fetch("https://kyrve.test/quote");
    expect(response.status).toBe(404);
    const body = (await response.json()) as Record<string, any>;
    expect(body.availableRoutes).toBeInstanceOf(Array);
    expect(body.availableRoutes).toContain("/config");
  });

  /**
   * No response may carry a secret.
   *
   * A blanket "no 32-byte hex" rule would be wrong: market ids and rate-grid hashes are exactly
   * that shape and are public by design. The real invariant is that every 32-byte value appearing
   * in a response is one Kyrve intended to publish.
   */
  it("never leaks a credential, and publishes only expected 32-byte values", async () => {
    const config = (await (await SELF.fetch("https://kyrve.test/config")).json()) as Record<
      string,
      any
    >;
    const expected = new Set<string>([
      ...config.markets.map((m: { id: string }) => m.id.toLowerCase()),
      ...config.markets.map((m: { rateGridHash: string }) => m.rateGridHash.toLowerCase()),
    ]);

    for (const path of ["/health", "/version", "/config"]) {
      const text = await (await SELF.fetch(`https://kyrve.test${path}`)).text();

      expect(text).not.toMatch(/alchemy\.com/i);
      expect(text).not.toMatch(/api[_-]?key/i);
      expect(text).not.toMatch(/PRIVATE_KEY/i);

      const thirtyTwoByteValues = text.match(/0x[0-9a-fA-F]{64}/g) ?? [];
      for (const value of thirtyTwoByteValues) {
        expect(expected, `unexpected 32-byte value in ${path}: ${value}`).toContain(
          value.toLowerCase(),
        );
      }
    }
  });
});
