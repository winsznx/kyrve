/**
 * Mint the public test token to an address, so a reviewer can walk the provider flow.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS AND WHY IT IS NOT A FAUCET FOR ANYTHING THAT MATTERS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `TestUnderlyingERC20.mint` is permissionless by construction — it is a Sepolia test token whose
 * whole purpose is to stand in for a loan token in a market nobody is trading. Anyone can already
 * call it from Etherscan. This script is a convenience over that, not a privilege over it, and it
 * confers nothing a reviewer could not do themselves.
 *
 * Nothing here touches the confidential layer. The amount minted is a plain `uint256` in a public
 * ERC-20, exactly as public as the wrap that follows it, and no encrypted quantity is created,
 * granted or published by running this.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * IT REFUSES TO BROADCAST WITHOUT BOTH OPT-INS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `assertBroadcastArmed` requires `DEPLOY_SEPOLIA` and `KYRVE_CONFIRM_BROADCAST` to be independently
 * true, so a leftover `.env` line cannot on its own send a transaction. That guard is not here
 * because a test-token mint is dangerous; it is here because every script in this repository that
 * can sign uses the same gate, and one that quietly did not would be the one somebody copies.
 *
 * Run a preflight first — with no opt-in it prints what it would do and exits without signing.
 *
 *   pnpm exec tsx scripts/demo/mint-test-token.ts 0xRecipient 10000
 *   DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true pnpm exec tsx scripts/demo/mint-test-token.ts 0xRecipient 10000
 *
 * The amount is given in WHOLE TOKENS and scaled here by the token's own `decimals()`, read from
 * chain rather than assumed. tUSDC has six, so a script that assumed eighteen would mint a
 * trillion times the intended amount and the mistake would look like a working run.
 */

import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatUnits,
  getAddress,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import { assertBroadcastArmed, broadcastArmed, deployer, sepoliaRpc } from "../lib/env.js";
import { repoPath } from "../lib/shell.js";

const ERC20 = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

/**
 * The token address: the SERIES' loan token, not the contract named `TestUnderlyingERC20`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THERE ARE TWO TEST TOKENS ON SEPOLIA AND MINTING THE WRONG ONE LOOKS LIKE SUCCESS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `deployments/sepolia/confidential.json` records a `TestUnderlyingERC20` at 0xd3f224ae…, and the
 * series' `loanToken` is 0x0257E18a…. Both are real, both are deployed, and only the second one is
 * the token the wrapper wraps — `served-record.ts` publishes `a.loanToken` under the
 * `TestUnderlyingERC20` key for exactly that reason.
 *
 * This is delta T-10 in a different costume. Three phases tolerated two test tokens because nothing
 * crossed back between them; the moment one did, activation reverted `FundingShortfall(600000509, 0)`
 * on a run where every encrypted step had succeeded. A mint against the wrong one would confirm on
 * chain, show a balance on Etherscan, and leave `/app/fund` reading zero — which is the worst kind of
 * failure to hit while recording, because everything says it worked.
 *
 * So this reads the same field the interface reads, from the same file, and never the name.
 */
async function testTokenAddress(): Promise<Address> {
  const { readFileSync } = await import("node:fs");
  const series = JSON.parse(readFileSync(repoPath("deployments/sepolia/series.json"), "utf8")) as {
    loanToken?: string;
  };

  if (series.loanToken === undefined) {
    throw new Error(
      "deployments/sepolia/series.json has no loanToken, so the token the wrapper wraps is unknown. " +
        "Minting the contract merely NAMED TestUnderlyingERC20 would produce a balance the " +
        "application cannot see.",
    );
  }
  return getAddress(series.loanToken);
}

async function main(): Promise<void> {
  const [recipientRaw, wholeTokens] = process.argv.slice(2);
  if (recipientRaw === undefined || wholeTokens === undefined) {
    throw new Error(
      "usage: tsx scripts/demo/mint-test-token.ts <recipient> <whole tokens>\n" +
        "       the amount is in whole tokens; this script applies the token's own decimals.",
    );
  }

  const recipient = getAddress(recipientRaw);
  const token = await testTokenAddress();
  const rpc = sepoliaRpc();
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc.url) });

  const [decimals, symbol, before] = await Promise.all([
    publicClient.readContract({ address: token, abi: ERC20, functionName: "decimals" }),
    publicClient.readContract({ address: token, abi: ERC20, functionName: "symbol" }),
    publicClient.readContract({
      address: token,
      abi: ERC20,
      functionName: "balanceOf",
      args: [recipient],
    }),
  ]);

  const amount = parseUnits(wholeTokens, decimals);

  console.log("");
  console.log(`  token       ${token} (${symbol}, ${String(decimals)} decimals)`);
  console.log(`  recipient   ${recipient}`);
  console.log(`  balance     ${formatUnits(before, decimals)} ${symbol}`);
  console.log(`  minting     ${formatUnits(amount, decimals)} ${symbol}`);

  if (!broadcastArmed()) {
    console.log("");
    console.log("  PREFLIGHT ONLY — nothing was signed.");
    console.log("  Re-run with DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true to broadcast.");
    console.log("");
    return;
  }
  assertBroadcastArmed();

  const { address: from, privateKey } = deployer();
  const wallet = createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: sepolia,
    transport: http(rpc.url),
  });

  console.log(`  signer      ${from}`);
  const hash = await wallet.writeContract({
    address: token,
    abi: ERC20,
    functionName: "mint",
    args: [recipient, amount],
  });
  console.log(`  tx          ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const after = await publicClient.readContract({
    address: token,
    abi: ERC20,
    functionName: "balanceOf",
    args: [recipient],
  });

  console.log(`  status      ${receipt.status}`);
  console.log(`  balance     ${formatUnits(after, decimals)} ${symbol}`);
  console.log(`  explorer    https://sepolia.etherscan.io/tx/${hash}`);
  console.log("");

  if (receipt.status !== "success") {
    throw new Error("the mint transaction reverted");
  }
  if (after - before !== amount) {
    throw new Error(
      `the balance moved by ${formatUnits(after - before, decimals)} rather than ` +
        `${formatUnits(amount, decimals)}. Something else touched this balance in the same block.`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
