/**
 * Kyrve Day 0 Spike E - Cloudflare runtime proof. Not product code.
 *
 * Proves that the operated infrastructure actually runs under workerd:
 * viem JSON-RPC, log fetching and decoding, a Workflow modelling the quote
 * lifecycle, a Queue producer/consumer, D1 as a bounded projection, R2 as the
 * block-partitioned event store, and a Durable Object serialising nonces.
 *
 * PRIVACY: nothing here touches a decrypted value. Only public chain data,
 * handles, statuses and cursors are indexed. See the bundle privacy audit in
 * docs/day0/CLOUDFLARE-RUNTIME-GATE.md.
 */
import { createPublicClient, http, parseAbiItem, decodeEventLog, type Address } from "viem";
import { sepolia } from "viem/chains";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { DurableObject } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

interface Env {
  DB: D1Database;
  EVENTS: R2Bucket;
  INDEX_JOBS: Queue<IndexJob>;
  NONCE_ALLOCATOR: DurableObjectNamespace<NonceAllocator>;
  QUOTE_FLOW: Workflow<QuoteParams>;
  SEPOLIA_RPC_URL: string;
}

interface IndexJob {
  fromBlock: string;
  toBlock: string;
}

interface QuoteParams {
  requestId: string;
  handle: string;
}

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

function rpc(env: Env) {
  return createPublicClient({ chain: sepolia, transport: http(env.SEPOLIA_RPC_URL) });
}

// ---------------------------------------------------------------------------
// Durable Object - serialises Ethereum nonce allocation for one signing key.
// Workflows retry by default and transaction submission is not idempotent, so
// the nonce counter must be strongly consistent and single-threaded.
// ---------------------------------------------------------------------------

export class NonceAllocator extends DurableObject {
  async allocate(signer: Address): Promise<number> {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS nonces (signer TEXT PRIMARY KEY, next INTEGER NOT NULL)",
    );
    const row = this.ctx.storage.sql
      .exec<{ next: number }>("SELECT next FROM nonces WHERE signer = ?", signer)
      .toArray()[0];
    const next = row?.next ?? 0;
    this.ctx.storage.sql.exec(
      "INSERT INTO nonces (signer, next) VALUES (?, ?) ON CONFLICT(signer) DO UPDATE SET next = ?",
      signer,
      next + 1,
      next + 1,
    );
    return next;
  }
}

// ---------------------------------------------------------------------------
// Workflow - the quote lifecycle. Steps are named deterministically because
// step names are memoisation keys.
// ---------------------------------------------------------------------------

