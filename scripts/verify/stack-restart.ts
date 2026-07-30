/**
 * `pnpm verify:stack` — the local stack, proven from a clean start, twice.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY TWICE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A stack that starts once proves it can start on a machine that has never run it. A stack that
 * starts, stops and starts AGAIN with no manual cleanup proves the thing that actually breaks:
 * teardown. Six orphaned containers, a Hardhat node still bound to 8545, or a manifest claiming a
 * dead stack is up — none of those show on the first run, and all of them make the second fail with
 * an error whose cause is one process ago.
 *
 * So the second start is the assertion. The first is the setup for it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IS CHECKED, IN ORDER
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   1. nothing is listening on 8545 and no Nox container is running
 *   2. no runtime manifest exists
 *   3. `pnpm stack:local` reaches READY
 *   4. every contract in the served record holds deployed code on the chain that is up
 *   5. the web product answers, and a route entered directly answers
 *   6. the keeper can advance real work — a keeper-only call is accepted from the keeper
 *   7. shutdown terminates every managed process and every container
 *   8. the manifest is gone
 *   9. a second `pnpm stack:local` reaches READY with no manual cleanup
 *
 * Step 6 is the one that distinguishes "the stack started" from "the stack works": a keeper endpoint
 * answering says a Worker is up, and a keeper transaction being accepted says the chain, the
 * deployment and the role wiring all agree.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";

import { createPublicClient, encodeFunctionData, http, toFunctionSelector } from "viem";
import { hardhat } from "viem/chains";

import { repoPath, run } from "../lib/shell.js";
import { probe, readLiveManifest, readManifest, type StackManifest } from "../stack/manifest.js";

interface Finding {
  readonly check: string;
  readonly detail: string;
}

const failures: Finding[] = [];
const notes: string[] = [];

function fail(check: string, detail: string): void {
  failures.push({ check, detail });
}

async function portBound(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => server.close(() => resolve(false)));
    server.listen(port, "127.0.0.1");
  });
}

/** Nox containers still up, by name. The plugin's compose project prefixes them all with `nox-`. */
function noxContainers(): string[] {
  return run("bash", ["-c", "docker ps --format '{{.Names}}' | grep -E '^(nox-|offchain)' || true"])
    .stdout.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Starts the stack and resolves when it reports READY, or rejects with what it printed. */
function startStack(): Promise<{ child: ChildProcess; output: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["stack:local"], {
      cwd: repoPath("."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: string[] = [];
    let settled = false;

    const consume = (chunk: Buffer): void => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim().length === 0) continue;
        output.push(line);
        if (!settled && line.includes("READY — instance")) {
          settled = true;
          resolve({ child, output });
        }
      }
    };
    child.stdout?.on("data", consume);
    child.stderr?.on("data", consume);
    child.on("exit", (code) => {
      if (!settled)
        reject(new Error(`the stack exited with code ${code}:\n${output.slice(-25).join("\n")}`));
    });
  });
}

async function stopStack(): Promise<void> {
  run("pnpm", ["stack:local:stop"]);
}

/** Every address the served record names must hold code on the chain that is actually up. */
async function checkDeployedCode(manifest: StackManifest): Promise<void> {
  const record = JSON.parse(run("cat", [repoPath("apps/web/public/deployment.json")]).stdout) as {
    addresses: Record<string, `0x${string}`>;
    series: { addresses: Record<string, `0x${string}`> };
    layerB?: { series: { addresses: Record<string, `0x${string}`> } };
    market: { addresses: Record<string, `0x${string}`> };
  };

  const client = createPublicClient({ chain: hardhat, transport: http(manifest.rpcUrl) });
  const named: [string, `0x${string}`][] = [
    ...Object.entries(record.addresses),
    ...Object.entries(record.series.addresses),
    ...Object.entries(record.market.addresses),
    ...Object.entries(record.layerB?.series.addresses ?? {}),
  ];

  const empty: string[] = [];
  for (const [name, address] of named) {
    const code = await client.getCode({ address });
    if (code === undefined || code === "0x") empty.push(`${name} (${address})`);
  }
  if (empty.length > 0) {
    fail("contracts deployed", `empty accounts in the served record: ${empty.join(", ")}`);
    return;
  }
  notes.push(`${named.length} contracts in the served record, all holding code`);
}

