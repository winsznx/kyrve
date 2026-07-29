/**
 * Phase 2 demonstration 15 — no private value reaches a log, an API payload, a test snapshot or a
 * repository file.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY A SCAN AND NOT A PROMISE
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * "Decrypted values stay client-side" is the invariant a confidential product is most likely to
 * break by accident and least likely to notice: one `console.log` while debugging, one error
 * message that interpolates an amount, one test snapshot committed with real output. None of those
 * fails a test. All of them are permanent once pushed.
 *
 * So this runs two independent checks, and both must pass.
 *
 *   EMPIRICAL. `confidential/test/private-fixtures.json` holds the plaintext the Phase 2 suite
 *   actually encrypts, submits and decrypts against the real Nox stack. Those exact strings are
 *   searched for across every tracked and untracked file in the repository, plus the captured
 *   output of the suite itself. The values are high-entropy on purpose: a scan for a round number
 *   would match unrelated bytes and prove nothing.
 *
 *   STRUCTURAL. The empirical half can only catch values that happen to have been decrypted during
 *   a run. So the code is checked too: `@kyrve/nox` must contain no logging and no network sink on
 *   the decryption path, and no Worker may import the client at all. A leak that never fires in a
 *   test is still a leak.
 *
 * The one permitted appearance is the fixture file itself, which is where the scanner learns what
 * to look for. It is reported explicitly rather than silently skipped.
 */

import { existsSync, readFileSync, statSync } from "node:fs";

import { REPO_ROOT, repoPath, run } from "../lib/shell.js";

interface Fixtures {
  readonly $scanned: readonly string[];
  readonly $notScanned: { readonly reason: string; readonly fields: readonly string[] };
}

const FIXTURE_FILE = "confidential/test/private-fixtures.json";

/** Files allowed to contain the fixtures, with the reason each one is allowed. */
const PERMITTED: readonly { readonly path: string; readonly reason: string }[] = [
  { path: FIXTURE_FILE, reason: "the fixture definition the scanner reads its needles from" },
];

/** Binary and generated paths where a byte-level match would be meaningless. */
const SKIP_PREFIXES = [
  "node_modules/",
  ".git/",
  "vendor/",
  "out/",
  "cache/",
  "artifacts/",
  "dist/",
  "public/",
  "spikes/",
];

const SKIP_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".pdf",
  ".pyc",
];

interface Finding {
  readonly file: string;
  readonly needle: string;
  readonly line: number;
  readonly excerpt: string;
}

function candidateFiles(): string[] {
  const tracked = run("git", ["ls-files"]).stdout.split("\n");
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard"]).stdout.split("\n");

  return [...new Set([...tracked, ...untracked])]
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((file) => !SKIP_PREFIXES.some((prefix) => file.startsWith(prefix)))
    .filter((file) => !SKIP_EXTENSIONS.some((extension) => file.endsWith(extension)));
}

function scanFile(file: string, needles: readonly string[]): Finding[] {
  const absolute = file.startsWith("/") ? file : `${REPO_ROOT}/${file}`;
  if (!existsSync(absolute)) return [];
  const stats = statSync(absolute);
  if (!stats.isFile() || stats.size > 8 * 1024 * 1024) return [];

  let contents: string;
  try {
    contents = readFileSync(absolute, "utf8");
  } catch {
    return [];
  }
  // A quick reject before splitting a large file into lines.
  if (!needles.some((needle) => contents.includes(needle))) return [];

  const findings: Finding[] = [];
  const lines = contents.split("\n");
  for (const [index, text] of lines.entries()) {
    for (const needle of needles) {
      if (text.includes(needle)) {
        findings.push({
          file,
          needle,
          line: index + 1,
          excerpt: text.trim().slice(0, 160),
        });
      }
    }
  }
  return findings;
}

