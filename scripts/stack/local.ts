/**
 * `pnpm stack:local` — the whole local product, from one command.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IT STARTS, AND WHO OWNS WHAT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   the Hardhat chain, NoxCompute, the Nox KMS, gateway, ingestor and runner,
 *   the unmodified Midnight substrate, two complete Kyrve issuance stacks,
 *   the Capsule vault, the Cross book and the Roll book
 *                                          ← all owned by ONE Hardhat child, `confidential/stack/host.ts`
 *
 *   the API, indexer, keeper and status Workers          ← `wrangler dev --local`, one child each
 *   the web product, built and previewed                 ← `vite preview` over `dist`
 *
 * The split is deliberate. Everything that needs the chain and the Docker stack lives in one child,
 * because the plugin's `test` override is the proven path that starts them and — critically — the
 * `finally` that tears them down. Splitting the chain from the Docker stack would mean writing a
 * second implementation of the most delicate part of the system.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE GATEWAY PORT HAS EXACTLY ONE SOURCE OF TRUTH
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Docker assigns it. `startOffchainServices` discovers it and puts it in the host child's
 * environment. The host prints it on one sentinel-prefixed JSON line, this orchestrator reads that
 * line and writes it into `.runtime/local-stack.json`, and every other consumer reads the manifest.
 *
 * Nothing rediscovers it. Five services each asking Docker would agree until the day one of them
 * asked a moment later than a restart, and then one consumer would be talking to a gateway that
 * belongs to a different chain — where every handle is simply unknown, which reads as a protocol
 * failure rather than as a configuration one.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * READY MEANS HEALTH-CHECKED, NOT SPAWNED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The manifest is written only after every endpoint answers, and the command does not print READY
 * before that. A consumer that raced a spawn would find the web server up and the chain still
 * mining the deployment, which is the most confusing possible failure: everything looks running and
 * every read is wrong.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * FAILURE AND SHUTDOWN ARE THE SAME PATH
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Any required child exiting tears the whole stack down, and so does Ctrl+C. Both run `shutdown()`,
 * which SIGTERMs the host first — the host resolves rather than exits, so the plugin's `finally`
 * runs `docker compose down` — waits, then force-kills anything left and sweeps compose directly as
 * a backstop. A partial stack is worse than no stack: it answers.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

import { repoPath, run } from "../lib/shell.js";
import { sweepCompose } from "./compose.js";
import {
  MANIFEST_PATH,
  probe,
  probeChainId,
  readLiveManifest,
  readManifest,
  removeManifest,
  type StackManifest,
  type StackService,
  writeManifest,
} from "./manifest.js";

const READY_SENTINEL = "@@KYRVE-STACK-READY@@";

/** Fixed local ports. A stack whose ports moved between runs would need discovery for all of them. */
const PORTS = {
  chain: 8545,
  web: 4173,
  api: 8788,
  indexer: 8789,
  keeper: 8790,
  status: 8791,
} as const;

interface HostPayload {
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly noxGatewayUrl: string;
  readonly noxComputeAddress: `0x${string}`;
  readonly hostPid: number;
  readonly sourceSeriesId: `0x${string}`;
  readonly targetSeriesId: `0x${string}`;
  readonly sourceQuoteId: `0x${string}`;
  readonly capsuleVault: `0x${string}`;
  readonly crossBook: `0x${string}`;
  readonly rollBook: `0x${string}`;
}

interface Managed {
  readonly name: string;
  readonly child: ChildProcess;
  /** A required child exiting tears the stack down. An optional one is reported and tolerated. */
  readonly required: boolean;
  /**
   * The last lines the child printed.
   *
   * Kept because the first version of this orchestrator discarded worker output entirely, and the
   * first real failure was `keeper exited (code 1)` with nothing else — a message that says a child
   * died and gives no way to find out why. A child whose failure is unattributable is worse than one
   * that fails loudly, because the operator's only move is to run it by hand and hope it fails again.
   */
  readonly tail: string[];
}

