/**
 * Funds the operational roles that sign, from the deployer.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS AT ALL
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Through Phase 5 one key paid for everything, because one key WAS everything. With the roles
 * separated the keeper pays for the curve epoch and the allocation, and the curator pays for the
 * universe, the series and the supply publication — from their own addresses, because that is what
 * `onlyKeeper` and `onlyCurator` mean. A sequence that starts with an unfunded keeper stops partway
 * with provider capital locked until someone cancels it, which is the failure P6-0 warned about.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE BUDGETS ARE UPPER BOUNDS, NOT FORECASTS, AND THE DIFFERENCE IS STATED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `scripts/deploy/preflight.ts` produces forecasts, from `eth_estimateGas` against the live network.
 * This does something weaker on purpose: it allocates a generous per-role gas ceiling so a role
 * cannot run out mid-sequence, and says so. Over-funding a role is recoverable — every role key is
 * held here and `pnpm roles:refund` returns the unspent balance — while under-funding one is not,
 * because the capital it stranded belongs to providers.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * SAFETY, THE SAME THREE WAYS `dust/sweep.ts` DOES IT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   1. the chain is hardcoded to Ethereum Sepolia — there is no environment argument;
 *   2. the connected chain id is read and compared before any key is loaded;
 *   3. the destinations are the RESOLVED ROLE ADDRESSES, never an argument. There is no path here
 *      that sends ETH to an address a caller chose.
 *
 * Dry run by default. Executing needs the same two independent opt-ins as every other broadcast in
 * this repository. No private key is ever printed.
 */

import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import { assertBroadcastArmed, sepoliaRpc } from "../lib/env.js";
import { type RoleName, resolveRoles, signingKey } from "../lib/roles.js";

const CHAIN_ID = 11_155_111;
const TRANSFER_GAS = 21_000n;

/**
 * Per-role gas ceilings for one complete Phase 6 Sepolia sequence.
 *
 * Derived from `evidence/phase5/funding-budget.json` (58,546,465 gas measured across the whole
 * Phase 5 sequence, of which roughly 27,300,000 was contract creation the DEPLOYER pays) and from
 * the Phase 6 local measurements in `evidence/phase6/*.json`:
 *
 *   keeper    one full confidential epoch's stages, activation, consumeChunk, unwrapFunding,
 *             allocateChunk, closeQuote, plus Cross matching at 1,185,064 gas per match and Roll
 *             netting at 871,491.
 *   curator   createUniverse, addMarket, activateUniverse, createSeries, setRedemptionFactor,
 *             publishAggregateSupply, issuePublicCapsule at 399,946.
 *   operator  cancelQuote and recoverFunding only. Small by design — the operator's authority is
 *             narrow, so its gas budget is too, and that is a property worth being able to see.
 *
 * The deployer keeps the remainder: it pays for every contract creation and it stands in for the
 * providers and the borrower on a public network.
 */
const GAS_CEILING: Readonly<Record<string, bigint>> = {
  keeper: 22_000_000n,
  curator: 5_000_000n,
  operator: 2_000_000n,
};

/** The same 35% floor Phase 3 and Phase 5 both under-predicted against. Never lowered. */
const SAFETY_MARGIN_BPS = 13_500n;

