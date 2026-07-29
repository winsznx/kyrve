/**
 * Checks the repository against `source-lock.json`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE DID NOT EXIST UNTIL NOW
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `package.json` has carried a `verify:source-lock` script since Day 0 pointing at
 * `scripts/verify/source-lock.ts`, and that file was never written. Running it produced
 * `ERR_MODULE_NOT_FOUND`, and nothing noticed because no gate invoked it — Phase 1 and Phase 2 both
 * omitted it from their gate lists. A verification command that has never been run is worse than a
 * missing one: it appears in the script list, it looks like coverage, and it proves nothing.
 * Recorded as delta R-11.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * It checks that the pins recorded in `source-lock.json` are the pins the repository actually
 * installs and compiles against — the four Nox packages, viem, wrangler, the Midnight submodule
 * commit, and the chain and NoxCompute addresses the confidential layer targets.
 *
 * It does NOT re-retrieve anything from a registry or a chain. `source-lock.json` records what was
 * verified live on 2026-07-28 with the reproduction commands in `docs/day0/SOURCE-LOCK.md`, and
 * re-deriving it here would replace a recorded, dated, reproducible fact with whatever the network
 * happens to say today — which is the opposite of a lock. This asks one question: has the
 * repository drifted from what was locked?
 */

import { existsSync, readFileSync } from "node:fs";

import { NOX_COMPUTE_BY_CHAIN } from "@kyrve/config";

import { readJson, repoPath, run } from "../lib/shell.js";

interface SourceLock {
  chain: { chainId: number; activeFork: string };
  morphoMidnight: { pinnedCommit: string; compiler: { primary: string } };
  nox: {
    deployment: { chainId: number; noxComputeProxy: string };
    packages: Record<string, { version: string }>;
  };
  viem: { version: string };
  cloudflare: { wrangler: { version: string } };
  toolchain: { pnpm: string };
}

interface Check {
  readonly what: string;
  readonly expected: string;
  readonly actual: string;
}

/**
 * The installed version of a package, read from the lockfile rather than from `node_modules`.
 *
 * ANCHORED ON BOTH SIDES, and the first attempt was not — which made `viem` match
 * `@nomicfoundation/hardhat-viem@3.0.9` and `hardhat-toolbox-viem@5.0.7` and report drift that did
 * not exist. A lock check that cries wolf gets disabled, so the pattern requires the name to start
 * at a path or whitespace boundary and to be followed by the `:` or `(` that ends a lockfile key.
 */
function lockfileVersion(name: string): string {
  const lockfile = readFileSync(repoPath("pnpm-lock.yaml"), "utf8");
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const matches = [
    ...lockfile.matchAll(
      // Scoped names are QUOTED in a pnpm lockfile — `  '@iexec-nox/handle@0.1.0-beta.13':` — so
      // the quote counts as a boundary on both sides. Leaving it out reported every scoped
      // package as absent, which is the same kind of false alarm in the opposite direction.
      new RegExp(`(?:^|[\\s/'])${escaped}@([0-9][^:\\s('"]*)(?=['(:])`, "gm"),
    ),
  ];
  const versions = new Set(matches.map((match) => match[1] ?? ""));
  if (versions.size === 0) return "(not in lockfile)";
  // More than one resolution means two versions coexist, which a lock is meant to prevent.
  return [...versions].sort().join(" AND ");
}

function main(): void {
  const lock = readJson<SourceLock>(repoPath("source-lock.json"));
  const checks: Check[] = [];

  for (const [name, pin] of Object.entries(lock.nox.packages)) {
    checks.push({ what: name, expected: pin.version, actual: lockfileVersion(name) });
  }
  checks.push({ what: "viem", expected: lock.viem.version, actual: lockfileVersion("viem") });
  checks.push({
    what: "wrangler",
    expected: lock.cloudflare.wrangler.version,
    actual: lockfileVersion("wrangler"),
  });

  // The Midnight submodule must be at the pinned commit. Changing the pin is its own commit that
  // also updates this file — never a silent submodule bump.
  const vendorPath = repoPath("vendor/midnight");
  const submodule = existsSync(vendorPath)
    ? run("git", ["-C", vendorPath, "rev-parse", "HEAD"], { allowFailure: true }).stdout.trim()
    : "(submodule not initialised)";
  checks.push({
    what: "vendor/midnight commit",
    expected: lock.morphoMidnight.pinnedCommit,
    actual: submodule || "(submodule not initialised)",
  });

  // The NoxCompute address the confidential layer targets must be the one that was verified live.
  checks.push({
    what: `NoxCompute on chain ${lock.nox.deployment.chainId}`,
    expected: lock.nox.deployment.noxComputeProxy.toLowerCase(),
    actual: (NOX_COMPUTE_BY_CHAIN[lock.nox.deployment.chainId] ?? "(unknown)").toLowerCase(),
  });

  const packageManager = readJson<{ packageManager: string }>(
    repoPath("package.json"),
  ).packageManager;
  checks.push({
    what: "pnpm (packageManager)",
    expected: `pnpm@${lock.toolchain.pnpm}`,
    actual: packageManager,
  });

  console.log(`verify:source-lock — against source-lock.json\n`);
  const failures: Check[] = [];
  for (const check of checks) {
    const ok = check.actual === check.expected;
    if (!ok) failures.push(check);
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${check.what.padEnd(42)} ${check.expected.padEnd(46)} actual ${check.actual}`,
    );
  }

  if (failures.length > 0) {
    console.error(`\nverify:source-lock FAIL — ${failures.length} pin(s) drifted\n`);
    for (const failure of failures) {
      console.error(`  ${failure.what}: locked ${failure.expected}, installed ${failure.actual}`);
    }
    console.error(
      "\n  When a pin changes on purpose, update source-lock.json and docs/day0/SOURCE-LOCK.md in\n" +
        "  the SAME commit, with the reproduction command that establishes the new value.\n",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nverify:source-lock PASS — ${checks.length} pins match what was locked`);
  console.log(
    `  chain ${lock.chain.chainId} on ${lock.chain.activeFork}, Midnight at ${lock.morphoMidnight.compiler.primary}`,
  );
  console.log("  NOT RE-RETRIEVED HERE: this compares against the recorded lock, it does not");
  console.log("  re-derive it from a registry or a chain. See docs/day0/SOURCE-LOCK.md.");
}

main();