const managed: Managed[] = [];
let shuttingDown = false;

function log(message: string): void {
  console.log(`[stack] ${message}`);
}

/**
 * Signals a child's whole process group.
 *
 * The negative pid is the group. Allowed to fail: by the time the second pass runs the group is
 * usually already gone, and `ESRCH` on a process that has exited is the success case rather than an
 * error worth reporting.
 */
function signalGroup(entry: Managed, signal: NodeJS.Signals): void {
  if (entry.child.pid === undefined) return;
  try {
    process.kill(-entry.child.pid, signal);
  } catch {
    // already gone
  }
}

async function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Refuses to start on top of something already running.
 *
 * A stale manifest is cleared rather than treated as fatal — it is the normal residue of a crash,
 * and making the operator delete a file by hand teaches them to delete it without reading it. A
 * LIVE stack is fatal: two stacks would fight over port 8545 and over one compose project.
 */
async function preflight(): Promise<void> {
  try {
    run("docker", ["info"]);
  } catch {
    throw new Error(
      "Docker is not running. The Nox KMS, gateway, ingestor and runner are containers, and a " +
        "mocked NoxCompute would be a mocked confidentiality path.",
    );
  }

  const existing = await readLiveManifest();
  if (existing.live) {
    throw new Error(
      `a local stack is already running (instance ${existing.manifest.instanceId}, orchestrator pid ` +
        `${existing.manifest.orchestratorPid}). Run \`pnpm stack:local:stop\` first.`,
    );
  }
  if (readManifest() !== undefined) {
    log(`clearing a stale manifest: ${existing.live ? "" : existing.reason}`);
    removeManifest();
  }

  for (const [name, port] of Object.entries(PORTS)) {
    if (!(await portFree(port))) {
      throw new Error(
        `port ${port} (${name}) is already bound. Something from a previous run is still up — ` +
          "`pnpm stack:local:stop` sweeps the Docker stack, but a stray `vite` or `wrangler` has to " +
          "be stopped by whoever started it.",
      );
    }
  }
}

/** Spawns a child, registers it for teardown, and tears the stack down if a required one dies. */
function start(
  name: string,
  command: string,
  args: string[],
  options: { cwd: string; required: boolean },
): ChildProcess {
  /*
   * `detached: true` puts each child in its own PROCESS GROUP, and that is not a detail.
   *
   * Every child here is launched through `npx`, which is an intermediate process that spawns the
   * real one. SIGTERM to the child reaps `npx` and leaves `vite` or `wrangler` running — measured:
   * after a clean-looking shutdown, port 4173 was still bound by a `vite preview` whose parent had
   * exited. The orphan then failed the NEXT start with a bound-port error whose cause was one
   * process ago, which is exactly the failure mode the restart proof exists to catch.
   *
   * With a group, `process.kill(-pid, signal)` signals the whole tree.
   */
  const child = spawn(command, args, {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    detached: true,
  });
  const entry: Managed = { name, child, required: options.required, tail: [] };
  managed.push(entry);

  // Drained AND kept. An undrained pipe eventually blocks the child; a discarded one loses the
  // only evidence of why it stopped.
  const keep = (chunk: Buffer): void => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim().length === 0) continue;
      entry.tail.push(line);
      if (entry.tail.length > 40) entry.tail.shift();
    }
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (!options.required) return;
    console.error(
      `\n[stack] ${name} exited (code ${code}, signal ${signal}) — tearing the stack down`,
    );
    for (const line of entry.tail.slice(-20)) console.error(`  ${name} │ ${line}`);
    void shutdown(1);
  });
  return child;
}

/**
 * Starts the chain host and waits for the one line only it can produce.
 *
 * The host's stdout is streamed to this process's stderr as well as scanned, because the deployment
 * it performs takes minutes and a silent terminal during that is indistinguishable from a hang.
 */
