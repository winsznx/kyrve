/**
 * Environment and secret handling.
 *
 * `.env` is owner-provided secret material. The rules this module enforces mechanically, rather
 * than leaving to discipline at every call site:
 *
 *   - a secret is never printed, logged, or returned in a form that survives into a report;
 *   - an RPC URL is never shown in full — provider hostnames carry API keys in the path;
 *   - a private key is never echoed, and only the DERIVED ADDRESS (public) is ever surfaced;
 *   - nothing read here is written into a manifest, evidence file, or commit.
 *
 * Loading uses Node's built-in `process.loadEnvFile`, so no dotenv dependency and no parser of our
 * own sits between the file and the process.
 */

import { existsSync } from "node:fs";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { repoPath } from "./shell.js";

let loaded = false;

/** Loads `.env` once. Silent: it never reports what it found. */
export function loadEnv(): void {
  if (loaded) return;
  const path = repoPath(".env");
  if (existsSync(path)) process.loadEnvFile(path);
  loaded = true;
}

export class MissingSecretError extends Error {
  constructor(name: string, purpose: string) {
    super(
      `${name} is not set. It is needed to ${purpose}. Add it to .env — which is git-ignored — ` +
        "and never pass it on the command line, where it would land in shell history.",
    );
    this.name = "MissingSecretError";
  }
}

function require(name: string, purpose: string): string {
  loadEnv();
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new MissingSecretError(name, purpose);
  }
  return value.trim();
}

/**
 * Reduces a URL to scheme and host, discarding the path.
 *
 * Provider API keys live in the PATH (`https://eth-sepolia.g.alchemy.com/v2/<key>`), so printing a
 * "partial" URL by truncating the end is not safe — the whole path is discarded instead.
 */
/**
 * Redacts EVERY url in a block of text to scheme and host.
 *
 * THE ERROR PATH IS A LEAK PATH, AND IT LEAKED TWICE. viem embeds the transport URL in its error
 * text — `The request timed out. URL: https://eth-sepolia.g.alchemy.com/v2/<key>` — and a provider
 * API key lives in the PATH, so any handler that prints a caught error verbatim publishes the
 * owner's credential to the terminal and to every captured log. `assertNoSecrets` guards files and
 * nothing guarded stdout.
 *
 * Use this in every top-level catch. {redactUrl} handles a single known URL; this one handles a
 * string that merely happens to contain one, which is the case that actually bites.
 */
export function redactUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s"')\]]+/g, (url) => {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}/***`;
    } catch {
      return "<url redacted>";
    }
  });
}

