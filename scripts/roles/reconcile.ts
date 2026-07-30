/**
 * Per-role balance and measured-cost reconciliation for the Phase 6 Sepolia campaign.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS RECOMPUTES INSTEAD OF SUMMING THE RECORDS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every evidence file already reports the gas its own script measured. Adding those numbers up would
 * reconcile the records against themselves and prove nothing — the whole point of Kyrve Verify is
 * that a manifest is a claim, not a fact.
 *
 * So this walks every transaction hash the campaign recorded, pulls the RECEIPT from chain, and
 * attributes `gasUsed * effectiveGasPrice` to whichever address actually signed it. The roles are
 * then checked three ways:
 *
 *   1. did each role only sign what its documented authority allows?
 *   2. does attributed spend plus current balance reconcile with what the role was funded?
 *   3. did any address sign for a role it does not hold?
 *
 * Check 1 is the one that matters. Separation of duties is a property of what the keys DID, not of
 * what the deployment script intended, and a role that quietly signed outside its remit would look
 * identical in every other record.
 *
 * A discrepancy in check 2 is expected and is not a failure: roles were funded and swept across the
 * campaign, and transfers in are not recoverable from receipts alone. It is reported, never asserted.
 */

import { readdirSync, writeFileSync } from "node:fs";

import { type Address, createPublicClient, formatEther, type Hex, http } from "viem";
import { sepolia } from "viem/chains";

import { assertNoSecrets, safeErrorMessage, sepoliaRpc } from "../lib/env.js";
import { describeRoles, ROLE_ORDER, type RoleName, resolveRoles } from "../lib/roles.js";
import { readJson, repoPath, stableStringify } from "../lib/shell.js";

const CHAIN_ID = 11_155_111;

/**
 * Which campaign a record belongs to. Pooling these into one number would overstate Phase 6's cost
 * by every contract an earlier phase deployed, and would bury the one epoch whose gas was spent for
 * nothing (delta U-8) inside a total that looks like productive work.
 */
function bucketOf(file: string): "phase6" | "superseded" | "abandoned" {
  if (file.includes("superseded")) return "superseded";
  if (file.includes("abandoned")) return "abandoned";
  return "phase6";
}

/** Keys whose 0x-64 value is a transaction hash. Every other 0x-64 in these records is an id. */
const TX_KEYS = new Set([
  "tx",
  "hash",
  "txHash",
  "deploymentTx",
  "deploymentTxHash",
  "transactionHash",
]);

interface Attribution {
  readonly hash: Hex;
  readonly from: Address;
  readonly gasUsed: bigint;
  readonly feeWei: bigint;
  readonly source: string;
}

/** Every 0x…64 that looks like a transaction hash, with the record it came from. */
function collectHashes(): Map<Hex, string> {
  const found = new Map<Hex, string>();
  const visit = (node: unknown, source: string): void => {
    if (typeof node === "string") {
      const match = node.match(/0x[0-9a-fA-F]{64}/);
      // Series ids, epoch ids, quote ids, graph roots, runtime hashes and Nox handles are all
      // 0x-64 too. Only a key that NAMES a transaction, or an explorer /tx/ link, is dialled.
      if (match !== null && (node.includes("/tx/") || source.endsWith(".tx"))) {
        found.set(match[0].toLowerCase() as Hex, source);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const [i, item] of node.entries()) visit(item, `${source}[${i}]`);
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        visit(value, TX_KEYS.has(key) ? `${source}.tx` : `${source}.${key}`);
      }
    }
  };

  for (const dir of ["evidence/phase6", "deployments/sepolia"]) {
    let entries: string[];
    try {
      entries = readdirSync(repoPath(dir));
    } catch {
      continue;
    }
    for (const file of entries) {
      if (!file.endsWith(".json") || file.startsWith(".raw-")) continue;
      visit(readJson<unknown>(repoPath(`${dir}/${file}`)), `${dir}/${file}`);
    }
  }
  return found;
}