/** Below this the deployer cannot finish its own work, so the transfer is refused rather than made. */
const DEPLOYER_FLOOR_ETH = parseEther("0.04");

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const rpc = sepoliaRpc();
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc.url) });

  const onChainId = await publicClient.getChainId();
  if (onChainId !== CHAIN_ID) {
    throw new Error(`refusing to fund on chain ${onChainId}; this script is Ethereum Sepolia only`);
  }

  const roles = resolveRoles("sepolia", { requireKeys: ["deployer"] });
  const deployer = privateKeyToAccount(signingKey(roles, "deployer"));
  const wallet = createWalletClient({
    account: deployer,
    chain: sepolia,
    transport: http(rpc.url),
  });

  /**
   * Budgeted at the EFFECTIVE price, not at a `maxFeePerGas` ceiling.
   *
   * The first version used `baseFee * 2 + 1.5 gwei`, which is the right shape for a fee CAP and the
   * wrong one for a budget: it priced the roles at ~3.6 gwei against the ~1.16 gwei Phase 5 actually
   * paid, allocated three times what the keeper needs, and left the deployer unable to pay for its
   * own contract creations. The safety here comes from the 35% margin, which is a measured floor,
   * rather than from doubling a number that is already the number.
   */
  const block = await publicClient.getBlock();
  const baseFee = block.baseFeePerGas ?? 1_000_000_000n;
  const priority = await publicClient.estimateMaxPriorityFeePerGas();
  const gasPrice = baseFee + priority;

  console.log(`\nroles:fund -> the signing roles — ${rpc.redacted}\n`);
  console.log(`  chain       Ethereum Sepolia (${CHAIN_ID})`);
  console.log(`  base fee    ${Number(baseFee) / 1e9} gwei`);
  console.log(`  priority    ${Number(priority) / 1e9} gwei`);
  console.log(`  budgeted at ${Number(gasPrice) / 1e9} gwei effective`);
  console.log(`  margin      ${Number(SAFETY_MARGIN_BPS - 10_000n) / 100}%`);
  console.log(`  mode        ${execute ? "EXECUTE" : "dry run (nothing is signed)"}\n`);

  let balance = await publicClient.getBalance({ address: deployer.address });
  let total = 0n;
  const plan: { role: RoleName; to: Address; top: bigint; have: bigint }[] = [];

  for (const [role, ceiling] of Object.entries(GAS_CEILING)) {
    const name = role as RoleName;
    const to = roles.accounts[name].address;
    const target = (ceiling * gasPrice * SAFETY_MARGIN_BPS) / 10_000n;
    const have = await publicClient.getBalance({ address: to });
    // Top UP rather than send a fixed amount, so a re-run after a partial failure does not
    // double-fund and a role that already holds enough is skipped rather than topped again.
    const top = have >= target ? 0n : target - have;
    plan.push({ role: name, to, top, have });
    total += top;
  }

  for (const entry of plan) {
    const verb = entry.top === 0n ? "skip " : execute ? "send " : "would";
    console.log(
      `  ${verb} ${entry.role.padEnd(10)} ${entry.to}  ` +
        `holds ${formatEther(entry.have)} ETH  ` +
        (entry.top === 0n ? "— already funded" : `+ ${formatEther(entry.top)} ETH`),
    );
  }

  const fees = gasPrice * TRANSFER_GAS * BigInt(plan.filter((p) => p.top > 0n).length);
  console.log(`\n  total to send  ${formatEther(total)} ETH  (+ ${formatEther(fees)} ETH of fees)`);
  console.log(`  deployer holds ${formatEther(balance)} ETH`);

  if (total === 0n) {
    console.log("\n  every signing role is already funded. Nothing to do.\n");
    return;
  }

  if (balance - total - fees < DEPLOYER_FLOOR_ETH) {
    console.error(
      `\n  REFUSED: funding these roles would leave the deployer with ` +
        `${formatEther(balance - total - fees)} ETH, below the ${formatEther(DEPLOYER_FLOOR_ETH)} ETH ` +
        "floor it needs for its own contract creations. Fund the deployer first, or lower a ceiling " +
        "in GAS_CEILING and say in the phase record which part of the sequence was cut.\n",
    );
    process.exitCode = 1;
    return;
  }

  if (!execute) {
    console.log("\n  Nothing was signed. To move it:");
    console.log("    DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true pnpm roles:fund --execute\n");
    return;
  }

  assertBroadcastArmed();
  console.log("");
  for (const entry of plan) {
    if (entry.top === 0n) continue;
    const hash = await wallet.sendTransaction({
      to: entry.to,
      value: entry.top,
      chain: sepolia,
      account: deployer,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`funding ${entry.role} reverted (${hash})`);
    console.log(`  sent  ${entry.role.padEnd(10)} ${formatEther(entry.top)} ETH  ${hash}`);
  }

  balance = await publicClient.getBalance({ address: deployer.address });
  console.log(`\n  deployer now holds ${formatEther(balance)} ETH`);
  console.log("  Next: pnpm roles:status sepolia\n");
}

main().catch((error: unknown) => {
  console.error(
    `\nroles:fund failed — ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