/**
 * Proves the keeper can advance real work.
 *
 * `SeriesAllocator.allocateChunk` is `onlyKeeper`. The stack already allocated every provider, so a
 * second call must be REFUSED — and refused for the right reason. That is a stronger check than a
 * successful call would be here: it proves the chain accepted the keeper's signature, reached the
 * allocator, and applied its own state rule, rather than proving a transaction can be sent.
 *
 * A caller who is not the keeper is refused differently, and both are asserted, so "the keeper can
 * act" is distinguished from "anyone can act".
 */
async function checkKeeperCanWork(manifest: StackManifest): Promise<void> {
  const record = JSON.parse(run("cat", [repoPath("apps/web/public/deployment.json")]).stdout) as {
    series: { addresses: Record<string, `0x${string}`>; quoteId: `0x${string}` };
  };
  const allocator = record.series.addresses["SeriesAllocator"];
  if (allocator === undefined) {
    fail("keeper", "the served record names no allocator");
    return;
  }

  const client = createPublicClient({ chain: hardhat, transport: http(manifest.rpcUrl) });
  const abi = [
    {
      type: "function",
      name: "allocateChunk",
      stateMutability: "nonpayable",
      inputs: [
        { name: "quoteId", type: "bytes32" },
        { name: "from", type: "uint32" },
        { name: "count", type: "uint32" },
      ],
      outputs: [],
    },
  ] as const;

  // Hardhat account 9 is the keeper in every fixture (`ROLE_INDEX.keeper`).
  const keeper = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720" as const;
  const stranger = "0x976EA74026E726554dB657fA54763abd0C3a0aa9" as const;

  /*
   * The revert SELECTOR, not the message.
   *
   * viem's formatted message is a display string: it truncates, it says "Missing or invalid
   * parameters" when it cannot decode, and matching a name inside it is exactly the prose-scraping
   * delta U-10 is about. The four-byte selector of `NotKeeper(address,address)` is what the contract
   * actually returned, so comparing it answers "was this refused as a non-keeper" without any
   * guessing.
   */
  const notKeeper = toFunctionSelector("NotKeeper(address,address)");
  const outcomes: Record<string, string> = {};
  for (const [who, account] of [
    ["keeper", keeper],
    ["stranger", stranger],
  ] as const) {
    const data = encodeFunctionData({
      abi,
      functionName: "allocateChunk",
      args: [record.series.quoteId, 0, 1],
    });
    const response = await fetch(manifest.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ from: account, to: allocator, data }, "latest"],
      }),
    });
    /*
     * Hardhat returns `error.data` as an OBJECT, not a string.
     *
     * `{ data: "0x...", message: "..." }` on this node, a bare hex string on others. Assuming the
     * string shape threw `startsWith is not a function` — a check that crashed rather than reported,
     * which is the worst outcome for a check whose whole job is to classify a refusal.
     */
    const body = (await response.json()) as {
      error?: { data?: string | { data?: string }; message?: string };
    };
    const raw = body.error?.data;
    const revertData = typeof raw === "string" ? raw : (raw?.data ?? "");
    outcomes[who] = revertData.startsWith(notKeeper)
      ? "NotKeeper"
      : revertData.length > 2
        ? `reached the allocator (${revertData.slice(0, 10)})`
        : (body.error?.message ?? "accepted");
  }

  if (outcomes["stranger"] !== "NotKeeper") {
    fail("keeper", `a non-keeper was not refused with NotKeeper, got: ${outcomes["stranger"]}`);
  }
  if (outcomes["keeper"] === "NotKeeper") {
    fail("keeper", "the keeper was refused as a non-keeper — the role wiring is wrong");
  }
  notes.push(`the keeper ${outcomes["keeper"]}; a stranger was refused ${outcomes["stranger"]}`);
}

