/**
 * Slither, scoped and triaged.
 *
 * A raw Slither run over this repository reports ~814 results, and almost all of them are in
 * `forge-std`, the vendored Midnight core, or Kyrve's own test and script files. Reporting that
 * number would be worse than not running it: it invites either a blanket suppression or a habit of
 * ignoring the output.
 *
 * So this scopes to the contracts Kyrve actually deploys and asks a narrower question — does
 * Slither find anything of High or Medium impact in code that will hold value?
 *
 * Test and script contracts are excluded ON PURPOSE and the exclusion is reported, not hidden.
 * `vm.prank`-driven test helpers legitimately do things (unchecked calls, uninitialised locals)
 * that would be defects in production, and mixing them in makes the real signal unfindable.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";

import { repoPath, run } from "../lib/shell.js";

/** Contracts Kyrve deploys. Everything else is out of scope and said to be. */
const IN_SCOPE = [
  "contracts/kyrve/",
  "contracts/registry/",
  "contracts/integration/KyrveExactFillVault.sol",
  "contracts/integration/KyrveQuoteRatifier.sol",
  "contracts/integration/KyrveQuoteBinding.sol",
  "contracts/integration/TestERC20.sol",
  "contracts/integration/FixedPriceOracle.sol",
];

/** Anything under these is deliberately out of scope. */
const OUT_OF_SCOPE = [
  "vendor/",
  "contracts/kyrve/test/",
  "contracts/test/",
  "contracts/integration/test/",
  "contracts/script/",
  "contracts/integration/LocalMidnightFixture.sol",
];

const BLOCKING_IMPACTS = new Set(["High", "Medium"]);

interface SlitherElement {
  source_mapping?: { filename_relative?: string };
}

interface SlitherDetector {
  check: string;
  impact: string;
  confidence: string;
  description: string;
  elements?: SlitherElement[];
}

interface SlitherOutput {
  success: boolean;
  results?: { detectors?: SlitherDetector[] };
}

function filesOf(detector: SlitherDetector): string[] {
  return (detector.elements ?? [])
    .map((e) => e.source_mapping?.filename_relative ?? "")
    .filter((f) => f.length > 0);
}

function isInScope(detector: SlitherDetector): boolean {
  const files = filesOf(detector);
  if (files.length === 0) return false;
  // In scope only if it touches a deployed contract and does NOT originate in excluded code.
  const touchesScope = files.some((f) => IN_SCOPE.some((p) => f.startsWith(p)));
  const primary = files[0] ?? "";
  const primaryExcluded = OUT_OF_SCOPE.some((p) => primary.startsWith(p));
  return touchesScope && !primaryExcluded;
}

function main(): void {
  const jsonPath = repoPath("slither-report.json");
  rmSync(jsonPath, { force: true });

  console.log("running slither (foundry compilation)...\n");
  run("slither", [".", "--foundry-compile-all", "--json", jsonPath], { allowFailure: true });

  if (!existsSync(jsonPath)) {
    console.error("slither produced no JSON report");
    process.exitCode = 1;
    return;
  }

  const report = JSON.parse(readFileSync(jsonPath, "utf8")) as SlitherOutput;
  const all = report.results?.detectors ?? [];
  const scoped = all.filter(isInScope);

  const byImpact = new Map<string, SlitherDetector[]>();
  for (const detector of scoped) {
    const list = byImpact.get(detector.impact) ?? [];
    list.push(detector);
    byImpact.set(detector.impact, list);
  }

  console.log(`  total detector results        : ${all.length}`);
  console.log(`  in scope (deployed contracts) : ${scoped.length}`);
  console.log(
    `  out of scope, by design       : vendor/, contracts/test/, contracts/script/, fixtures`,
  );
  console.log("");

  for (const impact of ["High", "Medium", "Low", "Informational", "Optimization"]) {
    const list = byImpact.get(impact) ?? [];
    if (list.length === 0) continue;
    console.log(`  ${impact.padEnd(14)} ${list.length}`);
    for (const detector of list) {
      const files = [...new Set(filesOf(detector))].slice(0, 2).join(", ");
      console.log(
        `    - [${detector.check}] ${detector.description.trim().split("\n")[0]?.slice(0, 110)}`,
      );
      console.log(`      ${files}  (confidence ${detector.confidence})`);
    }
  }

  const blocking = scoped.filter((d) => BLOCKING_IMPACTS.has(d.impact));

  rmSync(jsonPath, { force: true });

  if (blocking.length > 0) {
    console.error(
      `\nverify:slither FAILED — ${blocking.length} High/Medium impact finding(s) in deployed contracts.\n` +
        "Triage each individually. Blanket suppressions are not acceptable.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nverify:slither PASS — 0 High/Medium impact findings in the ${IN_SCOPE.length} deployed contract paths`,
  );
}

main();
