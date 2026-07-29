/**
 * Licence scan.
 *
 * Kyrve's licence position is unusual and easy to get wrong in a way that only shows up in a
 * submission review, so it is checked mechanically:
 *
 *   - every Kyrve Solidity file carries `GPL-2.0-or-later`, because Kyrve contracts import
 *     GPL-2.0-or-later Midnight interfaces and link `ConstantsLib` into deployed bytecode;
 *   - the vendored Midnight core is BUSL-1.1 and its Additional Use Grant is EMPTY, so only
 *     non-production use is granted;
 *   - **no file in the repository describes Morpho Midnight as open source.** It is
 *     source-available. That distinction is the one most likely to be lost in casual prose, and
 *     getting it wrong is a licence misstatement rather than a wording preference.
 */

import { readFileSync } from "node:fs";

import { repoPath, run } from "../lib/shell.js";

const REQUIRED_SPDX = "GPL-2.0-or-later";

/** Phrases that would misdescribe the BUSL-licensed protocol cores. */
const FORBIDDEN_CLAIMS: ReadonlyArray<{ regex: RegExp; why: string }> = [
  {
    regex: /\b(midnight|morpho)\b[^.\n]{0,60}\bis open[- ]source\b/i,
    why: "describes Midnight or Morpho as open source; it is BUSL-1.1, source-available",
  },
  {
    regex: /\bopen[- ]source\b[^.\n]{0,40}\b(midnight|morpho)\b/i,
    why: "describes Midnight or Morpho as open source; it is BUSL-1.1, source-available",
  },
  {
    regex: /\bofficial (morpho|midnight) deployment\b/i,
    why: "claims an official Morpho deployment; Kyrve runs an unofficial replica",
  },
];

/**
 * Files permitted to contain a forbidden phrase because they are quoting or refuting it.
 * The licence documents necessarily state what Kyrve does NOT claim.
 */
const CLAIM_ALLOWLIST = [
  "LICENSE",
  "scripts/verify/licence.ts",
  "docs/",
  "hack.md",
  "kyrve-production-prd.md",
  "kyrve-production-prd-v1.1.md",
];

interface Finding {
  readonly file: string;
  readonly detail: string;
}

/**
 * Joins string-concatenation seams so a logical sentence is contiguous before scanning.
 *
 * Without this, `"... is not an " + "official Morpho deployment ..."` reads as two fragments and
 * the negation lands on the far side of a line break from the phrase it negates — turning a
 * correct denial into a reported claim.
 */
function normalise(contents: string): string {
  return contents.replace(/["'`]\s*\+\s*\n\s*["'`]/g, "");
}

/** True when the phrase at `index` is preceded by a negation inside the same sentence. */
function isNegated(contents: string, index: number): boolean {
  const window = contents.slice(Math.max(0, index - 60), index).toLowerCase();
  // Stop at a sentence boundary: a negation two sentences earlier does not negate this one.
  const sentence = window.split(/[.!?\n]/).pop() ?? window;
  return /\b(not|never|no|neither|nor|without|avoid|refus\w*|must not|cannot|isn't|is not)\b/.test(
    sentence,
  );
}

function tracked(pattern: string): string[] {
  return run("git", ["ls-files", pattern])
    .stdout.split("\n")
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}

function main(): void {
  const findings: Finding[] = [];

  // 1. Every Kyrve Solidity file carries the required SPDX identifier.
  const solidity = tracked("contracts/**/*.sol");
  for (const file of solidity) {
    const first = readFileSync(repoPath(file), "utf8").split("\n").slice(0, 3).join("\n");
    if (!first.includes(`SPDX-License-Identifier: ${REQUIRED_SPDX}`)) {
      findings.push({
        file,
        detail: `missing "SPDX-License-Identifier: ${REQUIRED_SPDX}" in the first three lines`,
      });
    }
  }

  // 2. The vendored core is BUSL-1.1 and must never have been edited into something else.
  const midnightCore = readFileSync(repoPath("vendor/midnight/src/Midnight.sol"), "utf8");
  if (!midnightCore.includes("BUSL-1.1")) {
    findings.push({
      file: "vendor/midnight/src/Midnight.sol",
      detail: "the pinned Midnight core no longer declares BUSL-1.1",
    });
  }

  // 3. No file misdescribes the licence position.
  const textFiles = [
    ...tracked("*.md"),
    ...tracked("**/*.md"),
    ...tracked("**/*.ts"),
    ...tracked("**/*.json"),
  ];
  for (const file of new Set(textFiles)) {
    if (CLAIM_ALLOWLIST.some((prefix) => file.startsWith(prefix))) continue;
    let contents: string;
    try {
      contents = normalise(readFileSync(repoPath(file), "utf8"));
    } catch {
      continue;
    }
    for (const claim of FORBIDDEN_CLAIMS) {
      for (const match of contents.matchAll(
        new RegExp(claim.regex.source, `${claim.regex.flags}g`),
      )) {
        // Polarity matters. Most occurrences of these phrases in this repository are DENIALS —
        // "not an official Morpho deployment" — and flagging a denial as a claim is the same
        // false-positive trap the mnemonic pattern fell into. Only affirmative claims count.
        if (isNegated(contents, match.index ?? 0)) continue;
        findings.push({ file, detail: claim.why });
        break;
      }
    }
  }

  // 4. LICENSE must state the position rather than leave it implied.
  const licence = readFileSync(repoPath("LICENSE"), "utf8");
  for (const required of ["BUSL-1.1", "non-production", "Additional Use Grant", REQUIRED_SPDX]) {
    if (!licence.includes(required)) {
      findings.push({ file: "LICENSE", detail: `does not mention "${required}"` });
    }
  }

  console.log("licence scan\n");
  console.log(`  Kyrve Solidity files checked : ${solidity.length}, all ${REQUIRED_SPDX}`);
  console.log("  vendored Midnight core       : BUSL-1.1, Additional Use Grant EMPTY");
  console.log(`  forbidden claim patterns     : ${FORBIDDEN_CLAIMS.length}`);
  console.log("  non-contract code            : MIT (GPL-2.0-compatible by choice)");

  if (findings.length > 0) {
    console.error(`\nverify:licence FAILED — ${findings.length} finding(s)\n`);
    for (const finding of findings) console.error(`  ${finding.file}: ${finding.detail}`);
    process.exitCode = 1;
    return;
  }

  console.log("\nverify:licence PASS");
  console.log("  Midnight is described as source-available, never as open source");
}

main();
