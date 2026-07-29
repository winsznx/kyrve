/**
 * Secret scan over everything git can see.
 *
 * Two complementary passes, because either alone leaves a gap:
 *
 *   1. **Known-value scan.** Reads the real values from `.env` and checks whether any of them
 *      appears in a tracked or untracked file. This catches the exact leak that matters — the
 *      owner's actual credentials — and cannot be fooled by an unusual format.
 *   2. **Pattern scan.** Looks for credential-shaped strings regardless of whether they are in
 *      `.env`, so a key pasted from elsewhere is still caught.
 *
 * Public values in `.env` are classified as such and reported without alarm: the NoxCompute
 * address and a public RPC hostname are not secrets, and flagging them would train the reader to
 * ignore this scan's output.
 *
 * This script never prints a secret value. It reports the VARIABLE NAME and the file.
 */

import { existsSync, readFileSync, statSync } from "node:fs";

import { loadEnv } from "../lib/env.js";
import { repoPath, run } from "../lib/shell.js";

/** Variables whose values must never appear anywhere in the repository. */
const SENSITIVE = [
  "ALCHEMY_API_KEY",
  "DEPLOYER_PRIVATE_KEY",
  // Disposable Sepolia funding wallets (`pnpm dust:generate`). They hold testnet ETH for minutes,
  // but they are funded-wallet material and `.claude/rules/git.md` makes no exception for small
  // amounts — so they are scanned for exactly like the deployer key.
  "DUST_PRIVATE_KEY_1",
  "DUST_PRIVATE_KEY_2",
  "DUST_PRIVATE_KEY_3",
  "ETHERSCAN_API_KEY",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "NOX_GATEWAY_URL",
];

/**
 * Variables in `.env` that are NOT secret. Named explicitly so the scan can say "checked and
 * public" rather than staying silent, which would be indistinguishable from not checking.
 */
const PUBLIC_BY_DESIGN = [
  "SEPOLIA_RPC_URL",
  "SEPOLIA_LOG_RANGE",
  "ALCHEMY_API_URL",
  "NOX_COMPUTE_ADDRESS",
  "DEPLOY_SEPOLIA",
];

interface Pattern {
  readonly name: string;
  readonly regex: RegExp;
  readonly why: string;
}

const PATTERNS: readonly Pattern[] = [
  {
    name: "private key assignment",
    // A 32-byte hex value assigned to something key-shaped. Bare 32-byte hex is excluded because
    // market ids, grid hashes and bytecode hashes are exactly that and are public.
    regex: /(private[_-]?key|secret[_-]?key|mnemonic)\s*[:=]\s*["']?(0x)?[0-9a-fA-F]{64}/i,
    why: "a 32-byte value assigned to a key-shaped name",
  },
  {
    // Deliberately requires a QUOTED string. An earlier version matched any twelve lowercase
    // words in sequence and flagged ordinary prose in the PRD — a scan that cries wolf trains
    // the reader to ignore it, which is worse than not scanning.
    name: "BIP-39 mnemonic",
    regex: /["'`](?:[a-z]{3,8} ){11}[a-z]{3,8}(?: (?:[a-z]{3,8} ){11}[a-z]{3,8})?["'`]/,
    why: "a quoted 12- or 24-word lowercase phrase",
  },
  {
    name: "provider URL with embedded key",
    regex: /https:\/\/[a-z0-9.-]*(alchemy|infura|quicknode|ankr)[a-z0-9.-]*\/[a-zA-Z0-9_-]{16,}/i,
    why: "a provider URL whose path carries a key",
  },
  {
    name: "Cloudflare API token",
    regex: /\bcloudflare[_-]?api[_-]?token\s*[:=]\s*["']?[A-Za-z0-9_-]{30,}/i,
    why: "a Cloudflare token assignment",
  },
];

/**
 * Mnemonics that are public by construction and hold nothing anywhere.
 *
 * Matched BY VALUE, never by file: allowlisting a path would hide a real leak that happened to
 * land in the same file.
 */
const PUBLIC_MNEMONICS = ["test test test test test test test test test test test junk"];

/** Paths where a credential-shaped string is expected and harmless. */
const PATTERN_ALLOWLIST = [
  ".env.example",
  "scripts/verify/secrets.ts",
  "scripts/lib/env.ts",
  "spikes/", // frozen Day 0 evidence; local-only dev keys, labelled as such
  "docs/",
  "LICENSE",
];

interface Finding {
  readonly kind: "known-value" | "pattern";
  readonly detail: string;
  readonly file: string;
}

function scannedFiles(): string[] {
  return run("git", ["ls-files", "-co", "--exclude-standard"])
    .stdout.split("\n")
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && existsSync(repoPath(f)))
    .filter((f) => {
      try {
        // Skip anything large enough to be a build artifact rather than source.
        return statSync(repoPath(f)).size < 8 * 1024 * 1024;
      } catch {
        return false;
      }
    });
}

function main(): void {
  loadEnv();
  const files = scannedFiles();
  const findings: Finding[] = [];

  const sensitiveValues = SENSITIVE.map((name) => ({
    name,
    value: (process.env[name] ?? "").trim(),
  })).filter((entry) => entry.value.length >= 12);

  const publicValues = PUBLIC_BY_DESIGN.map((name) => ({
    name,
    value: (process.env[name] ?? "").trim(),
  })).filter((entry) => entry.value.length >= 12);

  for (const file of files) {
    let contents: string;
    try {
      contents = readFileSync(repoPath(file), "utf8");
    } catch {
      continue;
    }

    for (const secret of sensitiveValues) {
      if (contents.includes(secret.value)) {
        findings.push({
          kind: "known-value",
          detail: `the value of ${secret.name} appears here`,
          file,
        });
      }
    }

    if (PATTERN_ALLOWLIST.some((prefix) => file.startsWith(prefix))) continue;

    for (const pattern of PATTERNS) {
      const match = contents.match(pattern.regex);
      if (match === null) continue;
      // A known-public value is not a finding, whichever file it appears in.
      const hit = match[0].replace(/^["'`]|["'`]$/g, "");
      if (PUBLIC_MNEMONICS.includes(hit)) continue;
      findings.push({ kind: "pattern", detail: `${pattern.name} — ${pattern.why}`, file });
    }
  }

  console.log(`secret scan over ${files.length} tracked and untracked files\n`);
  console.log(
    `  sensitive variables with a value set : ${sensitiveValues.length}/${SENSITIVE.length}`,
  );
  console.log(`  public-by-design variables checked   : ${publicValues.length}`);
  console.log(`  credential patterns                  : ${PATTERNS.length}`);

  if (publicValues.length > 0) {
    console.log(
      `\n  classified public, not flagged: ${publicValues.map((v) => v.name).join(", ")}`,
    );
  }

  // .env must be ignored. If it ever became tracked, the known-value scan would pass trivially
  // because the value would legitimately be in .env — so this is checked separately.
  const ignored = run("git", ["check-ignore", ".env"], { allowFailure: true });
  if (ignored.code !== 0) {
    findings.push({ kind: "known-value", detail: ".env is NOT git-ignored", file: ".gitignore" });
  }

  if (findings.length > 0) {
    console.error(`\nverify:secrets FAILED — ${findings.length} finding(s)\n`);
    for (const finding of findings) {
      console.error(`  [${finding.kind}] ${finding.file}: ${finding.detail}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    "\nverify:secrets PASS — no sensitive value and no credential pattern in the repository",
  );
  console.log("  .env is git-ignored");
}

main();
