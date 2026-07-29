/**
 * Shared harness for the Phase 2 confidential suite.
 *
 * EVERY TEST IN THIS DIRECTORY RUNS AGAINST THE REAL LOCAL NOX STACK — the pinned KMS, handle
 * gateway, ingestor and runner at 0.6.0, in Docker, started by the Hardhat plugin. Nothing is
 * mocked. A handle here is a real handle, a proof here is a real gateway signature, and a
 * decryption here really is refused when the ACL says so.
 *
 * The client side goes exclusively through `@kyrve/nox`. That is not a stylistic preference: it is
 * the enforcement point for PRD v1.1 A-15, and `scripts/verify/import-boundary.ts` fails the build
 * if product code reaches around it. The only direct `@iexec-nox` import here is the Hardhat plugin
 * that boots the stack, which is test infrastructure and ships nowhere.
 */

import assert from "node:assert/strict";

import { handleGatewayUrl, NOX_COMPUTE_ADDRESS, nox } from "@iexec-nox/nox-hardhat-plugin";
import {
  createHandleClient,
  type KyrveHandleClient,
  type MandatePlaintext,
  type NoxNetwork,
  type RequestPlaintext,
} from "@kyrve/nox";

export const LOCAL_NOX_NETWORK = (): NoxNetwork => ({
  chainId: 31337,
  name: "hardhat-local",
  noxCompute: NOX_COMPUTE_ADDRESS,
  gatewayUrl: handleGatewayUrl(),
});

/**
 * The poll policy the suite uses.
 *
 * The default in `@kyrve/nox` is the operation budget's 5-second stage timeout, a 10x margin on the
 * measured local p90 of 492 ms. A cold first call on a freshly started stack can exceed it, so the
 * suite gives readiness 30 seconds. That is a test-harness choice, not a relaxation of the product
 * policy: the exported default is unchanged.
 */
export const SUITE_POLL = {
  policy: { initialDelayMs: 250, maxDelayMs: 2_000, multiplier: 2, timeoutMs: 30_000 },
} as const;

/**
 * Proves the handle gateway is really answering before a suite starts.
 *
 * The Docker host port is assigned at startup and read back through `docker compose port`. A stale
 * mapping left behind by an interrupted run points the client at whatever else is listening — in
 * practice the Hardhat node itself, which answers `400 WebSockets request was expected`. That
 * surfaces as a confusing decryption failure several tests later. Failing here instead says what
 * actually went wrong, and how to fix it.
 */
