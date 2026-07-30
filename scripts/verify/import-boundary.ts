/**
 * Enforces the source-isolation rule PRD v1.1 A-15 makes mandatory.
 *
 * Only `packages/nox` may depend on iExec Nox. Everything else — every other package, every
 * worker, every app, every script — must go through that adapter, so a breaking upstream change
 * is a one-package fix rather than a repository-wide one. Nox is version-skewed in every
 * direction: no mainnet, a beta handle SDK, an unpublished breaking redesign already on the
 * plugin's main branch, published contracts lagging repository HEAD, deployed testnet
 * implementations lagging both, and two testnets running different versions and KMS keys.
 *
 * A rule nobody checks is a comment. This is the check.
 */

import { readFileSync } from "node:fs";

import { REPO_ROOT, run } from "../lib/shell.js";

interface Boundary {
  readonly label: string;
  /** Import specifiers that are forbidden outside the allowed paths. */
  readonly forbidden: readonly RegExp[];
  /** Repository-relative path prefixes permitted to break the rule. */
  readonly allowedPrefixes: readonly string[];
  readonly reason: string;
}

const BOUNDARIES: readonly Boundary[] = [
  {
    label: "iExec Nox",
    forbidden: [/@iexec-nox\//, /\bencrypted-types\b/],
    allowedPrefixes: [
      // The adapter itself.
      "packages/nox/",
      // Contracts legitimately import the MIT Solidity SDK; that is the other half of the boundary.
      "contracts/",
      "confidential/contracts/",
      // Test and build INFRASTRUCTURE for the confidential layer. `@iexec-nox/nox-hardhat-plugin`
      // boots the real Nox Docker stack, which is the only way to test against real handles and
      // real gateway proofs; it ships nowhere and appears in no bundle. Note what is NOT listed:
      // `confidential/scripts/` is product code and goes through @kyrve/nox like everything else.
      "confidential/hardhat.config.ts",
      "confidential/test/",
      // The local stack host, for the same reason and under the same terms. It runs under
      // `hardhat test`, ships nowhere, appears in no bundle, and imports exactly one symbol:
      // `handleGatewayUrl`, whose value the plugin sets in that process's environment and which
      // nothing outside the process can otherwise see. Reading the raw env var instead would have
      // satisfied this check by duplicating the plugin's own contract, which is the version skew
      // this boundary exists to prevent rather than a way around it.
      "confidential/stack/",
      // Frozen Day 0 evidence, which must keep reproducing exactly as recorded.
      "spikes/",
    ],
    reason:
      "Route it through @kyrve/nox. Nox is version-skewed across the SDK, the plugin, the published " +
      "contracts and both testnets, so every touchpoint lives in one package (PRD v1.1 A-15).",
  },
  {
    label: "viem node-only surface",
    forbidden: [/from ["']viem\/node["']/],
    allowedPrefixes: [],
    reason:
      "viem/node is IPC and filesystem only and does not exist under workerd. Importing it breaks " +
      "the Worker bundle at deploy time rather than at build time.",
  },
];

interface Violation {
  readonly boundary: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

function trackedFiles(): string[] {
  return run("git", ["ls-files", "*.ts", "*.tsx", "*.sol"])
    .stdout.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function main(): void {
  const files = trackedFiles();
  const violations: Violation[] = [];

  for (const file of files) {
    // node_modules is never tracked, so every file here is repository source.
    const allowedFor = BOUNDARIES.filter(
      (b) => !b.allowedPrefixes.some((prefix) => file.startsWith(prefix)),
    );
    if (allowedFor.length === 0) continue;

    const contents = readFileSync(`${REPO_ROOT}/${file}`, "utf8");
    const lines = contents.split("\n");

    for (const boundary of allowedFor) {
      for (const [index, text] of lines.entries()) {
        // Only import/require lines count; a mention in a comment is documentation, not a
        // dependency, and this file itself must be able to name what it forbids.
        if (!/^\s*(import|export)\b|require\(/.test(text)) continue;
        if (boundary.forbidden.some((pattern) => pattern.test(text))) {
          violations.push({
            boundary: boundary.label,
            file,
            line: index + 1,
            text: text.trim(),
            reason: boundary.reason,
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error(`import-boundary: ${violations.length} violation(s)\n`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}`);
      console.error(`    ${v.text}`);
      console.error(`    forbidden outside the ${v.boundary} adapter. ${v.reason}\n`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`import-boundary: ${files.length} tracked source files, 0 violations`);
  for (const boundary of BOUNDARIES) {
    const scope =
      boundary.allowedPrefixes.length === 0
        ? "forbidden everywhere"
        : `permitted only under ${boundary.allowedPrefixes.join(", ")}`;
    console.log(`  ${boundary.label}: ${scope}`);
  }
}

main();
