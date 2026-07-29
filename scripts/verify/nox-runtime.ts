/**
 * Runs the Nox runtime compatibility suite against the real local Nox stack.
 *
 * This suite is the drift detector for a dependency that moves underneath us: published
 * `nox-protocol-contracts@0.2.4` lags repository HEAD, the deployed testnet implementations lag
 * both, and the handle SDK is a beta with an unpublished breaking redesign already on main. The
 * only way to know Kyrve's assumptions still hold is to execute them.
 *
 * NOTHING ON THE NOX PATH IS MOCKED. The stack is the plugin-managed `nox-kms`,
 * `nox-handle-gateway`, `nox-ingestor` and `nox-runner` images plus NATS JetStream and MinIO.
 *
 * Opt-in via `KYRVE_NOX_RUNTIME=true`, because bringing the stack up takes minutes and pulls
 * multi-gigabyte images. It is not skipped silently: the Phase 1 gate reports it as SKIPPED with
 * this reason and the command that runs it.
 */

import { existsSync } from "node:fs";

import { readJson, repoPath, run } from "../lib/shell.js";

/** Pinned image tags. A tag change is a compatibility event, not an implementation detail. */
const EXPECTED_IMAGES = {
  "iexechub/nox-kms": "0.6.0",
  "iexechub/nox-handle-gateway": "0.6.0",
  "iexechub/nox-ingestor": "0.6.0",
  "iexechub/nox-runner": "0.6.0",
} as const;

interface SourceLock {
  nox: { packages: Record<string, { version: string }> };
  spikes: { nox: { noxServiceImages: Record<string, string> } };
}

function main(): void {
  const enabled = process.env["KYRVE_NOX_RUNTIME"] === "true";

  const lock = readJson<SourceLock>(repoPath("source-lock.json"));

  // Package pins are checkable without Docker, so they are always checked.
  const failures: string[] = [];
  for (const [image, tag] of Object.entries(EXPECTED_IMAGES)) {
    const shortName = image.replace("iexechub/", "");
    const recorded = lock.spikes.nox.noxServiceImages[shortName];
    if (recorded !== tag) {
      failures.push(
        `service image ${image} pinned at ${tag} but source-lock records ${recorded ?? "(absent)"}`,
      );
    }
  }

  const suitePath = repoPath("spikes/nox/test");
  if (!existsSync(suitePath)) {
    failures.push("spikes/nox/test is missing; the Nox compatibility suite has no source");
  }

  if (failures.length > 0) {
    console.error("verify:nox-runtime FAILED\n");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log("  package pins:");
  for (const [name, entry] of Object.entries(lock.nox.packages)) {
    console.log(`    ${name.padEnd(42)} ${entry.version}`);
  }
  console.log("  service images:");
  for (const [image, tag] of Object.entries(EXPECTED_IMAGES)) {
    console.log(`    ${image.padEnd(42)} ${tag}`);
  }

  if (!enabled) {
    console.log(
      "\nverify:nox-runtime SKIPPED the executable half.\n" +
        "  Pins verified against source-lock.json, but no encrypted operation was executed.\n" +
        "  Bringing the stack up takes minutes and pulls multi-gigabyte images, so it is opt-in:\n" +
        "    KYRVE_NOX_RUNTIME=true pnpm verify:nox-runtime",
    );
    return;
  }

  const docker = run("docker", ["info"], { allowFailure: true });
  if (docker.code !== 0) {
    console.error("Docker is not running; the local Nox stack cannot start.");
    process.exitCode = 1;
    return;
  }

  console.log("\n  starting the local Nox stack and executing the suite (this takes minutes)...");
  const result = run("pnpm", ["exec", "hardhat", "test"], {
    cwd: repoPath("spikes/nox"),
    allowFailure: true,
  });

  const passing = result.stdout.match(/(\d+)\s+passing/)?.[1];
  const failing = result.stdout.match(/(\d+)\s+failing/)?.[1];

  if (result.code !== 0) {
    console.error(`\nverify:nox-runtime FAILED — ${failing ?? "?"} failing`);
    console.error(result.stdout.split("\n").slice(-40).join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nverify:nox-runtime PASS — ${passing ?? "?"} tests executed against the real stack`,
  );
}

main();