async function assertGatewayReachable(): Promise<void> {
  const url = handleGatewayUrl();
  let body: string;
  try {
    const response = await fetch(`${url}/v0/public/handles/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handles: [`0x${"00".repeat(32)}`] }),
    });
    body = await response.text();
  } catch (error) {
    throw new Error(
      `the Nox handle gateway at ${url} is unreachable (${String(error)}). Run ` +
        "`docker compose down --volumes --remove-orphans` against the Nox stack and retry.",
    );
  }
  if (body.includes("WebSockets request was expected")) {
    throw new Error(
      `${url} is not the Nox handle gateway — it is answering like an Ethereum JSON-RPC node. ` +
        "The Docker host-port mapping is stale, usually after an interrupted run. Stop every " +
        "leftover Nox container and retry.",
    );
  }
}

export interface Harness {
  connection: Awaited<ReturnType<typeof nox.connect>>;
  publicClient: any;
  wallets: any[];
  controller: any;
  underlying: any;
  asset: any;
  vault: any;
  mandateBook: any;
  requestBook: any;
  /** The wallet permitted to open and release reservations in this deployment. */
  reserver: `0x${string}`;
}

/**
 * Deploys a complete, independent confidential layer.
 *
 * Each suite gets its own deployment. Sharing one would make the `nonce` and consumed-handle state
 * of one test visible to another, and those are exactly what several tests assert on.
 */
export async function deployHarness(options: { reserver?: `0x${string}` } = {}): Promise<Harness> {
  await assertGatewayReachable();
  const connection = await nox.connect();
  const publicClient = await connection.viem.getPublicClient();
  const wallets = await connection.viem.getWalletClients();

  const guardian = wallets[0].account.address as `0x${string}`;
  // The reservation capability belongs to the curve engine and quote activator, which are Phase 3.
  // Until they exist a test wallet holds it, so the safe-reservation mechanism is exercised for
  // real rather than deferred behind an address nobody can call.
  const reserver = options.reserver ?? (wallets[3].account.address as `0x${string}`);

  const controller = await connection.viem.deployContract("KyrveEmergencyController", [guardian]);
  const underlying = await connection.viem.deployContract("TestUnderlyingERC20", [
    "Kyrve Test USDC",
    "tUSDC",
    6,
  ]);
  const asset = await connection.viem.deployContract("KyrveWrappedAsset", [
    "Kyrve Confidential USDC",
    "cUSDC",
    "",
    underlying.address,
    controller.address,
  ]);
  const vault = await connection.viem.deployContract("KyrveConfidentialAssetVault", [
    asset.address,
    reserver,
    controller.address,
  ]);
  const mandateBook = await connection.viem.deployContract("EncryptedMandateBook", [
    controller.address,
  ]);
  const requestBook = await connection.viem.deployContract("ConfidentialRequestBook", [
    controller.address,
  ]);

  return {
    connection,
    publicClient,
    wallets,
    controller,
    underlying,
    asset,
    vault,
    mandateBook,
    requestBook,
    reserver,
  };
}

/** A `@kyrve/nox` client bound to one specific wallet, so unauthorised reads can be attempted. */
export async function clientFor(harness: Harness, walletIndex: number): Promise<KyrveHandleClient> {
  return createHandleClient(harness.wallets[walletIndex], LOCAL_NOX_NETWORK());
}

export async function mine(harness: Harness, hash: `0x${string}`): Promise<any> {
  const receipt = await harness.publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", `transaction ${hash} reverted`);
  return receipt;
}

/** A realistic multi-market mandate: three markets enabled at different floors, five sitting out. */
export function sampleMandate(): MandatePlaintext {
  return {
    totalBudget: 5_000_000_000n,
    marketCaps: [2_000_000_000n, 1_500_000_000n, 0n, 1_000_000_000n],
    minRateIndexes: [12, 18, 0, 25],
    enabledFlags: [1, 1, 0, 1],
    collateralFamilyCaps: [3_000_000_000n, 2_000_000_000n],
    maturityBucketCaps: [2_500_000_000n, 2_500_000_000n],
    maxDurationIndex: 3,
    allocationWeight: 100,
  };
}

/** A borrower request that fits inside the sample mandate's envelope. */
export function sampleRequest(): RequestPlaintext {
  return {
    desiredAssets: 1_200_000_000n,
    minimumAssets: 1_000_000_000n,
    maxRateIndexes: [30, 30, 0, 30],
    enabledFlags: [1, 1, 0, 1],
    preferredMaturityIndex: 1,
  };
}

/**
 * Asserts a call reverts, and that it reverts for the NAMED reason rather than any reason.
 *
 * Two things make this harder than it looks against Nox, and both would otherwise produce tests
 * that pass for the wrong reason:
 *
 *  - viem nests the real revert several `cause` levels deep, and truncates the top-level message.
 *  - NoxCompute reverts `InvalidProof(bytes proof, string reason)`, so the reason a test cares
 *    about — "Owner mismatch", "App mismatch", "Proof expired" — exists only as ASCII bytes inside
 *    ABI-encoded return data that viem cannot decode without the NoxCompute ABI.
 *
 * So the whole error chain is flattened, and every hex blob in it is additionally read as ASCII.
 */
export async function assertRevertsWith(
  action: () => Promise<unknown>,
  fragment: string,
  what: string,
): Promise<void> {
  let raised: unknown;
  try {
    await action();
  } catch (error) {
    raised = error;
  }
  assert.ok(raised !== undefined, `${what}: expected a revert, but the call succeeded`);

  const text = flattenError(raised);
  if (fragment === "") return; // caller only requires that it reverted

  assert.ok(
    text.includes(fragment),
    `${what}: reverted, but not with "${fragment}". A test that passes for the wrong reason is ` +
      `worse than no test.\nActual: ${text.slice(0, 1200)}`,
  );
}

/**
 * Asserts a call reverts for one of several named reasons, and reports which one fired.
 *
 * Only for cases where the alternatives are genuinely equivalent refusals of the same attack — a
 * corrupted signature is refused either by `ECDSA.recover` returning nobody or by NoxCompute
 * recovering somebody who is not the gateway, and which one happens depends on whether the
 * corrupted `r` lands on the curve. It is NOT a way to soften an assertion that could name one
 * reason; that would be the "passes for the wrong reason" failure this suite exists to avoid.
 */
export async function assertRevertsWithAny(
  action: () => Promise<unknown>,
  fragments: readonly string[],
  what: string,
): Promise<string> {
  let raised: unknown;
  try {
    await action();
  } catch (error) {
    raised = error;
  }
  assert.ok(raised !== undefined, `${what}: expected a revert, but the call succeeded`);

  const text = flattenError(raised);
  const matched = fragments.find((fragment) => text.includes(fragment));
  assert.ok(
    matched !== undefined,
    `${what}: reverted, but with none of ${fragments.join(" / ")}.\nActual: ${text.slice(0, 1200)}`,
  );
  return matched;
}

/**
 * Everything an error carries, flattened, with the ASCII inside every hex blob exposed.
 *
 * viem spreads one revert across `message`, `shortMessage`, `details`, `metaMessages` and a `cause`
 * chain several levels deep, and truncates the top-level message. The reason a NoxCompute revert
 * actually carries — "Owner mismatch", "App mismatch", "Proof expired", "Invalid signature" — lives
 * only as ASCII bytes inside `details`, because `InvalidProof(bytes,string)` is not on the called
 * contract's ABI and viem cannot decode it. Reading only `message` therefore silently matches
 * nothing and every assertion would have to be weakened to "it reverted somehow".
 */
export function flattenError(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();

  const visit = (value: unknown, depth: number): void => {
    if (value === null || value === undefined || depth > 12 || seen.has(value)) return;
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      seen.add(value);
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of [
      "message",
      "shortMessage",
      "details",
      "metaMessages",
      "reason",
      "signature",
    ]) {
      visit(record[key], depth + 1);
    }
    visit(record["cause"], depth + 1);
  };

  visit(error, 0);
  const joined = parts.join("\n");
  return joined.replace(/0x[0-9a-fA-F]{16,}/g, (blob) => `${blob} /*ascii:${ascii(blob)}*/`);
}

function ascii(hex: string): string {
  let out = "";
  for (let i = 2; i + 1 < hex.length; i += 2) {
    const code = Number.parseInt(hex.slice(i, i + 2), 16);
    out += code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : "";
  }
  return out;
}