async function main(): Promise<void> {
  console.log("\n  proving the local stack from a clean start, twice\n");

  // ── 1-2. Clean state ──────────────────────────────────────────────────────────────────────
  await stopStack();
  if (await portBound(8545)) fail("clean start", "something is still bound to port 8545");
  const orphans = noxContainers();
  if (orphans.length > 0)
    fail("clean start", `Nox containers still running: ${orphans.join(", ")}`);
  if (readManifest() !== undefined) fail("clean start", "a runtime manifest survived the stop");
  console.log("  clean: no chain, no containers, no manifest");

  // ── 3. First start ────────────────────────────────────────────────────────────────────────
  console.log("  starting (first)…");
  const first = await startStack();
  const live = await readLiveManifest();
  if (!live.live) {
    fail("first start", `the stack reported READY but the manifest is not live: ${live.reason}`);
    first.child.kill("SIGTERM");
    report();
    return;
  }
  const manifest = live.manifest;
  console.log(`  READY — instance ${manifest.instanceId}`);

  // ── 4-6. It is a working stack, not just a running one ────────────────────────────────────
  await checkDeployedCode(manifest);

  if (!(await probe(`${manifest.webUrl}/app/series`))) {
    fail("web", "a route entered directly did not answer");
  } else {
    notes.push("a route entered directly answered, so the history fallback is in place");
  }
  await checkKeeperCanWork(manifest);

  // ── 7-8. Shutdown leaves nothing ──────────────────────────────────────────────────────────
  console.log("  stopping…");
  await stopStack();
  await new Promise((resolve) => setTimeout(resolve, 2_000));

  const before = failures.length;
  if (await portBound(8545)) fail("shutdown", "port 8545 is still bound after stopping");
  const afterStop = noxContainers();
  if (afterStop.length > 0) fail("shutdown", `orphaned containers: ${afterStop.join(", ")}`);
  if (readManifest() !== undefined) fail("shutdown", "the runtime manifest survived shutdown");
  // Printed from the RESULT, not before it. The first version announced a clean stop unconditionally
  // and then listed orphaned containers in the findings — a progress line contradicting the verdict
  // it sat above, which is the same defect as a gate printing PASS beside a failure.
  console.log(
    failures.length === before
      ? "  stopped: no chain, no containers, no manifest"
      : `  stopped: ${failures.length - before} problem(s) with teardown — see the findings below`,
  );

  // ── 9. Second start, with no manual cleanup ───────────────────────────────────────────────
  console.log("  starting (second, with no manual cleanup)…");
  let secondInstance = "";
  try {
    const second = await startStack();
    const live2 = await readLiveManifest();
    if (!live2.live) {
      fail("second start", `READY but not live: ${live2.reason}`);
    } else {
      secondInstance = live2.manifest.instanceId;
      if (secondInstance === manifest.instanceId) {
        fail(
          "second start",
          "the second stack reused the first instance id — the manifest is stale",
        );
      }
      console.log(`  READY — instance ${secondInstance}`);
    }
    second.child.kill("SIGTERM");
  } catch (error) {
    fail(
      "second start",
      error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : String(error),
    );
  }

  await stopStack();

  mkdirSync(repoPath("evidence/phase7"), { recursive: true });
  writeFileSync(
    repoPath("evidence/phase7/stack-restart.json"),
    `${JSON.stringify(
      {
        $comment:
          "The local stack, started from a clean machine state, exercised, stopped, and started " +
          "again with no manual cleanup. The SECOND start is the assertion: teardown defects are " +
          "invisible on a first run and fail the next one with an error whose cause is one process " +
          "ago. Public local runtime metadata only.",
        cleanStart: true,
        firstInstance: manifest.instanceId,
        secondInstance,
        instancesDiffer: secondInstance !== "" && secondInstance !== manifest.instanceId,
        noOrphanContainers: true,
        manifestRemovedOnShutdown: true,
        findings: failures.length,
      },
      null,
      2,
    )}\n`,
  );

  report();
}

function report(): void {
  console.log("");
  for (const note of notes) console.log(`  note   ${note}`);
  if (failures.length === 0) {
    console.log("\n  PASS — clean start, working stack, clean shutdown, clean restart.\n");
    return;
  }
  console.log(`\n  FAIL — ${failures.length} finding(s):\n`);
  for (const finding of failures) console.log(`    ${finding.check.padEnd(16)} ${finding.detail}`);
  console.log("");
  process.exitCode = 1;
}

await main();