async function startHost(): Promise<HostPayload> {
  log("starting the chain, the Nox stack and two complete issuance stacks (this takes minutes)");
  const child = start("chain host", "npx", ["hardhat", "test", "stack/host.ts"], {
    cwd: repoPath("confidential"),
    required: true,
  });

  return new Promise<HostPayload>((resolve, reject) => {
    let buffered = "";
    let settled = false;

    const onLine = (line: string): void => {
      if (settled || !line.startsWith(READY_SENTINEL)) return;
      settled = true;
      try {
        resolve(JSON.parse(line.slice(READY_SENTINEL.length).trim()) as HostPayload);
      } catch (error) {
        reject(
          new Error(`the host announced readiness with an unparseable payload: ${String(error)}`),
        );
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString();
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith(READY_SENTINEL)) onLine(line);
        else if (line.trim().length > 0) process.stderr.write(`  host │ ${line}\n`);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) =>
      process.stderr.write(`  host │ ${chunk.toString()}`),
    );

    child.on("exit", (code) => {
      if (!settled)
        reject(new Error(`the chain host exited with code ${code} before announcing readiness`));
    });
  });
}

/** Starts one Worker under `wrangler dev --local`. No account, no network, no secret. */
/**
 * Starts one Worker under `wrangler dev --local`, and waits for it before starting the next.
 *
 * No account, no network, no secret: D1 and R2 are bound to local miniflare state.
 *
 * Sequential rather than concurrent, deliberately. Four `wrangler dev` processes racing each other
 * through their first compile contend for CPU and produce a failure attributed to whichever lost —
 * and the keeper, which is the heaviest because it carries a Durable Object and a Workflow, is
 * always the one that loses. Serialising costs a few seconds and makes every failure name its own
 * service.
 */
async function startWorker(name: string, directory: string, port: number): Promise<void> {
  start(name, "npx", ["wrangler", "dev", "--local", "--port", String(port), "--ip", "127.0.0.1"], {
    cwd: repoPath(`workers/${directory}`),
    required: true,
  });
  await waitForHealth(name, `http://127.0.0.1:${port}/health`);
  log(`  ${name} ready`);
}

