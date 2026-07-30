/**
 * Reports the operational role set: who holds what, whether the key is here, whether the address
 * has code, and whether the roles that must sign can afford to.
 *
 * Read-only. It sends nothing, signs nothing and prints no key. It is the thing to run before a
 * deployment and after one, and it is what `verify:roles` reads its expectations from.
 *
 * WHY THE ACCOUNT-KIND COLUMN. The brief requires the deployment record to state whether each role
 * is an EOA or a contract, and it matters: a contract role can be a multisig with its own quorum,
 * or it can be an unreviewed proxy that hands the authority to someone else. This reports what the
 * chain says NOW, which is deliberately a different question from what `KyrveRoleRegistry`
 * recorded at declaration time — the registry's snapshot cannot move and the chain can.
 */

import { createPublicClient, formatEther, http } from "viem";
import { hardhat, sepolia } from "viem/chains";

import { safeErrorMessage, sepoliaRpc } from "../lib/env.js";
import { describeRoles, resolveRoles } from "../lib/roles.js";

const LOCAL_RPC = "http://127.0.0.1:8545";

/**
 * The floor a signing role needs before a Phase 6 sequence starts.
 *
 * Not a forecast — `scripts/deploy/preflight.ts` produces those from `eth_estimateGas` against the
 * live network. This is the much weaker claim that an address with less than this cannot land even
 * one ordinary transaction, so a run would stop partway with capital already committed.
 */
const MINIMUM_SIGNING_BALANCE_WEI = 1_000_000_000_000_000n; // 0.001 ETH

async function main(): Promise<void> {
  const environment = process.argv[2] === "sepolia" ? "sepolia" : "local";
  const isSepolia = environment === "sepolia";

  const set = resolveRoles(environment);
  const rpc = isSepolia ? sepoliaRpc() : { url: LOCAL_RPC, redacted: LOCAL_RPC };
  const client = createPublicClient({
    chain: isSepolia ? sepolia : hardhat,
    transport: http(rpc.url),
  });

  console.log(`\nroles:status — ${environment} — ${rpc.redacted}\n`);

  let reachable = true;
  try {
    await client.getChainId();
  } catch {
    reachable = false;
    console.log("  the node is unreachable, so balances and account kind are not shown\n");
  }

  const rows: string[] = [];
  let underfunded = 0;

  for (const role of describeRoles(set)) {
    let balance = "—";
    let kind = "—";
    if (reachable) {
      const wei = await client.getBalance({ address: role.address });
      const code = await client.getCode({ address: role.address });
      balance = `${formatEther(wei)} ETH`;
      kind = code !== undefined && code !== "0x" ? "contract" : "EOA";
      if (role.signs && wei < MINIMUM_SIGNING_BALANCE_WEI) underfunded += 1;
    }
    rows.push(
      `  ${role.role.padEnd(20)} ${role.address}  ${(role.keyHeld ? "key" : "no key").padEnd(6)} ` +
        `${(role.signs ? "signs" : "reads").padEnd(6)} ${kind.padEnd(9)} ${balance}`,
    );
  }

  console.log(rows.join("\n"));
  console.log("\n  authority");
  for (const role of describeRoles(set)) {
    console.log(`    ${role.role.padEnd(20)} ${role.authority}`);
  }

  if (underfunded > 0) {
    console.log(
      `\n  ${underfunded} signing role(s) hold less than ${formatEther(MINIMUM_SIGNING_BALANCE_WEI)} ETH. ` +
        "A sequence that starts underfunded strands provider capital until someone cancels it.\n",
    );
    process.exitCode = 1;
    return;
  }

  console.log("\n  seven distinct addresses, and every signing role can transact.\n");
}

main().catch((error: unknown) => {
  console.error(`\nroles:status failed — ${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
});
