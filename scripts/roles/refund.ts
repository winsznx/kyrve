/**
 * Returns the signing roles' unspent balances to the deployer.
 *
 * This is what makes over-funding a role recoverable, and `roles:fund` is written on the assumption
 * that it exists: budgeting a keeper too generously costs nothing that cannot be reversed, while
 * budgeting one too tightly strands provider capital mid-sequence. That asymmetry is only true if
 * this script is real.
 *
 * It does NOT touch the deployer, the emergency authority, the residue beneficiary or the auditor.
 * The last three never sign, so a balance there is deliberate rather than leftover — and the residue
 * beneficiary in particular is a DESTINATION, so sweeping it would be the developer-wallet sweep
 * PRD §19.8 exists to forbid.
 *
 * SAFETY, the same three ways `dust/sweep.ts` does it: Ethereum Sepolia is hardcoded, the connected
 * chain id is checked before any key is loaded, and the destination is the DERIVED address of
 * `DEPLOYER_PRIVATE_KEY` rather than an argument. Dry run by default; two independent opt-ins to
 * execute. No private key is ever printed.
 */

import { createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import { assertBroadcastArmed, safeErrorMessage, sepoliaRpc } from "../lib/env.js";
import { type RoleName, resolveRoles, signingKey } from "../lib/roles.js";

const CHAIN_ID = 11_155_111;
const TRANSFER_GAS = 21_000n;
/** Headroom over the base fee, so a refund cannot strand itself if the fee rises before inclusion. */
const FEE_HEADROOM = 2n;

/** Only the roles that sign. The other three hold balances on purpose. */
const REFUNDABLE: readonly RoleName[] = ["keeper", "operator", "curator"];

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const rpc = sepoliaRpc();
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc.url) });

  const onChainId = await publicClient.getChainId();
  if (onChainId !== CHAIN_ID) {
    throw new Error(`refusing to refund on chain ${onChainId}; this script is Sepolia only`);
  }

  const roles = resolveRoles("sepolia", { requireKeys: ["deployer", ...REFUNDABLE] });
  const destination = roles.accounts.deployer.address;

  const block = await publicClient.getBlock();
  const baseFee = block.baseFeePerGas ?? 1_000_000_000n;
  const priority = await publicClient.estimateMaxPriorityFeePerGas();
  const maxFee = baseFee * FEE_HEADROOM + priority;
  const reserve = maxFee * TRANSFER_GAS;

  console.log(`\nroles:refund -> ${destination} — ${rpc.redacted}\n`);
  console.log(`  chain        Ethereum Sepolia (${CHAIN_ID})`);
  console.log(`  fee reserve  ${formatEther(reserve)} ETH per role`);
  console.log(`  mode         ${execute ? "EXECUTE" : "dry run (nothing is signed)"}\n`);

  // BEFORE the first send, not after. An earlier draft armed the check at the end of the loop,
  // which would have let every transfer land and then refused — the exact inversion the two opt-ins
  // exist to prevent.
  if (execute) assertBroadcastArmed();

  let moved = 0n;
  for (const role of REFUNDABLE) {
    const account = privateKeyToAccount(signingKey(roles, role));
    const balance = await publicClient.getBalance({ address: account.address });
    if (balance <= reserve) {
      console.log(
        `  skip  ${role.padEnd(10)} ${account.address}  ${formatEther(balance)} ETH — below the fee reserve`,
      );
      continue;
    }
    const value = balance - reserve;
    if (!execute) {
      console.log(
        `  would ${role.padEnd(10)} ${account.address}  ${formatEther(value)} ETH of ${formatEther(balance)}`,
      );
      moved += value;
      continue;
    }

    const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc.url) });
    const hash = await wallet.sendTransaction({
      to: destination,
      value,
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: priority,
      gas: TRANSFER_GAS,
      chain: sepolia,
      account,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`refunding ${role} reverted (${hash})`);
    console.log(`  sent  ${role.padEnd(10)} ${formatEther(value)} ETH  ${hash}`);
    moved += value;
  }

  console.log(`\n  ${execute ? "moved" : "would move"}  ${formatEther(moved)} ETH`);
  console.log(
    `  deployer holds ${formatEther(await publicClient.getBalance({ address: destination }))} ETH`,
  );

  if (!execute) {
    console.log("\n  Nothing was signed. To move it:");
    console.log(
      "    DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true pnpm roles:refund --execute\n",
    );
    return;
  }
  console.log("");
}

main().catch((error: unknown) => {
  console.error(`\nroles:refund failed — ${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
});
