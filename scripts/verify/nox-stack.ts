/**
 * Proves the vendored Nox off-chain stack is byte-identical to what the pinned plugin ships.
 *
 * `confidential/nox-stack/` holds copies of `docker-compose.yml` and `dev.env` from
 * `@iexec-nox/nox-hardhat-plugin@0.1.0`, so the stack can be read, reasoned about and started
 * without reaching into `node_modules`. A copy that silently drifts from its source is worse than
 * no copy: it would document a stack nobody is actually running.
 *
 * This is also where the image pins are asserted. The stack's confidentiality guarantees come from
 * the KMS and the gateway, so a floating tag would mean the thing under test changed without any
 * commit saying so.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { readJson, repoPath } from "../lib/shell.js";

const VENDORED = "confidential/nox-stack";
const FILES = ["docker-compose.yml", "dev.env"] as const;

/** Image versions locked in `source-lock.json`, which `dev.env` must agree with. */
const VERSION_KEYS = [
  ["NOX_KMS_VERSION", "nox-kms"],
  ["NOX_HANDLE_GATEWAY_VERSION", "nox-handle-gateway"],
  ["NOX_INGESTOR_VERSION", "nox-ingestor"],
  ["NOX_RUNNER_VERSION", "nox-runner"],
] as const;

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function pluginStackDirectory(): string {
  // The plugin's `exports` map exposes only its entry point, so the package directory is located
  // from a file it does export rather than by guessing at a node_modules layout.
  const require = createRequire(repoPath("confidential/package.json"));
  const entry = require.resolve("@iexec-nox/nox-hardhat-plugin");
  // dist/src/index.js -> package root
  return resolve(dirname(entry), "..", "..", "offchain-services");
}

function main(): void {
  const source = pluginStackDirectory();
  if (!existsSync(source)) {
    console.error(
      `verify:nox-stack FAIL — the pinned plugin has no offchain-services at ${source}`,
    );
    process.exitCode = 1;
    return;
  }

  const drift: string[] = [];
  const hashes: Record<string, string> = {};

  for (const file of FILES) {
    const vendoredPath = repoPath(VENDORED, file);
    const sourcePath = resolve(source, file);
    if (!existsSync(vendoredPath)) {
      drift.push(`${file}: missing from ${VENDORED}`);
      continue;
    }
    const vendoredHash = sha256(vendoredPath);
    const sourceHash = sha256(sourcePath);
    hashes[file] = vendoredHash;
    if (vendoredHash !== sourceHash) {
      drift.push(
        `${file}: vendored ${vendoredHash.slice(0, 16)}… but the plugin ships ${sourceHash.slice(0, 16)}…`,
      );
    }
  }

  // The image pins must match the source lock, so the stack under test is the stack recorded.
  const lock = readJson<{
    spikes: { nox: { noxServiceImages: Record<string, string> } };
  }>(repoPath("source-lock.json"));
  const locked = lock.spikes.nox.noxServiceImages;

  const env = existsSync(repoPath(VENDORED, "dev.env"))
    ? readFileSync(repoPath(VENDORED, "dev.env"), "utf8")
    : "";
  const pins: string[] = [];
  for (const [key, image] of VERSION_KEYS) {
    const match = env.match(new RegExp(`^${key}=(.+)$`, "m"));
    const version = match?.[1]?.trim();
    const expected = locked[image];
    if (version === undefined) {
      drift.push(`dev.env: ${key} is absent`);
      continue;
    }
    if (version !== expected) {
      drift.push(`${image}: dev.env pins ${version}, source-lock.json records ${expected}`);
      continue;
    }
    pins.push(`${image}@${version}`);
  }

  console.log("verify:nox-stack\n");
  for (const [file, hash] of Object.entries(hashes)) {
    console.log(`  ${file.padEnd(20)} sha256 ${hash}`);
  }
  console.log(`  images               ${pins.join(", ")}`);

  if (drift.length > 0) {
    console.error("\nverify:nox-stack FAIL — the vendored stack has drifted\n");
    for (const entry of drift) console.error(`  ${entry}`);
    console.error(
      "\n  Re-copy from the pinned plugin and record the change, or change the pin. A vendored\n" +
        "  copy that no longer matches its source documents a stack nobody runs.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("\nverify:nox-stack PASS — vendored copy identical to the pinned plugin");
  console.log("  all four service images pinned and matching source-lock.json");
}

main();
