/**
 * Sweeps the disposable funding wallets into the deployer.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * SEPOLIA ONLY, ENFORCED THREE WAYS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * "Send this account's entire balance to that address" is a dangerous primitive, and the only safe
 * version of it is one that cannot be aimed at a network where the balance is worth anything. So:
 *
 *   1. the chain is hardcoded to Ethereum Sepolia — there is no environment argument;
 *   2. the connected chain id is read and compared before any key is loaded;
 *   3. the destination is the DERIVED address of `DEPLOYER_PRIVATE_KEY`, never an argument.
 *
 * Point three matters most. A sweep script that takes a destination on the command line is one
 * typo away from an irreversible transfer, and one compromised shell history away from something
 * worse. The destination here is whatever wallet this repository already deploys with.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * DRY RUN BY DEFAULT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Without `--execute` this signs nothing and shows exactly what it would move. With it, it needs
 * the same two independent opt-ins as every other broadcast path in this repository, so neither a
 * stray export nor a leftover `.env` line is sufficient on its own.
 *
 * The private keys are never printed. Only addresses, balances and transaction hashes.
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

import { assertBroadcastArmed, deployer, loadEnv, sepoliaRpc } from "../lib/env.js";

const CHAIN_ID = 11_155_111;
const PREFIX = "DUST_PRIVATE_KEY_";
const MAX_WALLETS = 10;

/** A plain ETH transfer. Fixed by the protocol, so there is nothing to estimate. */
const TRANSFER_GAS = 21_000n;

/**
 * Headroom over the base fee, so a sweep does not strand itself if the fee rises between the
 * balance read and inclusion. The unspent portion stays in the dust wallet rather than being lost,
 * which is why over-reserving is the safe direction.
 */
const FEE_HEADROOM_MULTIPLIER = 2n;

interface DustWallet {
  readonly index: number;
  readonly address: Address;
  readonly privateKey: `0x${string}`;
  readonly balance: bigint;
}

async function main(): Promise<void> {
  loadEnv();
  const execute = process.argv.includes("--execute");

  const rpc = sepoliaRpc();
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpc.url),
    cacheTime: 0,
  });

  // Read the chain BEFORE loading any key. If this is not Sepolia, nothing is decrypted, nothing
  // is signed, and no key has been in memory alongside a live transport.
  const observed = await publicClient.getChainId();
  if (observed !== CHAIN_ID) {
    throw new Error(
      `connected chain is ${observed}, and this script only ever runs on Ethereum Sepolia ` +
        `(${CHAIN_ID}). It sweeps entire balances, so it is deliberately impossible to point at a ` +
        "network where that would matter.",
    );
  }

  const destination = deployer().address;

  const wallets: DustWallet[] = [];
  for (let i = 1; i <= MAX_WALLETS; i += 1) {
    const raw = (process.env[`${PREFIX}${i}`] ?? "").trim();
    if (raw.length === 0) continue;
    if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
      // Deliberately does not echo the value, not even its length.
      throw new Error(
        `${PREFIX}${i} is not a 32-byte hex key. Its value is not shown here by design.`,
      );
    }
    const key = raw as `0x${string}`;
    const address = privateKeyToAccount(key).address;
    wallets.push({
      index: i,
      address,
      privateKey: key,
      balance: await publicClient.getBalance({ address }),
    });
  }

  if (wallets.length === 0) {
    throw new Error(
      `no ${PREFIX}* found in .env. Run \`pnpm dust:generate\` first, then fund the addresses it prints.`,
    );
  }

  const gasPrice = await publicClient.getGasPrice();
  const reserve = TRANSFER_GAS * gasPrice * FEE_HEADROOM_MULTIPLIER;

  console.log(`dust sweep -> ${destination}\n`);
  console.log(`  RPC         ${rpc.redacted}`);
  console.log(`  chain       Ethereum Sepolia (${CHAIN_ID})`);
  console.log(`  gas price   ${Number(gasPrice) / 1e9} gwei`);
  console.log(`  fee reserve ${formatEther(reserve)} ETH per wallet`);
  console.log(`  mode        ${execute ? "EXECUTE" : "dry run (nothing is signed)"}\n`);

  let moved = 0n;
  let skipped = 0;

  for (const wallet of wallets) {
    const sendable = wallet.balance > reserve ? wallet.balance - reserve : 0n;
    const label = `${PREFIX}${wallet.index}`.padEnd(20);

    if (sendable === 0n) {
      console.log(
        `  skip  ${label} ${wallet.address}  ${formatEther(wallet.balance)} ETH — below the fee reserve`,
      );
      skipped += 1;
      continue;
    }

    if (!execute) {
      console.log(
        `  would ${label} ${wallet.address}  ${formatEther(sendable)} ETH of ${formatEther(wallet.balance)}`,
      );
      moved += sendable;
      continue;
    }

    const account = privateKeyToAccount(wallet.privateKey);
    const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpc.url) });
    const hash = await walletClient.sendTransaction({
      to: destination,
      value: sendable,
      gas: TRANSFER_GAS,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success")
      throw new Error(`sweep from ${wallet.address} reverted: ${hash}`);

    console.log(`  sent  ${label} ${wallet.address}  ${formatEther(sendable)} ETH  ${hash}`);
    moved += sendable;
  }

  const destinationBalance = await publicClient.getBalance({ address: destination });
  console.log(`\n  ${execute ? "moved" : "would move"}  ${formatEther(moved)} ETH`);
  if (skipped > 0) console.log(`  skipped ${skipped} wallet(s) with nothing worth sweeping`);
  console.log(`  deployer ${destination} now holds ${formatEther(destinationBalance)} ETH`);

  // The reason any of this exists, restated so the next step is obvious.
  const needed = parseEther("0.0236");
  if (destinationBalance >= needed) {
    console.log(
      `\n  That covers the Sepolia curve epoch (~0.0236 ETH). Next:\n` +
        "    pnpm exec tsx scripts/test/sepolia-epoch-budget.ts   # re-price against the live network\n",
    );
  } else if (execute) {
    console.log(
      `\n  Still ${formatEther(needed - destinationBalance)} ETH short of a Sepolia curve epoch.\n`,
    );
  }

  if (!execute) {
    console.log(
      "\n  Nothing was signed. To move it:\n" +
        "    DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true pnpm dust:sweep --execute\n",
    );
  }
}

// The opt-in check runs before anything else when executing, so a mistyped flag cannot broadcast.
if (process.argv.includes("--execute")) {
  loadEnv();
  assertBroadcastArmed();
}

main().catch((error: unknown) => {
  console.error(`\ndust:sweep FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
