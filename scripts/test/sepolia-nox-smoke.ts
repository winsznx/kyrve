/**
 * The Sepolia encrypted-input smoke test — the AS-1 discharge, and a Phase 3 prerequisite.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS RUNS BEFORE ANYTHING ELSE IS DEPLOYED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Phase 2 deployed and verified the confidential layer on Sepolia, and every one of those checks
 * was a `view` call. `docs/phase2/GATE.md` says so plainly: **no encrypted input has ever been
 * submitted to the hosted iExec gateway.** Handle computation depends on a KMS, an ingestor and a
 * runner this repository cannot see and does not operate, and on Sepolia those are iExec's hosted
 * services. AS-1 — testnet Nox latency and gas — has been UNVERIFIED since Day 0.
 *
 * Deploying a 2,048-cell curve engine onto a stack that has never accepted a single encrypted
 * input from this repository would be building on an assumption. So this runs first, it is small,
 * and it either discharges AS-1 or reports that it could not.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IT EXERCISES, AND WHY THIS PARTICULAR CALL
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `ConfidentialRequestBook.submitRequest` exercises the complete round trip:
 *
 *   1. the hosted gateway encrypts nineteen values and issues a 137-byte proof for each, bound to
 *      owner, contract, chain and a 3600s expiry;
 *   2. NoxCompute validates every one of those proofs ON CHAIN — the half no `view` call reaches;
 *   3. the contract seals them and grants the borrower, and only the borrower, the right to read;
 *   4. the off-chain runner makes them computable;
 *   5. the gateway releases one back to its owner.
 *
 * Then `cancelUnsealedRequest` returns the bond in full, so the run costs gas and nothing else.
 *
 * WHY NOT THE VAULT, WHICH WOULD HAVE BEEN CHEAPER. `withdraw` was the obvious choice — one handle
 * instead of nineteen — and it reverts on Sepolia with `ERC7984ZeroBalance`. The OFFICIAL ERC-7984
 * implementation refuses a transfer from an account whose confidential balance was never
 * initialised, rather than moving encrypted zero, and nothing has ever been wrapped into the
 * Sepolia vault. Phase 2's local suite never met that state because its vault always held
 * something. Recorded as delta R-8: the vault's withdraw path is branch-free over AMOUNTS, but an
 * entirely uninitialised balance is a PUBLIC revert.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * SAFETY
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * It broadcasts, so it needs both opt-ins, exactly like every other broadcast path in this
 * repository. The RPC URL is reduced to scheme and host in every line of output, the private key
 * is never printed, and the evidence file is checked for secrets before it is written.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { NOX_COMPUTE_BY_CHAIN, NOX_GATEWAY_BY_CHAIN } from "@kyrve/config";
import { createHandleClient, encryptRequest, type Handle, readAcl } from "@kyrve/nox";
import { type Address, createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import { assertBroadcastArmed, assertNoSecrets, deployer, sepoliaRpc } from "../lib/env.js";
import { readJson, repoPath, stableStringify } from "../lib/shell.js";

const CHAIN_ID = 11_155_111;

/**
 * The poll policy for a stack whose latency is the thing under test.
 *
 * `@kyrve/nox`'s exported default is the operation budget's 5-second stage timeout, a 10x margin
 * on the LOCAL p90 of 492 ms. Using it here would be assuming the answer. Five minutes is generous
 * enough that a timeout means something is wrong rather than merely slow, and the measured latency
 * is recorded whatever it turns out to be.
 */
const SMOKE_POLL = {
  policy: { initialDelayMs: 2_000, maxDelayMs: 20_000, multiplier: 2, timeoutMs: 300_000 },
} as const;

interface Phase2Record {
  readonly addresses: { readonly ConfidentialRequestBook: Address };
}

const REQUEST_TUPLE = {
  type: "tuple",
  components: [
    { name: "desiredAssets", type: "bytes32" },
    { name: "minimumAssets", type: "bytes32" },
    { name: "maxRateIndexes", type: "bytes32[8]" },
    { name: "enabledFlags", type: "bytes32[8]" },
    { name: "preferredMaturityIndex", type: "bytes32" },
  ],
} as const;

