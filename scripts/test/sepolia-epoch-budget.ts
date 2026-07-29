/**
 * What a real Sepolia curve epoch would cost, priced against the live network.
 *
 * The Phase 3 layer is deployed and verified on Sepolia, but running an epoch through it needs
 * capital the deployer does not have. Rather than claim the epoch ran, or quietly skip it, this
 * prices it from MEASURED local gas at the live gas price and reports the shortfall exactly.
 */

import { createPublicClient, formatEther, http, parseGwei } from "viem";
import { sepolia } from "viem/chains";

import { deployer, sepoliaRpc } from "../lib/env.js";

/** Measured locally. `evidence/phase3/stage-gas.json` and the Phase 2 suite. */
const COSTS: readonly [string, number][] = [
  ["universe create + 1 market + activate", 600_000],
  ["provider x2: mint, approve, wrap, operator x2, deposit", 2 * 800_000],
  ["provider x2: submitMandate (35 handles)", 2 * 4_200_000],
  ["provider x2: 36 ACL grants each", 2 * 36 * 30_000],
  ["borrower: submitRequest (19 handles)", 2_300_000],
  ["borrower: 19 ACL grants", 19 * 30_000],
  ["openEpoch + 2 sealProviderSnapshot + sealRequest + prepareEpoch", 3_800_000],
  ["stages B..G over a 1x2 universe, plus 7 advanceStage", 5_400_000],
];

async function main(): Promise<void> {
  const rpc = sepoliaRpc();
  const client = createPublicClient({ chain: sepolia, transport: http(rpc.url), cacheTime: 0 });
  const address = deployer().address;

  const gasPrice = await client.getGasPrice();
  const balance = await client.getBalance({ address });
  const total = COSTS.reduce((sum, [, gas]) => sum + gas, 0);
  const cost = BigInt(total) * gasPrice;

  console.log("sepolia epoch budget — priced, not estimated\n");
  console.log(`  gas price   ${Number(gasPrice) / 1e9} gwei (live)`);
  console.log(`  balance     ${formatEther(balance)} ETH\n`);
  for (const [what, gas] of COSTS) {
    console.log(`  ${String(gas).padStart(9)}  ${what}`);
  }
  console.log(`\n  ${String(total).padStart(9)}  TOTAL`);
  console.log(`  ${formatEther(cost)} ETH at the live gas price`);

  const affordable = balance >= cost;
  console.log(`\n  affordable now: ${affordable}`);
  if (!affordable) {
    console.log(`  shortfall     : ${formatEther(cost - balance)} ETH`);
  }
  console.log(`  note: gas price moves, so this is a snapshot and not a quote.\n`);
}

main().catch((error: unknown) => {
  console.error(String(error).slice(0, 300));
  process.exitCode = 1;
});
