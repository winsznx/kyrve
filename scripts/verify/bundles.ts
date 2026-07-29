/**
 * Inspects every built Worker bundle.
 *
 * Day 0 proved viem runs under `workerd` once. This re-proves it on every run, because the thing
 * that breaks it is a dependency bump, not a code change — and the failure mode is a bundle that
 * builds cleanly and then throws at the edge on first request.
 *
 * Four checks, each with a specific reason:
 *
 *   1. `[unenv] ... is not implemented yet!` — unenv stubs a Node API it cannot polyfill. The stub
 *      throws when called, so this is a runtime landmine that a successful build hides.
 *   2. residual `node:` imports — nothing outside `nodejs_compat`'s supported set may survive.
 *   3. `viem/node` — IPC and filesystem only. It does not exist under workerd.
 *   4. secret values — the last line of defence against a credential being inlined into a bundle
 *      that is about to be published.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

import { loadEnv } from "../lib/env.js";
import { repoPath, run } from "../lib/shell.js";

const WORKERS = ["api", "indexer", "keeper", "status"] as const;

/** Node built-ins that `nodejs_compat` does NOT provide, so their presence is a real failure. */
const FORBIDDEN_NODE_IMPORTS = [
  "node:fs",
  "node:child_process",
  "node:worker_threads",
  "node:cluster",
  "node:dgram",
  "node:v8",
  "node:vm",
  "node:repl",
];

/** viem's node-only surface. Importing it is a deploy-time failure, not a build-time one. */
const VIEM_NODE_MARKERS = ["viem/node", "getIpcRpcClient", "mainnetTrustedSetupPath"];

interface Finding {
  readonly worker: string;
  readonly check: string;
  readonly detail: string;
}

function bundleFiles(worker: string): string[] {
  const dist = repoPath(`workers/${worker}/dist`);
  if (!existsSync(dist)) return [];
  return readdirSync(dist)
    .filter((f) => f.endsWith(".js"))
    .map((f) => `${dist}/${f}`);
}

function secretValues(): Array<{ name: string; value: string }> {
  loadEnv();
  const names = [
    "ALCHEMY_API_KEY",
    "DEPLOYER_PRIVATE_KEY",
    "ETHERSCAN_API_KEY",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "NOX_GATEWAY_URL",
  ];
  return names
    .map((name) => ({ name, value: (process.env[name] ?? "").trim() }))
    .filter((entry) => entry.value.length >= 12);
}

function main(): void {
  console.log("Building Worker bundles (dry-run: publishes nothing, needs no account)...\n");
  for (const worker of WORKERS) {
    run("pnpm", ["--filter", `@kyrve/worker-${worker}`, "dry-run"]);
  }

  const findings: Finding[] = [];
  const secrets = secretValues();
  let totalBytes = 0;

  for (const worker of WORKERS) {
    const files = bundleFiles(worker);
    if (files.length === 0) {
      findings.push({ worker, check: "bundle present", detail: "no dist/*.js produced" });
      continue;
    }

    let workerBytes = 0;
    for (const file of files) {
      workerBytes += statSync(file).size;
      const source = readFileSync(file, "utf8");

      if (source.includes("is not implemented yet!")) {
        findings.push({
          worker,
          check: "unenv stub",
          detail:
            "bundle contains an unenv stub that throws when called. The build succeeds and the " +
            "Worker fails at the edge on first request.",
        });
      }

      for (const forbidden of FORBIDDEN_NODE_IMPORTS) {
        if (source.includes(`"${forbidden}"`) || source.includes(`'${forbidden}'`)) {
          findings.push({
            worker,
            check: "node builtin",
            detail: `${forbidden} survives in the bundle`,
          });
        }
      }

      for (const marker of VIEM_NODE_MARKERS) {
        if (source.includes(marker)) {
          findings.push({
            worker,
            check: "viem/node",
            detail: `${marker} is present; viem's node-only surface does not exist under workerd`,
          });
        }
      }

      for (const secret of secrets) {
        if (source.includes(secret.value)) {
          findings.push({
            worker,
            check: "secret inlined",
            // The value itself is never printed, only which variable leaked.
            detail: `the value of ${secret.name} is inlined in the bundle`,
          });
        }
      }
    }

    totalBytes += workerBytes;
    console.log(
      `  ${worker.padEnd(9)} ${files.length} file(s), ${(workerBytes / 1024).toFixed(2)} KiB`,
    );
  }

  console.log(`\n  checked ${WORKERS.length} bundles, ${(totalBytes / 1024).toFixed(2)} KiB total`);
  console.log(`  secret values compared: ${secrets.length}`);

  if (findings.length > 0) {
    console.error(`\nverify:bundles FAILED — ${findings.length} finding(s)\n`);
    for (const finding of findings) {
      console.error(`  [${finding.worker}] ${finding.check}: ${finding.detail}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("\nverify:bundles PASS");
  console.log("  0 unenv stubs, 0 forbidden node: builtins, viem/node absent, 0 secrets inlined");
}

main();