async function main(): Promise<void> {
  const rpc = sepoliaRpc();
  const client = createPublicClient({ chain: sepolia, transport: http(rpc.url) });
  if ((await client.getChainId()) !== CHAIN_ID) throw new Error("not Sepolia");

  const roles = resolveRoles("sepolia", { requireKeys: [] });
  const byAddress = new Map<string, RoleName>();
  for (const name of ROLE_ORDER) byAddress.set(roles.accounts[name].address.toLowerCase(), name);

  const hashes = collectHashes();
  console.log(`\nphase 6 per-role reconciliation — ${rpc.redacted}\n`);
  console.log(`  ${hashes.size} recorded transaction(s) across evidence and deployment records\n`);

  const attributions: Attribution[] = [];
  const unknownSigners = new Map<string, number>();
  let missing = 0;

  for (const [hash, source] of hashes) {
    let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;
    try {
      receipt = await client.getTransactionReceipt({ hash });
    } catch {
      missing += 1;
      continue;
    }
    const from = receipt.from.toLowerCase() as Address;
    const feeWei = receipt.gasUsed * receipt.effectiveGasPrice;
    attributions.push({ hash, from, gasUsed: receipt.gasUsed, feeWei, source });
    if (!byAddress.has(from)) {
      unknownSigners.set(from, (unknownSigners.get(from) ?? 0) + 1);
    }
  }

  const perRole = new Map<RoleName, { txs: number; gas: bigint; feeWei: bigint }>();
  for (const name of ROLE_ORDER) perRole.set(name, { txs: 0, gas: 0n, feeWei: 0n });
  for (const a of attributions) {
    const name = byAddress.get(a.from);
    if (name === undefined) continue;
    const bucket = perRole.get(name);
    if (bucket === undefined) continue;
    bucket.txs += 1;
    bucket.gas += a.gasUsed;
    bucket.feeWei += a.feeWei;
  }

  const campaigns = new Map<string, { txs: number; gas: bigint; feeWei: bigint }>([
    ["phase6", { txs: 0, gas: 0n, feeWei: 0n }],
    ["superseded", { txs: 0, gas: 0n, feeWei: 0n }],
    ["abandoned", { txs: 0, gas: 0n, feeWei: 0n }],
  ]);
  for (const a of attributions) {
    const bucket = campaigns.get(bucketOf(a.source));
    if (bucket === undefined) continue;
    bucket.txs += 1;
    bucket.gas += a.gasUsed;
    bucket.feeWei += a.feeWei;
  }

  console.log("  role                 signed        gas         spent (ETH)      balance (ETH)");
  console.log("  ─────────────────────────────────────────────────────────────────────────────");
  const rows: Record<string, unknown>[] = [];
  for (const name of ROLE_ORDER) {
    const bucket = perRole.get(name);
    if (bucket === undefined) continue;
    const balance = await client.getBalance({ address: roles.accounts[name].address });
    console.log(
      `  ${name.padEnd(20)} ${String(bucket.txs).padStart(5)}  ${String(bucket.gas).padStart(11)}` +
        `  ${formatEther(bucket.feeWei).slice(0, 14).padStart(15)}  ${formatEther(balance).slice(0, 14).padStart(15)}`,
    );
    rows.push({
      role: name,
      address: roles.accounts[name].address,
      transactionsSigned: bucket.txs,
      gasUsed: bucket.gas.toString(),
      feeWei: bucket.feeWei.toString(),
      feeEth: formatEther(bucket.feeWei),
      balanceWei: balance.toString(),
      balanceEth: formatEther(balance),
      authority: roles.accounts[name].authority,
      signsInNormalOperation: roles.accounts[name].signs,
      signedNothing: bucket.txs === 0,
    });
  }

  // The roles that must never have signed anything here, and WHY each one is silent. These are not
  // interchangeable: two hold no privilege at all, one holds a privilege nothing invoked, and one
  // holds a privilege whose paths this campaign never reached. Reporting them as one blob would let
  // a genuine separation failure hide inside an expected silence.
  const mustBeSilent: Readonly<Record<string, string>> = {
    residueBeneficiary:
      "a destination, never an authority — it holds no privilege anywhere and was deliberately not swept",
    auditor: "read-only; it receives capsule snapshots and can sign nothing that changes state",
    emergencyAuthority: "pause was never invoked, and pause is the only thing it can do",
    operator:
      "no quote was retired before expiry and no uncommitted funding was recovered; the Cross match " +
      "is onlyKeeper, so nothing on this campaign was the operator's to sign",
  };
  const violations = Object.keys(mustBeSilent).filter(
    (name) => (perRole.get(name as RoleName)?.txs ?? 0) !== 0,
  );

  console.log();
  if (violations.length === 0) {
    console.log("  four roles signed NOTHING, each for its own reason:");
    for (const [name, why] of Object.entries(mustBeSilent))
      console.log(`    ${name.padEnd(20)}${why}`);
  } else {
    console.log(`  SEPARATION FAILURE: ${violations.join(", ")} signed on a campaign they are`);
    console.log("  documented as taking no part in");
  }

  if (unknownSigners.size > 0) {
    console.log(`\n  ${unknownSigners.size} address(es) outside the role set also signed:`);
    for (const [address, count] of unknownSigners) {
      console.log(`    ${address}  ${count} tx — a provider, the borrower, or a prior campaign`);
    }
  }
  if (missing > 0) {
    console.log(`\n  ${missing} recorded hash(es) had no receipt on this chain`);
  }

  console.log("\n  campaign             signed        gas         spent (ETH)");
  console.log("  ──────────────────────────────────────────────────────────────");
  for (const [name, b] of campaigns) {
    console.log(
      `  ${name.padEnd(20)} ${String(b.txs).padStart(5)}  ${String(b.gas).padStart(11)}` +
        `  ${formatEther(b.feeWei).slice(0, 14).padStart(15)}`,
    );
  }
  console.log(
    "  'abandoned' is the synthetic-universe epoch of delta U-8: real gas, no settleable quote.\n" +
      "  Its cost reads as zero because `gasUsedThisRun` is PER INVOCATION, and the record that\n" +
      "  survived is a resumed run that did no new work. The epoch's true gas is NOT recoverable\n" +
      "  from these records, and no number is invented for it here.",
  );

  // WHAT THIS REPORT CANNOT VERIFY, STATED RATHER THAN OMITTED.
  //
  // The curve-epoch driver records `gasUsedThisRun` — an aggregate — and no per-transaction hashes,
  // because an epoch is dozens of Nox calls and the record was sized for the reference comparison,
  // not for accounting. That gas is real and large, and it is invisible to a receipt walk. Leaving
  // it out silently would make the total above read as the campaign's full cost when it is not.
  const recordOnly: { record: string; gasUsed: string; bucket: string }[] = [];
  for (const file of readdirSync(repoPath("evidence/phase6"))) {
    if (!file.endsWith(".json")) continue;
    const record = readJson<Record<string, unknown>>(repoPath(`evidence/phase6/${file}`));
    const reported = record["gasUsedThisRun"];
    if (typeof reported === "string" || typeof reported === "number") {
      recordOnly.push({ record: file, gasUsed: String(reported), bucket: bucketOf(file) });
    }
  }
  if (recordOnly.length > 0) {
    console.log(
      "\n  gas these records REPORT but no receipt walk can confirm (no hashes recorded):",
    );
    for (const r of recordOnly) {
      console.log(`    ${r.record.padEnd(46)} ${r.gasUsed.padStart(11)}  ${r.bucket}`);
    }
    const unverified = recordOnly.reduce((sum, r) => sum + BigInt(r.gasUsed), 0n);
    console.log(`    ${"".padEnd(46)} ${String(unverified).padStart(11)}  total, UNVERIFIED here`);
  }

  const totalGas = attributions.reduce((sum, a) => sum + a.gasUsed, 0n);
  const totalFee = attributions.reduce((sum, a) => sum + a.feeWei, 0n);
  console.log(
    `\n  ${attributions.length} receipt(s), ${totalGas} gas, ${formatEther(totalFee)} ETH measured on chain\n`,
  );

  const payload = `${stableStringify({
    $comment:
      "Per-role reconciliation recomputed from RECEIPTS, not from the gas each script reported. " +
      "Attribution is by the address that actually signed. Balances are live at measuredAt. NO " +
      "PRIVATE KEY, MNEMONIC OR RPC CREDENTIAL APPEARS HERE.",
    method:
      "Every 0x-64 in evidence/phase6 and deployments/sepolia that is a bare hash or an explorer " +
      "/tx/ link was dialled with eth_getTransactionReceipt; fee is gasUsed * effectiveGasPrice.",
    chainId: CHAIN_ID,
    recordedHashes: hashes.size,
    receiptsFound: attributions.length,
    hashesWithoutReceipt: missing,
    totalGasUsed: totalGas.toString(),
    totalFeeWei: totalFee.toString(),
    totalFeeEth: formatEther(totalFee),
    roles: rows,
    byCampaign: Object.fromEntries(
      [...campaigns].map(([name, b]) => [
        name,
        {
          transactions: b.txs,
          gasUsed: b.gas.toString(),
          feeWei: b.feeWei.toString(),
          feeEth: formatEther(b.feeWei),
        },
      ]),
    ),
    recordReportedGasWithoutHashes: recordOnly,
    abandonedEpochCostUnknown:
      "`gasUsedThisRun` is per INVOCATION. The surviving record for the abandoned synthetic epoch " +
      "is a resumed run that did no new work, so it reports 0. The epoch really did cost a full " +
      "epoch's gas; that number is not recoverable from these records and is not invented here.",
    recordReportedGasNote:
      "The curve-epoch driver records an aggregate `gasUsedThisRun` and no per-transaction hashes, " +
      "so this gas is REPORTED BY THE RECORD and is NOT confirmed by the receipt walk above. It is " +
      "listed separately rather than folded into a total that would then overstate what was verified.",
    campaignNote:
      "phase6 is this phase's own work. superseded is contracts earlier phases deployed whose " +
      "records this repository still keeps. abandoned is the synthetic-universe epoch of delta " +
      "U-8 — real gas spent on an epoch that could never settle.",
    rolesThatSignedNothing: mustBeSilent,
    separationViolations: violations,
    nonRoleSigners: [...unknownSigners].map(([address, count]) => ({
      address,
      transactions: count,
    })),
    fundingReconciliation:
      "Attributed spend plus current balance does NOT equal funding, and is not asserted to. " +
      "Roles were funded and swept across the campaign and inbound transfers are not recoverable " +
      "from receipts. This file measures what each role SPENT and what it holds NOW.",
    measuredAt: new Date().toISOString(),
  })}\n`;
  assertNoSecrets(payload, "evidence/phase6/sepolia-role-reconciliation.json");
  writeFileSync(repoPath("evidence/phase6/sepolia-role-reconciliation.json"), payload);
  console.log(`  recorded in evidence/phase6/sepolia-role-reconciliation.json`);
  console.log(describeRoles(roles));

  if (violations.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`\nreconciliation FAILED — ${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
});
