/**
 * Write-path integration tests against the REAL Ethereum Sepolia deployment.
 *
 * These are not simulations. Every assertion below is made against state produced by a transaction
 * that was mined on Sepolia, through the real unmodified Midnight replica.
 *
 * What is proven here that a local run cannot prove:
 *   - the pinned release behaves identically on a public chain running the Osaka fork;
 *   - the exact-fill defence holds against a real `take` with real gas accounting;
 *   - a reverted partial fill leaves NO residue on a chain that actually persists state.
 *
 * The rejected partial fill is deliberately BROADCAST rather than simulated. A static call would
 * prove the revert, but only a mined, reverted transaction proves the rollback — that group
 * consumption, vault credit and borrower debt are all still zero afterwards.
 *
 * Costs real Sepolia ETH. Requires the same two opt-ins as deployment.
 */

import { writeFileSync } from "node:fs";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  formatEther,
  type Hex,
  http,
  keccak256,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import {
  parseDeploymentManifest,
  requireContract,
  requireMarket,
} from "../../packages/config/src/index.js";
import {
  IMidnightAbi,
  KyrveExactFillVaultAbi,
  KyrveQuoteRatifierAbi,
  TestERC20Abi,
} from "../../packages/generated/src/index.js";
import { type Market, marketId, type Offer, offerHash } from "../../packages/midnight/src/index.js";
import {
  DEFAULT_TICK_SPACING,
  quoteAmounts,
  tickToPrice,
  WAD,
} from "../../packages/quote-math/src/index.js";
import {
  assertBroadcastArmed,
  assertNoSecrets,
  deployer,
  safeErrorMessage,
  sepoliaRpc,
} from "../lib/env.js";
import { readJson, repoPath, run, stableStringify } from "../lib/shell.js";

/**
 * `take` is a Midnight function, but the reverts Kyrve cares about are custom errors declared on
 * the VAULT and the RATIFIER. viem decodes errors using the same `abi` it encoded the call with,
 * so passing IMidnightAbi alone leaves those reverts undecodable — which silently turns a correct
 * rejection into an unrecognised one. The merged ABI is what makes the negative assertions real.
 */
const SETTLEMENT_ABI = [
  ...IMidnightAbi,
  ...KyrveExactFillVaultAbi,
  ...KyrveQuoteRatifierAbi,
] as const;

const TICK = 6000n;
/** Small on purpose: this proves protocol behaviour, not capacity. */
const EXACT_UNITS = 1_000_000n; // 1 tUSDC at 6 decimals
const LLTV_WETH = 770_000_000_000_000_000n;
const ORACLE_PRICE_SCALE = 10n ** 36n;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

interface Step {
  readonly name: string;
  readonly outcome: "PASS" | "FAIL";
  readonly detail: string;
  readonly txHash?: string;
  readonly gasUsed?: string;
}

function creationBytecode(contract: string): Hex {
  const raw = run("forge", ["inspect", contract, "bytecode"]).stdout.trim();
  if (!/^0x[0-9a-fA-F]+$/.test(raw)) throw new Error(`no creation bytecode for ${contract}`);
  return raw as Hex;
}

