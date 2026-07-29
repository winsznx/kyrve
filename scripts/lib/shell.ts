import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, derived from this file rather than from the working directory. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function repoPath(...parts: string[]): string {
  return resolve(REPO_ROOT, ...parts);
}

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/**
 * Runs a command and throws on failure with the captured output.
 *
 * Deliberately not a thin wrapper: a verification script that swallows a non-zero exit code turns
 * a failed check into a silent pass, which is the exact failure mode these scripts exist to
 * prevent.
 */
export function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; allowFailure?: boolean } = {},
): RunResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`failed to run ${command}: ${result.error.message}`);
  }

  const outcome: RunResult = {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? -1,
  };

  if (outcome.code !== 0 && options.allowFailure !== true) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${outcome.code}\n--- stdout ---\n${outcome.stdout}\n--- stderr ---\n${outcome.stderr}`,
    );
  }

  return outcome;
}

/** Starts a long-running process and returns a handle plus a kill function. */
export function startBackground(
  command: string,
  args: string[],
): { kill: () => void; pid: number | undefined } {
  const child = spawn(command, args, { cwd: REPO_ROOT, stdio: "ignore", detached: false });
  return {
    pid: child.pid,
    kill: () => {
      if (!child.killed) child.kill("SIGTERM");
    },
  };
}

export async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  { timeoutMs = 30_000, intervalMs = 250, description = "condition" } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for ${description}` +
      (lastError instanceof Error ? `: ${lastError.message}` : ""),
  );
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function keccakLikeSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Stable stringify: sorted keys, so a regenerated artifact diffs only on real changes. */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortDeep(v)]),
    );
  }
  return value;
}
