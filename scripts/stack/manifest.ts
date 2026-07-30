/**
 * The local stack's runtime manifest: `.runtime/local-stack.json`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ONE PROCESS DISCOVERS THE GATEWAY PORT, AND EVERYONE ELSE READS IT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The Nox handle gateway's host port is assigned by Docker at startup. The Hardhat plugin discovers
 * it — `startOffchainServices` asks compose for the published port and puts it in
 * `NOX_HANDLE_GATEWAY_HOST_PORT` — and that environment variable exists only inside the Hardhat
 * process.
 *
 * Before this file, every consumer rediscovered it: the browser tests called `handleGatewayUrl()`
 * because they ran inside that process, and nothing outside it could. Letting each service guess
 * would give five answers that agree until the day Docker picks a different port for one of them.
 *
 * So the stack host owns discovery, publishes once, and everything else waits for this file.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT MAY BE IN IT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * PUBLIC LOCAL RUNTIME METADATA ONLY. Ports, URLs on localhost, chain id, paths to deployment
 * records, process ids, a startup timestamp and an instance id.
 *
 * No private key. No API key. No decrypted value. No external provider endpoint. `writeManifest`
 * refuses a manifest that contains any of those rather than trusting the caller, because this file
 * is the one artefact of the stack that outlives the process that wrote it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * A STALE MANIFEST IS WORSE THAN A MISSING ONE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A missing manifest says "no stack". A manifest from a stack that died says "here is a gateway"
 * and points at a port that is either closed or — much worse — has been reused by the NEXT stack,
 * so a consumer talks to a gateway belonging to a different chain and every handle it asks about is
 * simply unknown.
 *
 * `readLiveManifest` therefore checks three things, in order: the file parses, the orchestrator pid
 * is still alive, and the endpoints it names actually answer. Any one failing makes the manifest
 * stale, and stale is reported as absent.
 *
 * The `instanceId` exists for the case the pid check cannot catch: a second stack started after the
 * first one's pid was recycled. A consumer that captured an instance id at the start of its run can
 * assert the stack it finishes against is the stack it started against.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { repoPath } from "../lib/shell.js";

export const MANIFEST_PATH = repoPath(".runtime/local-stack.json");

export interface StackService {
  readonly name: string;
  /** Localhost only. A manifest naming an external host would be a credential leak waiting to happen. */
  readonly url: string;
  /** The path that answers when the service is healthy. */
  readonly health: string;
  /** Present when the orchestrator owns the process directly. Absent for Docker-managed services. */
  readonly pid?: number;
}

export interface StackManifest {
  /** Bumped when the shape changes, so an old manifest is rejected rather than misread. */
  readonly version: 1;
  /** Distinguishes two stacks whose orchestrator pids happen to collide after recycling. */
  readonly instanceId: string;
  readonly startedAt: string;
  /** The orchestrator. Liveness of this pid is the first staleness check. */
  readonly orchestratorPid: number;
  /** The Hardhat child that owns the chain, the Nox stack and the deployments. */
  readonly hostPid: number;

  readonly chainId: number;
  readonly rpcUrl: string;
  readonly noxGatewayUrl: string;
  readonly noxComputeAddress: `0x${string}`;

  readonly webUrl: string;
  readonly apiUrl: string;

  /** Repository-relative paths to the records the stack wrote. Paths, never contents. */
  readonly deploymentRecords: readonly string[];

  readonly services: readonly StackService[];
}

/** Values that must never appear in the manifest, checked rather than assumed. */
const FORBIDDEN = [
  /"0x[0-9a-fA-F]{64}"/, // a 32-byte private key, quoted
  /\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\b/, // a token-shaped string
  /alchemy\.com|infura\.io|quicknode|ankr\.com|etherscan\.io/i,
] as const;

/**
 * Refuses a manifest carrying something it must not.
 *
 * A 32-byte hex string is the shape of a private key AND the shape of a handle, so this is
 * deliberately strict: nothing in a runtime manifest needs either. Deployment records are referenced
 * by PATH, and a consumer that wants a handle reads the record.
 */