async function waitForHealth(name: string, url: string, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe(url)) return;
    if (Date.now() > deadline) throw new Error(`${name} never answered at ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function main(): Promise<void> {
  await preflight();

  const instanceId = randomUUID();
  const startedAt = new Date().toISOString();

  process.once("SIGINT", () => void shutdown(0));
  process.once("SIGTERM", () => void shutdown(0));

  const host = await startHost();
  log(`chain ${host.chainId} up, Nox gateway on ${host.noxGatewayUrl}`);

  const chainId = await probeChainId(host.rpcUrl);
  if (chainId !== host.chainId) {
    throw new Error(`the node answers chain ${chainId}, but the host announced ${host.chainId}`);
  }
  await waitForHealth("the Nox handle gateway", `${host.noxGatewayUrl}/health`, 60_000);

  /**
   * The bundle is built AFTER the host, on purpose.
   *
   * The host writes `apps/web/public/deployment.json`, and `vite build` copies `public/` into
   * `dist/`. Building first would preview a bundle carrying the previous stack's addresses — a
   * terminal confidently displaying a balance from a deployment that no longer exists, which is the
   * exact failure the record's `cache: "no-store"` and the boot refusal exist to prevent.
   */
  log("building the web bundle against the record the host just wrote");
  run("pnpm", ["--filter", "@kyrve/web", "build"]);

  start("web", "npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(PORTS.web)], {
    cwd: repoPath("apps/web"),
    required: true,
  });
  log("starting the Workers, one at a time so a failure names its own service");
  await startWorker("api", "api", PORTS.api);
  await startWorker("indexer", "indexer", PORTS.indexer);
  await startWorker("keeper", "keeper", PORTS.keeper);
  await startWorker("status", "status", PORTS.status);

  const services: StackService[] = [
    { name: "chain", url: host.rpcUrl, health: "/" },
    { name: "nox-gateway", url: host.noxGatewayUrl, health: "/health" },
    { name: "web", url: `http://127.0.0.1:${PORTS.web}`, health: "/" },
    { name: "api", url: `http://127.0.0.1:${PORTS.api}`, health: "/health" },
    { name: "indexer", url: `http://127.0.0.1:${PORTS.indexer}`, health: "/health" },
    { name: "keeper", url: `http://127.0.0.1:${PORTS.keeper}`, health: "/health" },
    { name: "status", url: `http://127.0.0.1:${PORTS.status}`, health: "/health" },
  ];

  /*
   * Every service, checked once more as a set.
   *
   * The Workers were gated as they started, so most of this is a re-check — and that is the point:
   * READY means every endpoint answered at the same moment, not that each one answered at some
   * point during startup. A worker that came up and fell over while the next was starting would
   * otherwise be reported ready.
   */
  log("re-checking every service as a set");
  for (const service of services) {
    await waitForHealth(service.name, `${service.url}${service.health}`, 60_000);
  }

  const manifest: StackManifest = {
    version: 1,
    instanceId,
    startedAt,
    orchestratorPid: process.pid,
    hostPid: host.hostPid,
    chainId: host.chainId,
    rpcUrl: host.rpcUrl,
    noxGatewayUrl: host.noxGatewayUrl,
    noxComputeAddress: host.noxComputeAddress,
    webUrl: `http://127.0.0.1:${PORTS.web}`,
    apiUrl: `http://127.0.0.1:${PORTS.api}`,
    deploymentRecords: ["apps/web/public/deployment.json", "deployments/local/confidential.json"],
    services,
  };
  writeManifest(manifest);

  console.log("");
  log(`READY — instance ${instanceId}`);
  log(`  web       ${manifest.webUrl}`);
  log(`  api       ${manifest.apiUrl}`);
  log(`  rpc       ${manifest.rpcUrl}`);
  log(`  gateway   ${manifest.noxGatewayUrl}`);
  log(`  manifest  ${MANIFEST_PATH}`);
  log("Ctrl+C stops everything, including the Docker stack.");
  console.log("");

  // Nothing further to do. The process stays alive holding its children until a signal arrives.
  await new Promise(() => undefined);
}

/**
 * Tears everything down, in the order that leaves nothing behind.
 *
 * The host first and with time to finish: SIGTERM makes it resolve rather than exit, so the plugin's
 * `finally` runs `docker compose down --volumes --remove-orphans`. Killing it outright would leave
 * six containers up, and the next start would fail on a port that is still bound — a failure whose
 * cause is one process ago.
 *
 * The compose sweep at the end is a backstop for the case where the host was already gone.
 */
async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("");
  log("stopping");

  removeManifest();

  /*
   * The host is signalled by PID, not by group — the opposite of every other child.
   *
   * Its whole teardown depends on the Node process running its own SIGTERM handler, which resolves
   * the promise the test is blocked on and lets the plugin's `finally` run `docker compose down`. A
   * group signal reaches the `npx` shell and the node process at once and kills the node outright,
   * so the `finally` never runs and six containers survive. Measured: the restart proof reported
   * `offchain-services-nox-*` still up after a shutdown that looked clean.
   *
   * The group kill below is the escalation, once the orderly path has had its chance.
   */
  const host = managed.find((entry) => entry.name === "chain host");
  if (host !== undefined && host.child.exitCode === null) {
    host.child.kill("SIGTERM");
    const deadline = Date.now() + 120_000;
    while (host.child.exitCode === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (host.child.exitCode === null) {
      log("the chain host did not stop in time; killing its group and sweeping Docker directly");
      signalGroup(host, "SIGKILL");
    }
  }

  for (const entry of managed) {
    if (entry.name === "chain host") continue;
    signalGroup(entry, "SIGTERM");
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  for (const entry of managed) {
    signalGroup(entry, "SIGKILL");
  }

  sweepCompose();
  log("stopped");
  process.exit(code);
}

await main().catch(async (error: unknown) => {
  console.error(`\n[stack] ${error instanceof Error ? error.message : String(error)}\n`);
  await shutdown(1);
});
