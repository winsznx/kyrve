import { env, exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

/**
 * Kyrve Day 0 Spike E - executes the Worker inside workerd via Miniflare.
 * Proves viem, R2 and Queues genuinely run in the Workers runtime.
 */
describe("Kyrve Worker under workerd", () => {
  it("serves health", async () => {
    const res = await exports.default.fetch("https://x/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, runtime: "workerd" });
  });

  it("404s unknown routes", async () => {
    const res = await exports.default.fetch("https://x/nope");
    expect(res.status).toBe(404);
  });

  it("round-trips R2 with a content-addressed key", async () => {
    const res = await exports.default.fetch("https://x/store/roundtrip");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string; readBack: boolean };
    expect(body.readBack).toBe(true);
    expect(body.key.startsWith("blocks/")).toBe(true);
  });

  it("enqueues an index job", async () => {
    const res = await exports.default.fetch("https://x/index/enqueue");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enqueued: true });
  });

  it("executes a real viem JSON-RPC call from inside workerd", async () => {
    const res = await exports.default.fetch("https://x/chain/head");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { chainId: number; blockNumber: string };
    expect(body.chainId).toBe(11155111);
    expect(BigInt(body.blockNumber)).toBeGreaterThan(0n);
    console.log(`    viem in workerd -> chainId ${body.chainId} head ${body.blockNumber}`);
  });

  it("fetches and ABI-decodes real logs from inside workerd", async () => {
    const res = await exports.default.fetch("https://x/chain/logs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { head: string; fetched: number; decoded: any[] };
    expect(BigInt(body.head)).toBeGreaterThan(0n);
    console.log(`    logs fetched ${body.fetched}, decoded sample ${body.decoded.length}`);
    if (body.decoded.length > 0) {
      expect(body.decoded[0].from).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(typeof body.decoded[0].value).toBe("string");
    }
  });
});