export function assertManifestIsPublic(serialised: string): void {
  for (const pattern of FORBIDDEN) {
    const match = pattern.exec(serialised);
    if (match !== null) {
      throw new Error(
        `refusing to write the runtime manifest: it contains ${match[0].slice(0, 24)}…, which ` +
          "matches a key, token or external-provider pattern. The manifest carries public local " +
          "runtime metadata only — deployment records are referenced by path, never inlined.",
      );
    }
  }
  for (const url of [...serialised.matchAll(/"(https?:\/\/[^"]+)"/g)].map((match) => match[1])) {
    if (url === undefined) continue;
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new Error(
        `refusing to write the runtime manifest: it names ${host}, which is not localhost. This ` +
          "file describes a LOCAL stack; an external endpoint in it is either wrong or a credential.",
      );
    }
  }
}

/**
 * Writes the manifest atomically.
 *
 * Temporary file then `rename`, which is atomic within a filesystem. A consumer polling this path
 * therefore sees either the previous manifest or the complete new one, never a half-written object —
 * and "wait for the manifest" is only a safe instruction if that is true.
 */
export function writeManifest(manifest: StackManifest): void {
  const serialised = `${JSON.stringify(manifest, null, 2)}\n`;
  assertManifestIsPublic(serialised);

  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  const temporary = `${MANIFEST_PATH}.${process.pid}.tmp`;
  writeFileSync(temporary, serialised, "utf8");
  renameSync(temporary, MANIFEST_PATH);
}

export function removeManifest(): void {
  rmSync(MANIFEST_PATH, { force: true });
}

/** Parses the manifest, or nothing. Does not check liveness — see {@link readLiveManifest}. */
export function readManifest(): StackManifest | undefined {
  if (!existsSync(MANIFEST_PATH)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as StackManifest;
    return parsed.version === 1 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a process is still running, without signalling it. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export type Staleness =
  | { readonly live: true; readonly manifest: StackManifest }
  | { readonly live: false; readonly reason: string };

/**
 * The manifest, only if the stack it describes is actually running.
 *
 * Three checks in increasing cost: parse, pid, endpoints. A consumer gets `live: false` with the
 * reason rather than a manifest it would then have to validate itself — which is how one consumer
 * ends up trusting a stale file because it forgot the third check.
 */
export async function readLiveManifest(): Promise<Staleness> {
  const manifest = readManifest();
  if (manifest === undefined) {
    return { live: false, reason: "no runtime manifest — the local stack is not running" };
  }
  if (!pidAlive(manifest.orchestratorPid)) {
    return {
      live: false,
      reason:
        `the manifest names orchestrator pid ${manifest.orchestratorPid}, which is not running. ` +
        "It is stale: run `pnpm stack:local:stop` to clear it, then `pnpm stack:local`.",
    };
  }
  if (!pidAlive(manifest.hostPid)) {
    return {
      live: false,
      reason:
        `the manifest names chain host pid ${manifest.hostPid}, which is not running. The chain and ` +
        "the Nox stack are gone even though the orchestrator is not.",
    };
  }

  for (const service of manifest.services) {
    if (!(await probe(`${service.url}${service.health}`))) {
      return {
        live: false,
        reason: `${service.name} does not answer at ${service.url}${service.health}`,
      };
    }
  }

  return { live: true, manifest };
}

/** One health probe. Any answer at all counts — a 404 proves something is listening. */
export async function probe(url: string, timeoutMs = 2_000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** A JSON-RPC probe, because an RPC node answering `eth_chainId` is a stronger claim than a socket. */
export async function probeChainId(rpcUrl: string, timeoutMs = 2_000): Promise<number | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: controller.signal,
    });
    const body = (await response.json()) as { result?: string };
    return body.result === undefined ? undefined : Number(BigInt(body.result));
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
