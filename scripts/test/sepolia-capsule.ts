/**
 * One real Kyrve Capsule on Ethereum Sepolia, against a claim a real allocation minted.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS PROVES THAT THE LOCAL SUITE CANNOT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `confidential/test/110-capsule.ts` proves all seven demonstrations against the real Nox stack on
 * one chain. What it cannot prove is that the same path works against the HOSTED gateway, at public
 * network latency, with an auditor who is a real signing key and a claim a real Midnight settlement
 * created minutes earlier.
 *
 * So this runs against state that already exists and pays for nothing it can adopt:
 *
 *   1. a provider holds an allocated claim  (refused outright if not — the Phase 6 stop condition)
 *   2. -> the provider freezes it into a capsule addressed to the declared auditor
 *   3. -> the snapshot handle is NOT the live balance handle
 *   4. -> the auditor decrypts the snapshot through the hosted gateway
 *   5. -> the auditor is REFUSED the provider's live balance
 *   6. -> a third wallet is REFUSED the snapshot
 *   7. -> origin, scope, recipient and handle verify on chain
 *   8. -> the curator freezes a public-scope capsule from facts it READ, not facts it was told
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * NO DECRYPTED VALUE REACHES STDOUT, THE EVIDENCE FILE, OR ANY LOG
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The auditor's decryption is compared IN MEMORY against the provider's own decryption of their own
 * claim, and only the verdict is printed. A capsule's whole purpose is that one party learns a
 * number, so a script that printed it would defeat the thing it is demonstrating.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * RESUMABLE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `issueOwnershipCapsule` consumes a per-owner nonce and seals a capsule id forever, so a re-run
 * must ADOPT the capsule that exists rather than issue a second one. Every step reads chain state
 * first. Deltas T-13 and T-14.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { NOX_COMPUTE_BY_CHAIN, NOX_GATEWAY_BY_CHAIN } from "@kyrve/config";
import { createHandleClient, type Handle } from "@kyrve/nox";
import { type Address, createPublicClient, createWalletClient, type Hex, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import { assertBroadcastArmed, assertNoSecrets, sepoliaRpc } from "../lib/env.js";
import { layerPaths, requireLayerFile } from "../lib/layer.js";
import { resolveRoles, signingKey } from "../lib/roles.js";
import { readJson, repoPath, stableStringify } from "../lib/shell.js";

const CHAIN_ID = 11_155_111;
const EXPLORER = "https://sepolia.etherscan.io";
const ZERO32 = `0x${"00".repeat(32)}` as Hex;
/** Ten minutes with backoff. Testnet Nox latency is UNVERIFIED (AS-1). */
const POLL = {
  policy: { initialDelayMs: 2_000, maxDelayMs: 20_000, multiplier: 2, timeoutMs: 600_000 },
} as const;
/** Seven days. Well inside `MAX_CAPSULE_LIFETIME`, and long enough to survive a paused run. */
const CAPSULE_LIFETIME = 7n * 24n * 3600n;
const SCOPE_OWNERSHIP = 0;
const SCOPE_SOLVENCY = 3;

/** Redacts every URL to scheme and host. A provider API key lives in the PATH. */
function redactUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s"')]+/g, (url) => {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}/***`;
    } catch {
      return "<url redacted>";
    }
  });
}

function abiOf(name: string): readonly unknown[] {
  const path = repoPath(`confidential/artifacts/contracts/${name}.sol/${name}.json`);
  if (!existsSync(path)) throw new Error(`no artifact at ${path}; compile the confidential layer`);
  return readJson<{ abi: readonly unknown[] }>(path).abi;
}