const BOOK_ABI = [
  {
    type: "function",
    name: "submitRequest",
    stateMutability: "payable",
    inputs: [
      { type: "bytes32" },
      REQUEST_TUPLE,
      { type: "bytes[]" },
      { type: "uint64" },
      { type: "bool" },
      { type: "bytes32" },
      { type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "cancelUnsealedRequest",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "nextNonce",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "liveRequest",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "handlesOf",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [REQUEST_TUPLE],
  },
] as const;

/** A throwaway universe id. Phase 2's request book accepts any non-zero value. */
const SMOKE_UNIVERSE = `0x${"5c".repeat(32)}` as const;
const BOND_WEI = 10n ** 15n;

async function main(): Promise<void> {
  assertBroadcastArmed();

  const recordPath = repoPath("deployments/sepolia/confidential.json");
  if (!existsSync(recordPath)) {
    throw new Error(
      "no Sepolia Phase 2 deployment record. This smoke test deliberately reuses the ALREADY " +
        "DEPLOYED and Etherscan-verified confidential layer rather than deploying anything new — " +
        "the point is to test the hosted Nox stack, not a fresh contract.",
    );
  }
  const book = readJson<Phase2Record>(recordPath).addresses.ConfidentialRequestBook;

  const rpc = sepoliaRpc();
  // `deployer()` returns the derived ADDRESS and the key, never a signer — the key is deliberately
  // not turned into an account inside the secret module, so nothing there can accidentally sign.
  const identity = deployer();
  const account = privateKeyToAccount(identity.privateKey);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpc.url),
    cacheTime: 0,
  });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpc.url) });

  const gatewayUrl = NOX_GATEWAY_BY_CHAIN[CHAIN_ID];
  const noxCompute = NOX_COMPUTE_BY_CHAIN[CHAIN_ID];
  if (gatewayUrl === undefined || noxCompute === undefined) {
    throw new Error(`no Nox endpoint is known for chain ${CHAIN_ID}`);
  }
  const network = { chainId: CHAIN_ID, name: "ethereum-sepolia", noxCompute, gatewayUrl };

  console.log("sepolia nox smoke — the AS-1 discharge\n");
  console.log(`  RPC         ${rpc.redacted}`);
  console.log(`  gateway     ${gatewayUrl}`);
  console.log(`  NoxCompute  ${noxCompute}`);
  console.log(`  requestBook ${book}`);
  console.log(`  wallet      ${account.address}`);

  const balanceBefore = await publicClient.getBalance({ address: account.address });
  console.log(`  balance     ${formatEther(balanceBefore)} ETH\n`);

  const code = await publicClient.getCode({ address: noxCompute });
  if (code === undefined || code === "0x") {
    throw new Error(`NoxCompute has no code at ${noxCompute}; no encrypted input can be accepted`);
  }

  // ── 0. Clear a leftover request from an interrupted run ────────────────────────────────────
  // The request book allows one live request per borrower per universe, so a run that submitted
  // and then failed downstream leaves this blocked. Resuming is the correct behaviour: the point
  // is to test the hosted stack repeatedly, and a script that only works on a clean slate would
  // be one more thing to remember at the exact moment something has already gone wrong.
  const leftover = await publicClient.readContract({
    address: book,
    abi: BOOK_ABI,
    functionName: "liveRequest",
    args: [account.address, SMOKE_UNIVERSE],
  });
  if (leftover !== `0x${"00".repeat(32)}`) {
    console.log(`  clearing    a live request left by an earlier run: ${leftover}`);
    const clearHash = await walletClient.writeContract({
      address: book,
      abi: BOOK_ABI,
      functionName: "cancelUnsealedRequest",
      args: [leftover],
    });
    await publicClient.waitForTransactionReceipt({ hash: clearHash });
    console.log(`              bond refunded in ${clearHash}\n`);
  }

  // ── 1. Encrypt through the HOSTED gateway ──────────────────────────────────────────────────
  const client = await createHandleClient(walletClient, network);

  const encryptStarted = Date.now();
  const encoded = await encryptRequest(client, book, {
    desiredAssets: 1n,
    minimumAssets: 1n,
    maxRateIndexes: Array.from({ length: 8 }, () => 0),
    enabledFlags: Array.from({ length: 8 }, () => 0),
    preferredMaturityIndex: 0,
  });
  const encryptMs = Date.now() - encryptStarted;
  console.log(`  encrypted   ${encoded.proofs.length} handles in ${encryptMs} ms`);
  console.log(
    `              ${Math.round(encryptMs / encoded.proofs.length)} ms each, proofs ${(encoded.proofs[0]!.length - 2) / 2} bytes\n`,
  );

  // ── 2. Submit them, so NoxCompute validates every proof ON CHAIN ────────────────────────────
  const nonce = await publicClient.readContract({
    address: book,
    abi: BOOK_ABI,
    functionName: "nextNonce",
    args: [account.address],
  });

  const submitStarted = Date.now();
  const hash = await walletClient.writeContract({
    address: book,
    abi: BOOK_ABI,
    functionName: "submitRequest",
    args: [
      SMOKE_UNIVERSE,
      encoded.struct as never,
      encoded.proofs as never,
      3_600n,
      true,
      `0x${"00".repeat(32)}`,
      nonce,
    ],
    value: BOND_WEI,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const submitMs = Date.now() - submitStarted;

  if (receipt.status !== "success") {
    throw new Error(`the encrypted inputs were REJECTED on chain: ${hash}`);
  }
  console.log(`  submitted   ${hash}`);
  console.log(
    `              ${receipt.gasUsed} gas, block ${receipt.blockNumber}, ${submitMs} ms\n`,
  );

  // ── 3. Wait for the hosted runner, then decrypt one back ────────────────────────────────────
  const requestId = await publicClient.readContract({
    address: book,
    abi: BOOK_ABI,
    functionName: "liveRequest",
    args: [account.address, SMOKE_UNIVERSE],
  });
  const stored = await publicClient.readContract({
    address: book,
    abi: BOOK_ABI,
    functionName: "handlesOf",
    args: [requestId],
  });
  const resulting = (stored as { desiredAssets: Handle }).desiredAssets;

  const acl = await readAcl(publicClient, network, resulting, account.address);
  console.log(`  sealed      ${resulting}`);
  console.log(`              admin ${acl.isAdmin}, public ${acl.isPublic}`);

  const decryptStarted = Date.now();
  await client.decrypt(resulting, SMOKE_POLL);
  const decryptMs = Date.now() - decryptStarted;
  console.log(`              decrypted by its owner in ${decryptMs} ms\n`);

  // ── 4. Recover the bond, so the run costs gas and nothing else ──────────────────────────────
  const cancelHash = await walletClient.writeContract({
    address: book,
    abi: BOOK_ABI,
    functionName: "cancelUnsealedRequest",
    args: [requestId],
  });
  await publicClient.waitForTransactionReceipt({ hash: cancelHash });
  console.log(`  bond        refunded in ${cancelHash}\n`);

  // The VALUE never leaves this process. Only the latency and the shape are recorded.
  const balanceAfter = await publicClient.getBalance({ address: account.address });
  const evidence = {
    $comment:
      "The first encrypted input this repository has ever submitted to the HOSTED iExec Nox " +
      "stack. Discharges AS-1 for the round trip measured here and for nothing wider. The " +
      "decrypted VALUE is deliberately absent: no Kyrve artifact ever records one.",
    measuredAt: new Date().toISOString(),
    chainId: CHAIN_ID,
    gateway: gatewayUrl,
    noxCompute,
    contract: book,
    call: "ConfidentialRequestBook.submitRequest",
    handles: encoded.proofs.length,
    latencyMs: {
      encryptAll: encryptMs,
      encryptPerHandle: Math.round(encryptMs / encoded.proofs.length),
      submitAndConfirm: submitMs,
      runnerAndDecrypt: decryptMs,
    },
    gasUsed: receipt.gasUsed.toString(),
    proofBytes: (encoded.proofs[0]!.length - 2) / 2,
    transaction: hash,
    block: receipt.blockNumber.toString(),
    ethSpent: formatEther(balanceBefore - balanceAfter),
    resultHandleIsConfidential: !acl.isPublic,
    ownerCanDecrypt: acl.canDecrypt,
    verdict:
      "PASS — the hosted gateway issued a proof, NoxCompute accepted it on chain, the hosted " +
      "runner made the sealed handles computable, and the owner decrypted one back. This " +
      "discharges AS-1 for a nineteen-handle round trip. It does NOT establish throughput for a " +
      "2,048-cell epoch, and it does not make the hosted services a Kyrve availability guarantee.",
    valueRecorded: false,
  };

  const payload = `${stableStringify(evidence)}\n`;
  assertNoSecrets(payload, "evidence/phase3/sepolia-nox-smoke.json");
  mkdirSync(repoPath("evidence/phase3"), { recursive: true });
  writeFileSync(repoPath("evidence/phase3/sepolia-nox-smoke.json"), payload);

  console.log("  AS-1: DISCHARGED for a nineteen-handle round trip on Ethereum Sepolia.");
  console.log(
    "  NOT established here: throughput for a full epoch, or hosted-service availability.",
  );
  console.log(`  spent ${evidence.ethSpent} ETH\n`);
}

main().catch((error: unknown) => {
  console.error(
    `\nsepolia-nox-smoke FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.error(
    "\n  AS-1 remains UNVERIFIED. Do not deploy the Phase 3 layer to Sepolia until this passes:\n" +
      "  a curve engine on a stack that has never accepted an encrypted input is an assumption,\n" +
      "  not a deployment.\n",
  );
  process.exitCode = 1;
});
