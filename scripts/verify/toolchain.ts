/**
 * Verifies the running toolchain matches `toolchain-lock.json`.
 *
 * Never rely on a globally installed tool version without recording it: a Foundry or solc that
 * differs from the pin produces different bytecode, which silently invalidates every recorded
 * hash and every deployment manifest.
 */

import { readFileSync } from "node:fs";

import { readJson, repoPath, run } from "../lib/shell.js";

interface ToolchainLock {
  runtime: { node: { version: string; minimum: string }; pnpm: { version: string } };
  solidity: { kyrveContracts: { version: string; evmVersion: string; optimizerRuns: number } };
  foundry: { forge: string; commit: string };
  tooling: { vitest: string; biome: string; tsx: string };
  typescript: { version: string };
  cloudflare: { wrangler: string; compatibilityDate: string };
}

interface Check {
  readonly name: string;
  readonly expected: string;
  readonly actual: string;
  /** A version that may legitimately be newer, e.g. Node against a documented minimum. */
  readonly minimumOnly?: boolean;
}

function firstMatch(text: string, pattern: RegExp): string {
  return text.match(pattern)?.[1]?.trim() ?? "(not found)";
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function main(): void {
  const lock = readJson<ToolchainLock>(repoPath("toolchain-lock.json"));
  const rootPkg = JSON.parse(readFileSync(repoPath("package.json"), "utf8")) as {
    packageManager: string;
    devDependencies: Record<string, string>;
  };
  const foundryToml = readFileSync(repoPath("foundry.toml"), "utf8");
  const nvmrc = readFileSync(repoPath(".nvmrc"), "utf8").trim();

  const checks: Check[] = [
    {
      name: "node (>= documented minimum)",
      expected: lock.runtime.node.minimum,
      actual: process.version.replace(/^v/, ""),
      minimumOnly: true,
    },
    { name: ".nvmrc", expected: lock.runtime.node.version, actual: nvmrc },
    {
      name: "pnpm (packageManager)",
      expected: `pnpm@${lock.runtime.pnpm.version}`,
      actual: rootPkg.packageManager,
    },
    {
      name: "forge",
      expected: lock.foundry.forge,
      actual: firstMatch(run("forge", ["--version"]).stdout, /forge Version:\s*([0-9.]+)/),
    },
    {
      name: "forge commit",
      expected: lock.foundry.commit,
      actual: firstMatch(run("forge", ["--version"]).stdout, /Commit SHA:\s*([0-9a-f]+)/),
    },
    {
      name: "solc (foundry.toml)",
      expected: lock.solidity.kyrveContracts.version,
      actual: firstMatch(foundryToml, /solc_version\s*=\s*"([^"]+)"/),
    },
    {
      name: "evm_version (foundry.toml)",
      expected: lock.solidity.kyrveContracts.evmVersion,
      actual: firstMatch(foundryToml, /evm_version\s*=\s*"([^"]+)"/),
    },
    {
      name: "optimizer_runs (foundry.toml)",
      expected: String(lock.solidity.kyrveContracts.optimizerRuns),
      actual: firstMatch(foundryToml, /optimizer_runs\s*=\s*(\d+)/),
    },
    {
      name: "typescript",
      expected: lock.typescript.version,
      actual: rootPkg.devDependencies["typescript"] ?? "(absent)",
    },
    {
      name: "vitest",
      expected: lock.tooling.vitest,
      actual: rootPkg.devDependencies["vitest"] ?? "(absent)",
    },
    {
      name: "biome",
      expected: lock.tooling.biome,
      actual: rootPkg.devDependencies["@biomejs/biome"] ?? "(absent)",
    },
    {
      name: "tsx",
      expected: lock.tooling.tsx,
      actual: rootPkg.devDependencies["tsx"] ?? "(absent)",
    },
  ];

  const failures = checks.filter((c) =>
    c.minimumOnly === true ? compareSemver(c.actual, c.expected) < 0 : c.actual !== c.expected,
  );

  for (const check of checks) {
    const ok = failures.includes(check) ? "FAIL" : "ok  ";
    const relation = check.minimumOnly === true ? ">=" : "==";
    console.log(
      `  ${ok} ${check.name.padEnd(28)} ${relation} ${check.expected.padEnd(44)} actual ${check.actual}`,
    );
  }

  // No caret, tilde or range may appear anywhere in the workspace.
  //
  // `workspace:*` is EXCLUDED, and it is not an exception being carved out. The `workspace:`
  // protocol resolves to the package in this repository at the path pnpm already knows; there is
  // no registry lookup and nothing to drift, so it is exact in the only sense that matters here.
  // Treating its `*` as a version range flagged `@kyrve/config`, `@kyrve/curve` and `@kyrve/nox`
  // — the three packages whose contents are pinned by being in the commit.
  const ranges = Object.entries(rootPkg.devDependencies)
    .filter(([, v]) => !v.startsWith("workspace:"))
    .filter(([, v]) => /[\^~]|\*|\bx\b/.test(v));
  if (ranges.length > 0) {
    console.error(
      `\n  FAIL inexact dependency pins: ${ranges.map(([k, v]) => `${k}@${v}`).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  if (failures.length > 0) {
    console.error(`\nverify:toolchain FAILED — ${failures.length} mismatch(es)`);
    process.exitCode = 1;
    return;
  }

  console.log(`verify:toolchain PASS — ${checks.length} pins match, all dependencies exact`);
}

main();