async function main(): Promise<void> {
  assertBroadcastArmed();
  const layer = layerPaths();
  if (layer.tag === "") {
    throw new Error("set KYRVE_EVIDENCE_TAG=a (or b) — a capsule is issued against ONE layer");
  }

  const rpc = sepoliaRpc();
  const client = createPublicClient({ chain: sepolia, transport: http(rpc.url) });
  const onChainId = await client.getChainId();
  if (onChainId !== CHAIN_ID) throw new Error(`the RPC is on chain ${onChainId}, not Sepolia`);

  const deployment = readJson<{
    seriesId: Hex;
    deploymentId: Hex;
    contracts: Record<string, { address: Address }>;
  }>(
    repoPath(
      requireLayerFile(
        layer.deployment,
        `${layer.label}'s deployment`,
        "pnpm deploy:series sepolia",
      ),
    ),
  );
  const market = readJson<{ contracts: Record<string, { address: Address }> }>(
    repoPath(
      requireLayerFile(
        "deployments/sepolia/market.json",
        "the market layer",
        "pnpm deploy:market sepolia",
      ),
    ),
  );
  /**
   * THE STOP CONDITION, ENFORCED HERE RATHER THAN ASSUMED.
   *
   * A capsule freezes a claim. Running one before an allocation exists would produce a capsule over
   * encrypted zero and a demonstration that proves nothing, so the allocation record is required and
   * its contents are checked rather than trusted.
   */
  const allocation = readJson<{
    allocated: boolean;
    closed: boolean;
    quoteId: Hex;
    providers: readonly { address: Address; matchesModel: boolean }[];
  }>(
    repoPath(
      requireLayerFile(
        layer.allocation,
        `${layer.label}'s allocation`,
        `KYRVE_EVIDENCE_TAG=${layer.tag} pnpm test:sepolia-series-allocation`,
      ),
    ),
  );
  if (!allocation.allocated || !allocation.closed) {
    throw new Error(
      `${layer.label}'s allocation is not complete (allocated=${allocation.allocated}, ` +
        `closed=${allocation.closed}). A capsule over an unallocated claim freezes encrypted zero.`,
    );
  }

  const capsuleVault = market.contracts["KyrveCapsuleVault"]?.address;
  const token = deployment.contracts["KyrveSeriesToken"]?.address;
  if (capsuleVault === undefined || token === undefined) {
    throw new Error("the records name no KyrveCapsuleVault or KyrveSeriesToken");
  }

  const roles = resolveRoles("sepolia", { requireKeys: ["curator", "auditor"] });
  const auditor = roles.accounts.auditor.address;
  const subjectKey = (process.env["DUST_PRIVATE_KEY_1"] ?? "").trim() as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(subjectKey)) throw new Error("DUST_PRIVATE_KEY_1 is not set");
  const subject = privateKeyToAccount(subjectKey);
  const outsiderKey = (process.env["DUST_PRIVATE_KEY_3"] ?? "").trim() as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(outsiderKey)) throw new Error("DUST_PRIVATE_KEY_3 is not set");
  const outsider = privateKeyToAccount(outsiderKey);

  const network = {
    chainId: CHAIN_ID,
    name: "ethereum-sepolia",
    noxCompute: NOX_COMPUTE_BY_CHAIN[CHAIN_ID] as Address,
    gatewayUrl: NOX_GATEWAY_BY_CHAIN[CHAIN_ID] as string,
  };

  console.log(`\nsepolia capsule — ${layer.label} — ${rpc.redacted}\n`);
  console.log(`  capsule vault ${capsuleVault}`);
  console.log(`  series token  ${token}`);
  console.log(`  subject       ${subject.address}  (a provider holding an allocated claim)`);
  console.log(`  auditor       ${auditor}  (the declared capsule recipient)`);
  console.log(`  outsider      ${outsider.address}  (holds no role and no grant)`);
  console.log(`  quote         ${allocation.quoteId}\n`);

  const tokenAbi = abiOf("KyrveSeriesToken");
  const vaultAbi = abiOf("KyrveCapsuleVault");
  const steps: { name: string; tx?: Hex; gas?: string; detail: string }[] = [];

  // ── 1. The claim the capsule will freeze ─────────────────────────────────────────────────
  const liveHandle = (await client.readContract({
    address: token,
    abi: tokenAbi as never,
    functionName: "confidentialBalanceOf",
    args: [subject.address] as never,
  })) as Handle;
  if (liveHandle === ZERO32) {
    throw new Error(`${subject.address} holds no series balance handle — nothing to freeze`);
  }
  console.log("  1. the subject holds a confidential claim");

  // ── 2. Issue, or adopt what already exists ───────────────────────────────────────────────
  const sequence = (await client.readContract({
    address: capsuleVault,
    abi: vaultAbi as never,
    functionName: "issuedBy",
    args: [subject.address] as never,
  })) as bigint;

  let capsuleId: Hex;
  if (sequence > 0n) {
    capsuleId = (await client.readContract({
      address: capsuleVault,
      abi: vaultAbi as never,
      functionName: "capsuleIdFor",
      args: [SCOPE_OWNERSHIP, subject.address, auditor, allocation.quoteId, sequence - 1n] as never,
    })) as Hex;
    console.log(`  2. adopted the capsule this subject already issued  ${capsuleId}`);
    steps.push({ name: "issueOwnershipCapsule", detail: "resumed — already on chain" });
  } else {
    const wallet = createWalletClient({
      account: subject,
      chain: sepolia,
      transport: http(rpc.url),
    });
    const nonce = (await client.readContract({
      address: token,
      abi: tokenAbi as never,
      functionName: "nextNonce",
      args: [subject.address] as never,
    })) as bigint;
    const expiry = (await client.getBlock()).timestamp + CAPSULE_LIFETIME;

    const hash = await wallet.writeContract({
      address: token,
      abi: tokenAbi as never,
      functionName: "issueOwnershipCapsule" as never,
      args: [auditor, allocation.quoteId, expiry, nonce] as never,
      account: subject,
      chain: sepolia,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`issueOwnershipCapsule reverted (${hash})`);
    capsuleId = (await client.readContract({
      address: capsuleVault,
      abi: vaultAbi as never,
      functionName: "capsuleIdFor",
      args: [SCOPE_OWNERSHIP, subject.address, auditor, allocation.quoteId, 0n] as never,
    })) as Hex;
    console.log(`  2. issued  ${capsuleId}  ${receipt.gasUsed} gas`);
    steps.push({
      name: "issueOwnershipCapsule",
      tx: hash,
      gas: receipt.gasUsed.toString(),
      detail: "the subject froze their own claim, addressed to the declared auditor",
    });
  }

  const capsule = (await client.readContract({
    address: capsuleVault,
    abi: vaultAbi as never,
    functionName: "capsuleOf",
    args: [capsuleId] as never,
  })) as Record<string, unknown>;
  const snapshotHandle = capsule["snapshotHandle"] as Handle;

  if (Number(capsule["scope"]) !== SCOPE_OWNERSHIP) throw new Error("wrong scope");
  if (String(capsule["subject"]).toLowerCase() !== subject.address.toLowerCase()) {
    throw new Error("the capsule names a different subject");
  }
  if (String(capsule["recipient"]).toLowerCase() !== auditor.toLowerCase()) {
    throw new Error("the capsule names a different recipient");
  }

  // ── 3. The structural claim: a snapshot is not the live handle ───────────────────────────
  if (snapshotHandle === liveHandle) {
    throw new Error(
      "the capsule's handle IS the live balance handle. A capsule must be a frozen `select` " +
        "output, or the auditor has been handed live access to a mutable balance.",
    );
  }
  console.log("  3. the snapshot handle is NOT the live balance handle");

  // ── 4-6. Who can read it, and who cannot ────────────────────────────────────────────────
  const auditorWallet = createWalletClient({
    account: privateKeyToAccount(signingKey(roles, "auditor")),
    chain: sepolia,
    transport: http(rpc.url),
  });
  const subjectWallet = createWalletClient({
    account: subject,
    chain: sepolia,
    transport: http(rpc.url),
  });
  const outsiderWallet = createWalletClient({
    account: outsider,
    chain: sepolia,
    transport: http(rpc.url),
  });

  const auditorClient = await createHandleClient(auditorWallet as never, network);
  const subjectClient = await createHandleClient(subjectWallet as never, network);
  const outsiderClient = await createHandleClient(outsiderWallet as never, network);

  /**
   * BOTH DECRYPTIONS HAPPEN, AND NEITHER VALUE IS PRINTED.
   *
   * The comparison is the demonstration: the auditor learns exactly the subject's claim and nothing
   * else. Printing either number would defeat the property being demonstrated, so only the verdict
   * leaves this scope.
   */
  const auditorSees = await auditorClient.decrypt(snapshotHandle, POLL);
  const subjectSees = await subjectClient.decrypt(liveHandle, POLL);
  const agrees = auditorSees === subjectSees;
  if (!agrees) {
    throw new Error(
      "the auditor's snapshot does not equal the subject's own claim. The magnitudes are " +
        "deliberately not printed; re-run with the local suite to diagnose.",
    );
  }
  console.log("  4. the auditor decrypted the snapshot, and it equals the subject's own claim");

  let auditorRefusedLive = false;
  try {
    await auditorClient.decrypt(liveHandle, { policy: { ...POLL.policy, timeoutMs: 30_000 } });
  } catch {
    auditorRefusedLive = true;
  }
  if (!auditorRefusedLive) {
    throw new Error(
      "the auditor could decrypt the LIVE balance handle. A capsule is not a viewer.",
    );
  }
  console.log("  5. the auditor was REFUSED the subject's live balance");

  let outsiderRefused = false;
  try {
    await outsiderClient.decrypt(snapshotHandle, { policy: { ...POLL.policy, timeoutMs: 30_000 } });
  } catch {
    outsiderRefused = true;
  }
  if (!outsiderRefused) throw new Error("a wallet holding no grant decrypted the capsule");
  console.log("  6. a third wallet was REFUSED the capsule");

  // ── 7. The public half ──────────────────────────────────────────────────────────────────
  await client.readContract({
    address: capsuleVault,
    abi: vaultAbi as never,
    functionName: "requireDecryptable",
    args: [capsuleId, auditor, snapshotHandle] as never,
  });
  const originDigest = (await client.readContract({
    address: capsuleVault,
    abi: vaultAbi as never,
    functionName: "originDigest",
    args: [capsuleId] as never,
  })) as Hex;

  let wrongRecipientRefused = false;
  try {
    await client.readContract({
      address: capsuleVault,
      abi: vaultAbi as never,
      functionName: "requireRecipient",
      args: [capsuleId, outsider.address] as never,
    });
  } catch {
    wrongRecipientRefused = true;
  }
  if (!wrongRecipientRefused) throw new Error("requireRecipient admitted the wrong address");
  console.log(`  7. origin and scope verify on chain, and a wrong recipient is refused`);

  // ── 8. A public-scope capsule, from facts it read ───────────────────────────────────────
  const curator = privateKeyToAccount(signingKey(roles, "curator"));
  const curatorWallet = createWalletClient({
    account: curator,
    chain: sepolia,
    transport: http(rpc.url),
  });
  const publicSequence = (await client.readContract({
    address: capsuleVault,
    abi: vaultAbi as never,
    functionName: "issuedBy",
    args: ["0x0000000000000000000000000000000000000000"] as never,
  })) as bigint;

  let publicCapsuleId: Hex;
  if (publicSequence > 0n) {
    publicCapsuleId = (await client.readContract({
      address: capsuleVault,
      abi: vaultAbi as never,
      functionName: "capsuleIdFor",
      args: [
        SCOPE_SOLVENCY,
        "0x0000000000000000000000000000000000000000",
        auditor,
        allocation.quoteId,
        publicSequence - 1n,
      ] as never,
    })) as Hex;
    console.log(`  8. adopted the public capsule already issued  ${publicCapsuleId}`);
    steps.push({ name: "issuePublicCapsule", detail: "resumed — already on chain" });
  } else {
    const expiry = (await client.getBlock()).timestamp + CAPSULE_LIFETIME;
    const hash = await curatorWallet.writeContract({
      address: capsuleVault,
      abi: vaultAbi as never,
      functionName: "issuePublicCapsule" as never,
      args: [SCOPE_SOLVENCY, auditor, allocation.quoteId, expiry] as never,
      account: curator,
      chain: sepolia,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`issuePublicCapsule reverted (${hash})`);
    publicCapsuleId = (await client.readContract({
      address: capsuleVault,
      abi: vaultAbi as never,
      functionName: "capsuleIdFor",
      args: [
        SCOPE_SOLVENCY,
        "0x0000000000000000000000000000000000000000",
        auditor,
        allocation.quoteId,
        0n,
      ] as never,
    })) as Hex;
    console.log(`  8. the curator froze a public-scope capsule  ${receipt.gasUsed} gas`);
    steps.push({
      name: "issuePublicCapsule",
      tx: hash,
      gas: receipt.gasUsed.toString(),
      detail: "solvency scope, read from the bound contracts rather than supplied",
    });
  }

  const facts = (await client.readContract({
    address: capsuleVault,
    abi: vaultAbi as never,
    functionName: "factsOf",
    args: [publicCapsuleId] as never,
  })) as Record<string, unknown>;

  // ── Evidence. No decrypted value, by construction ───────────────────────────────────────
  const evidence = {
    $comment:
      "One real Kyrve Capsule on Ethereum Sepolia. NO DECRYPTED VALUE APPEARS HERE and none is " +
      "representable: the auditor's snapshot was compared against the subject's own decryption IN " +
      "MEMORY and only the verdict is recorded. Every public field below was already public.",
    chainId: CHAIN_ID,
    layer: layer.tag,
    capsuleVault,
    seriesToken: token,
    seriesId: deployment.seriesId,
    deploymentId: deployment.deploymentId,
    quoteId: allocation.quoteId,
    subject: subject.address,
    auditor,
    outsider: outsider.address,
    capsuleId,
    publicCapsuleId,
    originDigest,
    snapshotHandle,
    liveBalanceHandle: liveHandle,
    snapshotIsNotTheLiveHandle: snapshotHandle !== liveHandle,
    auditorReadTheSnapshot: true,
    auditorSnapshotEqualsSubjectClaim: agrees,
    auditorRefusedTheLiveBalance: auditorRefusedLive,
    outsiderRefusedTheSnapshot: outsiderRefused,
    wrongRecipientRefusedOnChain: wrongRecipientRefused,
    publicFacts: {
      midnightCredit: String(facts["midnightCredit"]),
      publicCoverage: String(facts["publicCoverage"]),
      aggregateFillAmount: String(facts["aggregateFillAmount"]),
      allocatedCount: Number(facts["allocatedCount"]),
      quoteClosed: Boolean(facts["quoteClosed"]),
    },
    expiryIsNotRevocation:
      "The auditor can decrypt this snapshot forever, including after the capsule expires. Nox has " +
      "no removeViewer, no removeAdmin and no un-publish. Expiry ends what the capsule ASSERTS, " +
      "never what the recipient can read. Delta U-3.",
    steps,
    explorer: `${EXPLORER}/address/${capsuleVault}`,
    measuredAt: new Date().toISOString(),
  };

  const payload = `${stableStringify(evidence)}\n`;
  assertNoSecrets(payload, layer.capsule);
  mkdirSync(repoPath("evidence/phase6"), { recursive: true });
  writeFileSync(repoPath(layer.capsule), payload);

  console.log(`\n  capsule   ${capsuleId}`);
  console.log(`  digest    ${originDigest}`);
  console.log(`  recorded in ${layer.capsule}\n`);
}

main().catch((error: unknown) => {
  console.error(
    `\nsepolia capsule FAILED — ${redactUrls(error instanceof Error ? error.message : String(error))}\n`,
  );
  process.exitCode = 1;
});