export class QuoteLifecycleWorkflow extends WorkflowEntrypoint<Env, QuoteParams> {
  async run(event: WorkflowEvent<QuoteParams>, step: WorkflowStep) {
    const { requestId, handle } = event.payload;

    const observed = await step.do("observe-request", async () => {
      const client = rpc(this.env);
      const block = await client.getBlockNumber();
      return { requestId, observedAtBlock: block.toString() };
    });

    // Poll Nox handle readiness with durable sleeps. Waiting instances do not
    // count against the concurrency limit, so this costs nothing while idle.
    let ready = false;
    for (let attempt = 0; attempt < 5 && !ready; attempt++) {
      ready = await step.do(`poll-handle-${attempt}`, { retries: { limit: 3, delay: 2000, backoff: "exponential" } }, async () => {
        return handle.length === 66;
      });
      if (!ready) await step.sleep(`wait-${attempt}`, "30 seconds");
    }
    if (!ready) throw new NonRetryableError("handle never became ready");

    // Idempotency: allocate a nonce through the DO before any submission, so a
    // workflow retry cannot double-submit.
    const nonce = await step.do("allocate-nonce", async () => {
      const id = this.env.NONCE_ALLOCATOR.idFromName("keeper-0");
      return this.env.NONCE_ALLOCATOR.get(id).allocate("0x0000000000000000000000000000000000000001");
    });

    await step.do("record-activation", async () => {
      await this.env.DB.prepare(
        "INSERT OR REPLACE INTO quote_status (request_id, status, nonce, observed_block) VALUES (?, ?, ?, ?)",
      )
        .bind(requestId, "activated", nonce, observed.observedAtBlock)
        .run();
      return { requestId, nonce };
    });

    // Step returns are capped at 1 MiB, so return an R2 key rather than a payload.
    return { requestId, receiptKey: `receipts/${requestId}.json` };
  }
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, runtime: "workerd" });
    }

    // Proves viem executes a real JSON-RPC call from inside workerd.
    if (url.pathname === "/chain/head") {
      const client = rpc(env);
      const [blockNumber, chainId] = await Promise.all([
        client.getBlockNumber(),
        client.getChainId(),
      ]);
      return Response.json({ chainId, blockNumber: blockNumber.toString() });
    }

    // Proves log fetching and ABI decoding under workerd.
    if (url.pathname === "/chain/logs") {
      const client = rpc(env);
      const head = await client.getBlockNumber();
      // Public RPC endpoints require an address filter for eth_getLogs, which a
      // real indexer supplies anyway. WETH on Sepolia is used as a busy fixture.
      const logs = await client.getLogs({
        address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
        event: TRANSFER_EVENT,
        fromBlock: head - 200n,
        toBlock: head,
      });
      const decoded = logs.slice(0, 3).map((l) => {
        const ev = decodeEventLog({ abi: [TRANSFER_EVENT], data: l.data, topics: l.topics });
        return {
          blockNumber: l.blockNumber?.toString(),
          txHash: l.transactionHash,
          from: (ev.args as any).from,
          to: (ev.args as any).to,
          value: (ev.args as any).value?.toString(),
        };
      });
      return Response.json({ head: head.toString(), fetched: logs.length, decoded });
    }

    // R2 write/read - content-addressed, never a hot mutable key.
    if (url.pathname === "/store/roundtrip") {
      const key = `blocks/000000-000100/${crypto.randomUUID()}.json`;
      await env.EVENTS.put(key, JSON.stringify({ events: [], writtenAt: "deterministic" }));
      const got = await env.EVENTS.get(key);
      return Response.json({ key, readBack: got !== null });
    }

    // D1 bounded projection + cursor reconciliation.
    if (url.pathname === "/index/cursor") {
      const row = await env.DB.prepare("SELECT value FROM cursors WHERE name = ?")
        .bind("sepolia-head")
        .first<{ value: string }>();
      return Response.json({ cursor: row?.value ?? null });
    }

    if (url.pathname === "/index/enqueue") {
      await env.INDEX_JOBS.send({ fromBlock: "0", toBlock: "100" });
      return Response.json({ enqueued: true });
    }

    if (url.pathname === "/quote/start") {
      const instance = await env.QUOTE_FLOW.create({
        params: { requestId: "req-1", handle: `0x${"11".repeat(32)}` },
      });
      return Response.json({ instanceId: instance.id });
    }

    return new Response("not found", { status: 404 });
  },

  // Queue consumer - batch ingestion into R2 with a bounded D1 projection.
  async queue(batch: MessageBatch<IndexJob>, env: Env): Promise<void> {
    const statements: D1PreparedStatement[] = [];
    for (const msg of batch.messages) {
      const key = `blocks/${msg.body.fromBlock}-${msg.body.toBlock}/events.json`;
      await env.EVENTS.put(key, JSON.stringify({ from: msg.body.fromBlock, to: msg.body.toBlock }));
      statements.push(
        env.DB.prepare(
          "INSERT OR REPLACE INTO block_partitions (from_block, to_block, r2_key) VALUES (?, ?, ?)",
        ).bind(msg.body.fromBlock, msg.body.toBlock, key),
      );
      msg.ack();
    }
    if (statements.length > 0) await env.DB.batch(statements);
  },

  // Cron reconciliation - always resumes from a stored cursor. Cloudflare
  // publishes no delivery guarantee for cron, so a missed tick must be harmless.
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const row = await env.DB.prepare("SELECT value FROM cursors WHERE name = ?")
      .bind("sepolia-head")
      .first<{ value: string }>();
    const from = BigInt(row?.value ?? "0");
    const client = rpc(env);
    const head = await client.getBlockNumber();
    if (head > from) {
      await env.INDEX_JOBS.send({ fromBlock: from.toString(), toBlock: head.toString() });
      await env.DB.prepare("INSERT OR REPLACE INTO cursors (name, value) VALUES (?, ?)")
        .bind("sepolia-head", head.toString())
        .run();
    }
  },
};