/** The message of an unknown thrown value, with every URL redacted. Safe to print. */
export function safeErrorMessage(error: unknown): string {
  return redactUrls(error instanceof Error ? error.message : String(error));
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/***`;
  } catch {
    return "<malformed url, redacted>";
  }
}

/** Never returns the value. Use in reports to state that a credential is present. */
export function presence(name: string): "set" | "absent" {
  loadEnv();
  const value = process.env[name];
  return value !== undefined && value.trim().length > 0 ? "set" : "absent";
}

export interface RpcConfig {
  /** The real URL. Never print this — pass it to a transport and nothing else. */
  readonly url: string;
  /** Safe for logs, reports and documentation. */
  readonly redacted: string;
  readonly logRange: number;
  /** Which credential the endpoint came from, so a report can state it without the value. */
  readonly source: "SEPOLIA_RPC_URL" | "ALCHEMY_API_KEY";
  /** True when the endpoint is a keyless public provider rather than the owner's. */
  readonly isPublicEndpoint: boolean;
}

/** Public endpoints that must never be used in place of the owner's provider. */
const PUBLIC_RPC_HOSTS = ["sepolia.drpc.org", "ethereum-sepolia-rpc.publicnode.com", "1rpc.io"];

/**
 * The owner-configured Sepolia RPC.
 *
 * Resolution order is deliberate. `.env` ships with the public drpc default copied from
 * `.env.example`, so taking `SEPOLIA_RPC_URL` at face value would silently downgrade the owner's
 * Alchemy endpoint to a public one — which changes `eth_getLogs` behaviour materially (publicnode
 * rejects it as an archive request, 1rpc caps at 50 blocks, drpc serves 200) and is exactly what
 * the owner forbade.
 *
 * So: an explicit Alchemy `SEPOLIA_RPC_URL` wins; otherwise an `ALCHEMY_API_KEY` is used to build
 * the canonical endpoint; only if neither exists does the configured URL stand, flagged as public.
 * The constructed endpoint is never trusted blindly — `assertRpcReachable` proves it responds.
 */
export function sepoliaRpc(): RpcConfig {
  loadEnv();
  const configured = process.env["SEPOLIA_RPC_URL"]?.trim() ?? "";
  const alchemyKey = process.env["ALCHEMY_API_KEY"]?.trim() ?? "";

  const range = Number.parseInt(process.env["SEPOLIA_LOG_RANGE"] ?? "200", 10);
  const logRange = Number.isFinite(range) && range > 0 ? range : 200;

  const hostOf = (url: string): string => {
    try {
      return new URL(url).host;
    } catch {
      return "";
    }
  };

  const configuredHost = hostOf(configured);
  const configuredIsPublic = PUBLIC_RPC_HOSTS.some((h) => configuredHost.endsWith(h));

  if (configured.length > 0 && !configuredIsPublic) {
    return {
      url: configured,
      redacted: redactUrl(configured),
      logRange,
      source: "SEPOLIA_RPC_URL",
      isPublicEndpoint: false,
    };
  }

  if (alchemyKey.length > 0) {
    // The base URL is owner-configurable: Alchemy issues per-network hosts, and hardcoding one
    // would silently point at the wrong network if the owner's app is provisioned differently.
    const base = (
      process.env["ALCHEMY_API_URL"]?.trim() ?? "https://eth-sepolia.g.alchemy.com/v2/"
    ).replace(/\/+$/, "");
    const url = `${base}/${alchemyKey}`;
    return {
      url,
      redacted: redactUrl(url),
      logRange,
      source: "ALCHEMY_API_KEY",
      isPublicEndpoint: false,
    };
  }

  if (configured.length === 0) {
    throw new MissingSecretError(
      "SEPOLIA_RPC_URL (or ALCHEMY_API_KEY)",
      "reach Ethereum Sepolia through the owner's provider",
    );
  }

  return {
    url: configured,
    redacted: redactUrl(configured),
    logRange,
    source: "SEPOLIA_RPC_URL",
    isPublicEndpoint: true,
  };
}

export interface DeployerIdentity {
  /** PUBLIC. Safe to print, record in a manifest and publish. */
  readonly address: Address;
  /** The signing key. Never printed, never stored, never returned to a report. */
  readonly privateKey: `0x${string}`;
}

/**
 * The owner's existing deployment wallet.
 *
 * This never generates a key. If `DEPLOYER_PRIVATE_KEY` is absent the correct outcome is to stop,
 * not to create a wallet the owner did not choose and cannot fund.
 */
export function deployer(): DeployerIdentity {
  const raw = require("DEPLOYER_PRIVATE_KEY", "sign deployment transactions");
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    // Deliberately does not echo the value, not even its prefix.
    throw new Error(
      "DEPLOYER_PRIVATE_KEY is not a 32-byte hex key. Its value is not shown here by design.",
    );
  }
  return { address: privateKeyToAccount(key).address, privateKey: key };
}

export function etherscanApiKey(): string {
  return require("ETHERSCAN_API_KEY", "verify contract source through the Etherscan V2 API");
}

/**
 * Broadcast opt-in.
 *
 * Two independent conditions, so neither a stray export nor a leftover `.env` line is sufficient
 * on its own to move real value.
 */
export function broadcastArmed(): boolean {
  loadEnv();
  return (
    process.env["DEPLOY_SEPOLIA"] === "true" && process.env["KYRVE_CONFIRM_BROADCAST"] === "true"
  );
}

export function assertBroadcastArmed(): void {
  loadEnv();
  if (process.env["DEPLOY_SEPOLIA"] !== "true") {
    throw new Error('DEPLOY_SEPOLIA is not "true". Broadcast refused.');
  }
  if (process.env["KYRVE_CONFIRM_BROADCAST"] !== "true") {
    throw new Error(
      'KYRVE_CONFIRM_BROADCAST is not "true". Broadcast requires two independent opt-ins so ' +
        "that a leftover .env line cannot on its own move real value. Re-run with " +
        "KYRVE_CONFIRM_BROADCAST=true once the preflight output has been read.",
    );
  }
}

/**
 * Guards anything that would be written to disk or committed.
 *
 * Throws if a secret value appears anywhere in the payload — the last line of defence against a
 * credential reaching a manifest, evidence file or report.
 */
export function assertNoSecrets(payload: string, context: string): void {
  loadEnv();
  const secretNames = [
    "SEPOLIA_RPC_URL",
    "ALCHEMY_API_KEY",
    "DEPLOYER_PRIVATE_KEY",
    "ETHERSCAN_API_KEY",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "NOX_GATEWAY_URL",
  ];

  for (const name of secretNames) {
    const value = process.env[name];
    // Short values would produce false positives against ordinary text.
    if (value === undefined || value.trim().length < 12) continue;
    if (payload.includes(value.trim())) {
      throw new Error(
        `refusing to write ${context}: it contains the value of ${name}. ` +
          "Secrets must never reach a manifest, evidence file, log or commit.",
      );
    }
  }
}