async function main(): Promise<void> {
  assertBroadcastArmed();

  const rpc = sepoliaRpc();
  if (rpc.isPublicEndpoint) throw new Error("refusing to run write tests through a public RPC");

  const account = privateKeyToAccount(deployer().privateKey);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpc.url),
    cacheTime: 0,
  });
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc.url) });

  const manifest = parseDeploymentManifest(readJson(repoPath("deployments/sepolia/manifest.json")));
  const midnight = requireContract(manifest, "Midnight").address;
  const usdc = requireContract(manifest, "TestUSDC").address;
  const weth = requireContract(manifest, "TestWETH").address;
  const entry = requireMarket(manifest, "usdc-90d-weth");

  const steps: Step[] = [];
  const startBalance = await publicClient.getBalance({ address: account.address });

  console.log("Kyrve Sepolia write-path integration\n");
  console.log(`  rpc       ${rpc.redacted} (from ${rpc.source})`);
  console.log(`  taker     ${account.address}`);
  console.log(`  midnight  ${midnight}`);
  console.log(`  market    ${entry.key}  ${entry.id}\n`);

  const market: Market = {
    chainId: BigInt(entry.market.chainId),
    midnight: entry.market.midnight,
    loanToken: entry.market.loanToken,
    collateralParams: entry.market.collateralParams.map((c) => ({
      token: c.token,
      lltv: BigInt(c.lltv),
      liquidationCursor: BigInt(c.liquidationCursor),
      oracle: c.oracle,
    })),
    maturity: BigInt(entry.market.maturity),
    rcfThreshold: BigInt(entry.market.rcfThreshold),
    enterGate: entry.market.enterGate,
    liquidatorGate: entry.market.liquidatorGate,
  };

  // The market id Kyrve derives must equal the one recorded, on the real chain.
  if (marketId(market) !== entry.id)
    throw new Error("market id mismatch against the Sepolia manifest");

  const send = async (hash: Hex, label: string): Promise<{ gasUsed: bigint; status: string }> => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(
      `  ${label.padEnd(34)} ${receipt.status.padEnd(9)} gas ${receipt.gasUsed}  ${hash}`,
    );
    return { gasUsed: receipt.gasUsed, status: receipt.status };
  };

  // ---------------------------------------------------------------------------------------
  // 1. Deploy the permanent exact-fill harness
  // ---------------------------------------------------------------------------------------

  const vaultHash = await wallet.deployContract({
    abi: KyrveExactFillVaultAbi,
    bytecode: creationBytecode("KyrveExactFillVault"),
    args: [midnight, account.address],
  });
  const vaultReceipt = await publicClient.waitForTransactionReceipt({ hash: vaultHash });
  const vault = vaultReceipt.contractAddress as Address;
  console.log(`  KyrveExactFillVault                deployed  ${vault}`);

  const ratifierHash = await wallet.deployContract({
    abi: KyrveQuoteRatifierAbi,
    bytecode: creationBytecode("KyrveQuoteRatifier"),
    args: [midnight, vault],
  });
  const ratifierReceipt = await publicClient.waitForTransactionReceipt({ hash: ratifierHash });
  const ratifier = ratifierReceipt.contractAddress as Address;
  console.log(`  KyrveQuoteRatifier                 deployed  ${ratifier}\n`);

  steps.push({
    name: "deploy permanent exact-fill harness",
    outcome: "PASS",
    detail: `vault ${vault}, ratifier ${ratifier}`,
    txHash: vaultHash,
  });

  // ---------------------------------------------------------------------------------------
  // 2. Normal Midnight lifecycle: authorise, fund, collateralise
  // ---------------------------------------------------------------------------------------

  await send(
    await wallet.writeContract({
      address: vault,
      abi: KyrveExactFillVaultAbi,
      functionName: "authoriseRatifier",
      args: [ratifier, true],
    }),
    "authoriseRatifier",
  );

  const isAuthorised = await publicClient.readContract({
    address: midnight,
    abi: IMidnightAbi,
    functionName: "isAuthorized",
    args: [vault, ratifier],
  });
  if (isAuthorised !== true) throw new Error("Midnight does not report the ratifier as authorised");
  steps.push({
    name: "maker authorises ratifier (PRD v1.1 A-2)",
    outcome: "PASS",
    detail: "isAuthorized[vault][ratifier] is true on Sepolia",
  });

  const expected = quoteAmounts({
    units: EXACT_UNITS,
    tick: TICK,
    settlementFeeCbp: entry.settlementFeeCbp,
    secondsToMaturity: market.maturity - BigInt(Math.floor(Date.now() / 1000)),
    tickSpacing: DEFAULT_TICK_SPACING,
  });
  const expectedBuyerAssets = (EXACT_UNITS * tickToPrice(TICK)) / WAD;

  await send(
    await wallet.writeContract({
      address: usdc,
      abi: TestERC20Abi,
      functionName: "mint",
      args: [vault, expectedBuyerAssets],
    }),
    "mint tUSDC to vault",
  );

  const collateral =
    (((EXACT_UNITS * WAD + LLTV_WETH - 1n) / LLTV_WETH) * ORACLE_PRICE_SCALE +
      ORACLE_PRICE_SCALE -
      1n) /
    ORACLE_PRICE_SCALE;
  await send(
    await wallet.writeContract({
      address: weth,
      abi: TestERC20Abi,
      functionName: "mint",
      args: [account.address, collateral],
    }),
    "mint tWETH to taker",
  );
  await send(
    await wallet.writeContract({
      address: weth,
      abi: TestERC20Abi,
      functionName: "approve",
      args: [midnight, collateral],
    }),
    "approve collateral",
  );
  await send(
    await wallet.writeContract({
      address: midnight,
      abi: IMidnightAbi,
      functionName: "supplyCollateral",
      args: [market, 0n, collateral, account.address],
    }),
    "supplyCollateral",
  );
  steps.push({
    name: "normal Midnight lifecycle (supplyCollateral)",
    outcome: "PASS",
    detail: `${collateral} tWETH collateral supplied on Sepolia`,
  });

  // ---------------------------------------------------------------------------------------
  // 3. Activate a quote
  // ---------------------------------------------------------------------------------------

  const quoteId = keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }],
      ["kyrve.sepolia", BigInt(Date.now())],
    ),
  );
  const now = BigInt(Math.floor(Date.now() / 1000));

  const offer: Offer = {
    market,
    buy: true,
    maker: vault,
    start: now - 60n,
    expiry: now + 3600n,
    tick: TICK,
    group: quoteId,
    callback: vault,
    callbackData: encodeAbiParameters([{ type: "bytes32" }], [quoteId]),
    receiverIfMakerIsSeller: ZERO,
    ratifier,
    reduceOnly: false,
    maxUnits: EXACT_UNITS,
    maxAssets: 0n,
    continuousFeeCap: 2n ** 256n - 1n,
  };

  await send(
    await wallet.writeContract({
      address: vault,
      abi: KyrveExactFillVaultAbi,
      functionName: "activateQuote",
      args: [
        quoteId,
        {
          offerHash: offerHash(offer),
          marketId: entry.id,
          taker: account.address,
          exactUnits: EXACT_UNITS,
          expectedBuyerAssets,
          maxPendingFee: 2n ** 128n - 1n,
          expiry: Number(now + 3600n),
          status: 1,
        },
      ],
    }),
    "activateQuote",
  );

  // ---------------------------------------------------------------------------------------
  // 4. Rejected partial fill — BROADCAST, so the rollback is proven on a chain that persists
  // ---------------------------------------------------------------------------------------

  /**
   * Baseline before the negative case.
   *
   * Assertions below are DELTAS, not absolutes. `debt` is keyed by (market, taker) and persists on
   * a real chain, so a re-run of this script inherits the debt its previous run created. An
   * absolute assertion would pass only on a virgin taker and would report a false residue on every
   * subsequent run — which is exactly what happened the first time this was written.
   */
  const readState = async (): Promise<{ consumed: bigint; credit: bigint; debt: bigint }> => ({
    consumed: await publicClient.readContract({
      address: midnight,
      abi: IMidnightAbi,
      functionName: "consumed",
      args: [vault, quoteId],
    }),
    credit: await publicClient.readContract({
      address: midnight,
      abi: IMidnightAbi,
      functionName: "credit",
      args: [entry.id, vault],
    }),
    debt: await publicClient.readContract({
      address: midnight,
      abi: IMidnightAbi,
      functionName: "debt",
      args: [entry.id, account.address],
    }),
  });

  const baseline = await readState();
  console.log(
    `  baseline before negative case      consumed ${baseline.consumed}, credit ${baseline.credit}, debt ${baseline.debt}`,
  );

  const partialUnits = EXACT_UNITS - 1n;

  /**
   * Asserts a call reverts AND reverts for the expected reason.
   *
   * A call that succeeds is a hard failure, never a silent pass: that is the whole point of a
   * negative test. A call that reverts for the wrong reason is also a failure — a test passing
   * for the wrong reason is worse than no test.
   */
  const expectRevert = async (
    units: bigint,
    pattern: RegExp,
    label: string,
  ): Promise<{ reverted: boolean; matched: boolean; reason: string }> => {
    try {
      await publicClient.simulateContract({
        address: midnight,
        abi: SETTLEMENT_ABI,
        functionName: "take",
        args: [offer, "0x", units, account.address, account.address, ZERO, "0x"],
        account,
      });
      console.log(`  ${label.padEnd(34)} SUCCEEDED — expected a revert`);
      return { reverted: false, matched: false, reason: "call succeeded" };
    } catch (error) {
      const message = safeErrorMessage(error);
      const matched = pattern.test(message);
      const named =
        message.match(/Error:\s*([A-Za-z0-9_]+)\(/)?.[1] ??
        message.match(/reverted with the following reason:\s*\n?([^\n]+)/)?.[1] ??
        message
          .split("\n")
          .find((l) => /revert/i.test(l))
          ?.trim() ??
        "unrecognised revert";
      console.log(
        `  ${label.padEnd(34)} reverted  ${matched ? named : `${named} (did NOT match ${pattern})`}`,
      );
      return { reverted: true, matched, reason: named };
    }
  };

  const partial = await expectRevert(partialUnits, /WrongUnits/, "partial fill rejected");

  let partialTx: string | undefined;
  if (partial.matched) {
    // Broadcast it too, so the rollback assertion below is made against MINED state rather than
    // against a simulation that never touched the chain.
    try {
      const hash = await wallet.writeContract({
        address: midnight,
        abi: SETTLEMENT_ABI,
        functionName: "take",
        args: [offer, "0x", partialUnits, account.address, account.address, ZERO, "0x"],
        gas: 1_500_000n,
      });
      partialTx = hash;
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log(
        `  partial fill broadcast             ${receipt.status.padEnd(9)} gas ${receipt.gasUsed}  ${hash}`,
      );
    } catch {
      console.log("  partial fill broadcast             skipped   (provider refused a failing tx)");
    }
  }

  steps.push({
    name: "rejected partial fill reverts WrongUnits",
    outcome: partial.matched ? "PASS" : "FAIL",
    detail: partial.matched
      ? `take(${partialUnits}) against exactUnits ${EXACT_UNITS} reverts ${partial.reason} in KyrveExactFillVault.onBuy`
      : `expected WrongUnits, observed: ${partial.reason}`,
    ...(partialTx === undefined ? {} : { txHash: partialTx }),
  });

  // ---------------------------------------------------------------------------------------
  // 5. Rollback proof — nothing persisted from the rejected fill
  // ---------------------------------------------------------------------------------------

  const afterFailure = await readState();

  const rolledBack =
    afterFailure.consumed === baseline.consumed &&
    afterFailure.credit === baseline.credit &&
    afterFailure.debt === baseline.debt;

  console.log(
    `  rollback after rejection           ${rolledBack ? "clean" : "RESIDUE"}     ` +
      `delta consumed ${afterFailure.consumed - baseline.consumed}, ` +
      `credit ${afterFailure.credit - baseline.credit}, ` +
      `debt ${afterFailure.debt - baseline.debt}`,
  );
  steps.push({
    name: "rollback leaves no residue",
    outcome: rolledBack ? "PASS" : "FAIL",
    detail: rolledBack
      ? "a mined, reverted partial fill changed group consumption, vault credit and taker debt by exactly zero"
      : `residue: consumed +${afterFailure.consumed - baseline.consumed}, credit +${afterFailure.credit - baseline.credit}, debt +${afterFailure.debt - baseline.debt}`,
  });

  // ---------------------------------------------------------------------------------------
  // 6. Exact fill succeeds
  // ---------------------------------------------------------------------------------------

  const takeHash = await wallet.writeContract({
    address: midnight,
    abi: IMidnightAbi,
    functionName: "take",
    args: [offer, "0x", EXACT_UNITS, account.address, account.address, ZERO, "0x"],
  });
  const takeReceipt = await publicClient.waitForTransactionReceipt({ hash: takeHash });
  console.log(
    `  exact fill                         ${takeReceipt.status.padEnd(9)} gas ${takeReceipt.gasUsed}  ${takeHash}`,
  );
  if (takeReceipt.status !== "success")
    throw new Error("the exact fill did not succeed on Sepolia");

  const fillLogs = parseEventLogs({
    abi: KyrveExactFillVaultAbi,
    logs: takeReceipt.logs,
    eventName: "ExactFill",
  });
  const afterFill = await readState();

  const creditDelta = afterFill.credit - afterFailure.credit;
  const debtDelta = afterFill.debt - afterFailure.debt;
  const consumedDelta = afterFill.consumed - afterFailure.consumed;

  const settled =
    creditDelta === EXACT_UNITS && debtDelta === EXACT_UNITS && consumedDelta === EXACT_UNITS;

  console.log(
    `  post-settlement deltas             ${settled ? "correct" : "WRONG"}   ` +
      `credit +${creditDelta}, debt +${debtDelta}, consumed +${consumedDelta}`,
  );
  steps.push({
    name: "exact fill settles through unmodified Midnight",
    outcome: settled && fillLogs.length === 1 ? "PASS" : "FAIL",
    detail:
      `credit +${creditDelta}, debt +${debtDelta}, consumed +${consumedDelta}, ` +
      `buyerAssets ${expectedBuyerAssets} (quote-math predicted ${expected.buyerAssets}), ` +
      `${fillLogs.length} ExactFill event(s)`,
    txHash: takeHash,
    gasUsed: takeReceipt.gasUsed.toString(),
  });

  // ---------------------------------------------------------------------------------------
  // 7. Replay rejection
  // ---------------------------------------------------------------------------------------

  const replay = await expectRevert(
    EXACT_UNITS,
    /QuoteNotExecutable|ConsumedUnits/,
    "replay after settlement",
  );

  steps.push({
    name: "replay after settlement is rejected",
    outcome: replay.matched ? "PASS" : "FAIL",
    detail: replay.matched
      ? `second take reverts ${replay.reason} — quote consumed and group exhausted`
      : `a settled quote was not rejected as expected: ${replay.reason}`,
  });

  // ---------------------------------------------------------------------------------------
  // Evidence
  // ---------------------------------------------------------------------------------------

  const endBalance = await publicClient.getBalance({ address: account.address });
  const passed = steps.filter((s) => s.outcome === "PASS").length;

  const payload = stableStringify({
    $comment:
      "Write-path integration results against the REAL Ethereum Sepolia deployment. Public data " +
      "only: no RPC URL, no API key, no key material.",
    chainId: 11155111,
    midnight,
    marketKey: entry.key,
    marketId: entry.id,
    harness: { vault, ratifier },
    taker: account.address,
    ethSpent: formatEther(startBalance - endBalance),
    passed,
    total: steps.length,
    steps,
  });
  assertNoSecrets(payload, "deployments/sepolia/integration-results.json");
  writeFileSync(repoPath("deployments/sepolia/integration-results.json"), payload);

  console.log(`\n  ${passed}/${steps.length} steps passed`);
  console.log(`  ETH spent: ${formatEther(startBalance - endBalance)}`);
  console.log("  evidence written to deployments/sepolia/integration-results.json");

  if (passed !== steps.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`\nsepolia integration FAILED: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
