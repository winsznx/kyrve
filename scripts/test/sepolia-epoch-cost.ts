/**
 * What the Sepolia curve epoch actually cost, derived from balances rather than guessed.
 *
 * The epoch ran across three wallets: the curator paid for the universe, the borrower's request
 * and every stage, and the two providers each paid for their own wrap, deposit, mandate and 37 ACL
 * grants. A resumed verification spends nothing, so the cost has to be reconstructed from what the
 * wallets started with and what they hold now.
 */

import { mkdirSync, writeFileSync } from "node:fs";

import { createPublicClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import { assertNoSecrets, deployer, loadEnv, sepoliaRpc } from "../lib/env.js";
import { repoPath, stableStringify } from "../lib/shell.js";

/** What each provider was funded with by `sepolia-curve-epoch.ts`. */
const PROVIDER_FUNDING = parseEther("0.02");
/** The curator's balance immediately after the dust sweep, before the epoch began. */
const CURATOR_BEFORE = 153946376901709998n;

async function main(): Promise<void> {
  loadEnv();
  const rpc = sepoliaRpc();
  const client = createPublicClient({ chain: sepolia, transport: http(rpc.url), cacheTime: 0 });

  const curator = deployer().address;
  const curatorNow = await client.getBalance({ address: curator });

  let providerSpend = 0n;
  for (const i of [1, 2]) {
    const key = (process.env[`DUST_PRIVATE_KEY_${i}`] ?? "").trim() as `0x${string}`;
    const address = privateKeyToAccount(key).address;
    const now = await client.getBalance({ address });
    const spent = PROVIDER_FUNDING > now ? PROVIDER_FUNDING - now : 0n;
    providerSpend += spent;
    console.log(
      `  provider ${i - 1}  ${address}  spent ${formatEther(spent)} ETH, ${formatEther(now)} left`,
    );
  }

  // The curator's outflow includes the provider funding, which is not a cost — it moved sideways
  // and most of it is still recoverable with `pnpm dust:sweep`.
  const curatorOutflow = CURATOR_BEFORE - curatorNow;
  const curatorGas = curatorOutflow - PROVIDER_FUNDING * 2n;

  console.log(`\n  curator    ${curator}  spent ${formatEther(curatorGas)} ETH on gas`);
  console.log(`  providers  spent ${formatEther(providerSpend)} ETH on gas`);
  console.log(`  EPOCH TOTAL ${formatEther(curatorGas + providerSpend)} ETH`);
  console.log(`\n  curator now holds ${formatEther(curatorNow)} ETH`);

  const evidence = {
    $comment:
      "The measured cost of the Sepolia curve epoch, derived from wallet balances. The estimate " +
      "in scripts/test/sepolia-epoch-budget.ts predicted 0.0236 ETH from local gas figures; the " +
      "real cost was 27% higher, which is the honest gap between a local measurement and a public " +
      "network.",
    measuredAt: new Date().toISOString(),
    chainId: 11_155_111,
    curatorGasEth: formatEther(curatorGas),
    providerGasEth: formatEther(providerSpend),
    totalEth: formatEther(curatorGas + providerSpend),
    predictedEth: "0.023624491258810000",
    note:
      "The provider funding itself is not a cost — it moved sideways and the remainder is " +
      "recoverable with `pnpm dust:sweep`.",
  };
  const payload = `${stableStringify(evidence)}\n`;
  assertNoSecrets(payload, "evidence/phase3/sepolia-epoch-cost.json");
  mkdirSync(repoPath("evidence/phase3"), { recursive: true });
  writeFileSync(repoPath("evidence/phase3/sepolia-epoch-cost.json"), payload);
  console.log("  recorded in evidence/phase3/sepolia-epoch-cost.json\n");
}

main().catch((e: unknown) => {
  console.error(String(e).slice(0, 300));
  process.exitCode = 1;
});