/** Sinks that would move a decrypted value out of the caller's process. */
const FORBIDDEN_SINKS: readonly { readonly pattern: RegExp; readonly what: string }[] = [
  { pattern: /\bconsole\s*\./, what: "console output" },
  { pattern: /\bfetch\s*\(/, what: "a network call" },
  { pattern: /writeFileSync|writeFile\b|appendFile/, what: "a file write" },
  { pattern: /localStorage|sessionStorage|indexedDB/, what: "browser storage" },
];

interface StructuralFinding {
  readonly file: string;
  readonly line: number;
  readonly what: string;
  readonly excerpt: string;
}

/**
 * The decryption path must have no way to emit a value.
 *
 * `client.ts` is the only module in the workspace that ever holds plaintext. `fetch` is permitted
 * in `runtime.ts`, which polls handle READINESS and never sees a value; it is not permitted here.
 */
function scanDecryptionPath(): StructuralFinding[] {
  const file = "packages/nox/src/client.ts";
  const findings: StructuralFinding[] = [];
  const lines = readFileSync(repoPath(file), "utf8").split("\n");

  let inBlockComment = false;
  for (const [index, raw] of lines.entries()) {
    const text = raw.trim();
    if (inBlockComment) {
      if (text.includes("*/")) inBlockComment = false;
      continue;
    }
    if (text.startsWith("/*")) {
      if (!text.includes("*/")) inBlockComment = true;
      continue;
    }
    if (text.startsWith("//") || text.startsWith("*")) continue;

    for (const sink of FORBIDDEN_SINKS) {
      if (sink.pattern.test(text)) {
        findings.push({ file, line: index + 1, what: sink.what, excerpt: text.slice(0, 160) });
      }
    }
  }
  return findings;
}

/** No server-side component may import the client half of the adapter. */
function scanServerImports(): StructuralFinding[] {
  const findings: StructuralFinding[] = [];
  const serverPrefixes = ["workers/", "scripts/"];
  const files = candidateFiles().filter(
    (file) =>
      serverPrefixes.some((prefix) => file.startsWith(prefix)) &&
      (file.endsWith(".ts") || file.endsWith(".tsx")) &&
      !file.includes("/test/") &&
      file !== "scripts/verify/privacy-scan.ts",
  );

  for (const file of files) {
    const lines = readFileSync(repoPath(file), "utf8").split("\n");
    for (const [index, raw] of lines.entries()) {
      const text = raw.trim();
      if (!/^\s*(import|export)\b|require\(/.test(text)) continue;
      if (/createHandleClient|encryptMandate|encryptRequest/.test(text)) {
        findings.push({
          file,
          line: index + 1,
          what: "a server component importing the authorised-client decryption path",
          excerpt: text.slice(0, 160),
        });
      }
    }
  }
  return findings;
}

function main(): void {
  const fixturePath = repoPath(FIXTURE_FILE);
  if (!existsSync(fixturePath)) {
    console.error(`privacy-scan: ${FIXTURE_FILE} is missing. There is nothing to scan for, which`);
    console.error("  is not a pass — the scanner cannot know what the suite decrypted.");
    process.exitCode = 1;
    return;
  }

  const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixtures;
  const needles = fixtures.$scanned;
  if (needles.length === 0) {
    console.error("privacy-scan: the fixture file lists no values to scan for.");
    process.exitCode = 1;
    return;
  }

  // Extra paths supplied by the caller — in practice the captured output of the confidential
  // suite, which is where a stray `console.log` of a decrypted value would land first and which is
  // not a repository file at all.
  const extra = process.argv.slice(2).filter((argument) => !argument.startsWith("-"));
  const files = [...candidateFiles(), ...extra];
  const permittedPaths = new Set(PERMITTED.map((entry) => entry.path));

  const leaks: Finding[] = [];
  let permittedHits = 0;
  for (const file of files) {
    const findings = scanFile(file, needles);
    if (permittedPaths.has(file)) {
      permittedHits += findings.length;
      continue;
    }
    leaks.push(...findings);
  }

  const structural = [...scanDecryptionPath(), ...scanServerImports()];

  console.log(`privacy scan over ${files.length} tracked and untracked files\n`);
  console.log(`  private values searched for        : ${needles.length}`);
  console.log(`  permitted appearances (fixture)    : ${permittedHits}`);
  console.log(`  leaks found                        : ${leaks.length}`);
  console.log(`  structural violations              : ${structural.length}`);
  console.log(`  not scanned by value               : ${fixtures.$notScanned.fields.join(", ")}`);
  console.log(`    ${fixtures.$notScanned.reason}\n`);

  for (const entry of PERMITTED) {
    console.log(`  permitted: ${entry.path} — ${entry.reason}`);
  }

  if (leaks.length > 0) {
    console.error("\nprivacy-scan FAIL — a private value appears outside the fixture file\n");
    for (const leak of leaks) {
      console.error(`  ${leak.file}:${leak.line}  contains ${leak.needle}`);
      console.error(`    ${leak.excerpt}`);
    }
    console.error(
      "\n  A decrypted value must never reach a server, log, metric, database column, analytics " +
        "event, error message or committed file. See .claude/rules/security.md.",
    );
    process.exitCode = 1;
    return;
  }

  if (structural.length > 0) {
    console.error("\nprivacy-scan FAIL — the decryption path can emit a value\n");
    for (const finding of structural) {
      console.error(`  ${finding.file}:${finding.line}  ${finding.what}`);
      console.error(`    ${finding.excerpt}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("\nprivacy-scan PASS");
  console.log("  no private value outside the fixture file");
  console.log("  the decryption path holds no console, fetch, file or storage sink");
  console.log("  no Worker or script imports the authorised-client decryption path");
}

main();
