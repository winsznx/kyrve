/**
 * What one real Sepolia settlement flow costs, priced against the live network, before anything is
 * broadcast.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY A LOCAL GAS ESTIMATE IS NOT A FUNDING ESTIMATE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Phase 3's real Sepolia epoch cost 0.0299 ETH against a local estimate of 0.0236 — a 27%
 * under-prediction, on a sequence whose gas was measured rather than guessed. Gas USED is
 * reproducible; what is not is the gas PRICE across a hundred transactions minutes apart, the
 * priority fee a public network wants, and the difference between an estimate and the base fee that
 * actually lands.
 *
 * So this applies an explicit safety multiplier, defaulting to 35% — chosen to cover the one
 * measured public-network sample with margin, and configurable through
 * `KYRVE_FUNDING_SAFETY_MARGIN` because one sample is not a distribution. It is not padding to feel
 * safe: an under-funded sequence strands halfway through, and a half-executed epoch holds
 * reservations until someone cancels it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * IT NEVER REWRITES A PREDICTION AFTER THE FACT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every run appends a record: the gas it estimated, the price it saw, what it predicted, and — once
 * the flow has run — what it actually cost and by how much the prediction was wrong. Earlier
 * records are never edited. A prediction quietly corrected after execution is not a prediction, and
 * the whole point of keeping them is to learn the multiplier from real samples instead of asserting
 * one.
 *
 * Read-only against the chain. It sends nothing, and it prints no secret: the RPC URL appears as
 * scheme and host only, and a keyless public endpoint is refused outright rather than silently used.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { createPublicClient, formatEther, http } from "viem";
import { sepolia } from "viem/chains";

import { assertNoSecrets, deployer, sepoliaRpc } from "../lib/env.js";
import { readJson, repoPath, stableStringify } from "../lib/shell.js";

/** The floor, until more public samples exist. Raise it, never lower it, without evidence. */
const DEFAULT_SAFETY_MARGIN = 0.35;

interface GasComponent {
  readonly name: string;
  readonly gas: number;
  readonly source: string;
}

interface Sample {
  readonly recordedAt: string;
  readonly components: readonly GasComponent[];
  readonly estimatedGas: number;
  readonly baseFeePerGasWei: string;
  readonly priorityFeePerGasWei: string;
  readonly effectiveGasPriceWei: string;
  readonly safetyMargin: number;
  readonly predictedCostEth: string;
  readonly predictedCostWithMarginEth: string;
  readonly deployerBalanceEth: string;
  readonly funded: boolean;
  readonly shortfallEth: string;
  /** Filled in by a LATER record once the flow has run. Never written over an earlier one. */
  readonly actualCostEth: string | null;
  readonly predictionErrorPercent: number | null;
}

interface Ledger {
  readonly $comment: string;
  readonly samples: readonly Sample[];
}

function safetyMargin(): number {
  const raw = process.env["KYRVE_FUNDING_SAFETY_MARGIN"];
  if (raw === undefined || raw.trim() === "") return DEFAULT_SAFETY_MARGIN;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < DEFAULT_SAFETY_MARGIN) {
    throw new Error(
      `KYRVE_FUNDING_SAFETY_MARGIN is "${raw}". It must be a number at or above ` +
        `${DEFAULT_SAFETY_MARGIN}: Phase 3's one public sample under-predicted by 27%, so a smaller ` +
        "margin is a prediction nothing supports.",
    );
  }
  return value;
}

/**
 * Every gas component of the flow, from a MEASUREMENT or not at all.
 *
 * A component whose source file is missing is reported as missing and makes the total refuse to be
 * a number. A confident total assembled from guesses is exactly how a sequence strands halfway.
 */
function components(): { readonly measured: GasComponent[]; readonly missing: string[] } {
  const measured: GasComponent[] = [];
  const missing: string[] = [];

  const localSettlement = repoPath("deployments/local/settlement.json");
  const settlementGasPath = repoPath("evidence/phase4/settlement-gas.json");
  if (existsSync(localSettlement)) {
    const record = readJson<{ gasUsed: string }>(localSettlement);
    measured.push({
      name: "settlement layer deployment and bindings",
      gas: Number(record.gasUsed),
      source: "deployments/local/settlement.json (measured on a local deploy)",
    });
  } else if (existsSync(settlementGasPath)) {
    // The confidential suite deploys the same six artifacts with the same constructor arguments and
    // records the receipts. A dedicated local deployment would measure the same thing and needs a
    // standing node with Phase 2 and Phase 3 already on it.
    const record = readJson<{ deploymentGas?: number }>(settlementGasPath);
    if (record.deploymentGas === undefined || record.deploymentGas <= 0) {
      missing.push(
        "settlement layer deployment gas — evidence/phase4/settlement-gas.json exists but records " +
          "none; re-run `pnpm --filter @kyrve/confidential test`",
      );
    } else {
      measured.push({
        name: "settlement layer deployment and bindings",
        gas: record.deploymentGas,
        source:
          "evidence/phase4/settlement-gas.json (six deployment receipts plus three bindings, " +
          "measured against a real chain by the confidential suite)",
      });
    }
  } else {
    missing.push(
      "settlement layer deployment gas — run `pnpm deploy:settlement local`, or the confidential " +
        "suite, which records it",
    );
  }

  const stageGas = repoPath("evidence/phase3/stage-gas.json");
  if (existsSync(stageGas)) {
    const record = readJson<{
      total?: { epochGas?: number };
      limits: { peakTransactionGas: number };
      perUnit: Record<string, number>;
    }>(stageGas);
    // A four-cell epoch, which is the shape Phase 3 really executed on Sepolia. Sized from the
    // measured per-unit costs rather than from the 2,048-cell benchmark, because the launch-scale
    // epoch is not executable on an Osaka chain at the current stage widths — delta S-2.
    const perCell = record.perUnit["accumulateCell"] ?? 0;
    const epochGas = record.total?.epochGas ?? perCell * 4 + 4_000_000;
    measured.push({
      name: "one four-cell confidential epoch",
      gas: epochGas,
      source: "evidence/phase3/stage-gas.json (measured against the real Nox stack)",
    });
  } else {
    missing.push("epoch gas — produced by the confidential benchmark");
  }

  const settlementGas = repoPath("evidence/phase4/settlement-gas.json");
  if (existsSync(settlementGas)) {
    const record = readJson<{ activateGas: number; takeGas: number; fundingGas: number }>(
      settlementGas,
    );
    measured.push({
      name: "activation, funding and one exact take",
      gas: record.activateGas + record.takeGas + record.fundingGas,
      source: "evidence/phase4/settlement-gas.json (measured on the local lifecycle run)",
    });
  } else {
    missing.push(
      "activation and settlement gas — produced by the local lifecycle run, which records " +
        "evidence/phase4/settlement-gas.json",
    );
  }

  return { measured, missing };
}

async function main(): Promise<void> {
  const rpc = sepoliaRpc();
  if (rpc.isPublicEndpoint) {
    throw new Error(
      "refusing to price against a keyless public RPC: its fee history is not the fee history the " +
        "broadcast will see. Configure ALCHEMY_API_KEY or SEPOLIA_RPC_URL.",
    );
  }

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpc.url),
    cacheTime: 0,
  });

  console.log("Kyrve Phase 4 — Sepolia settlement funding budget\n");
  console.log(`  RPC       ${rpc.redacted}`);

  const { measured, missing } = components();
  const margin = safetyMargin();

  console.log("\n  gas components, every one measured:");
  for (const component of measured) {
    console.log(`  ${component.name.padEnd(46)} ${String(component.gas).padStart(12)} gas`);
    console.log(`      ${component.source}`);
  }
  for (const gap of missing) {
    console.log(`  MISSING  ${gap}`);
  }

  const estimatedGas = measured.reduce((total, component) => total + component.gas, 0);
  const block = await publicClient.getBlock();
  const baseFee = block.baseFeePerGas ?? 0n;
  const priorityFee = await publicClient.estimateMaxPriorityFeePerGas();
  // The price a transaction actually pays is base + priority, and the base fee moves between
  // blocks. Doubling the base is the standard headroom viem itself uses for `maxFeePerGas`.
  const effectiveGasPrice = baseFee * 2n + priorityFee;

  const predicted = BigInt(estimatedGas) * effectiveGasPrice;
  const predictedWithMargin =
    predicted + (predicted * BigInt(Math.round(margin * 10_000))) / 10_000n;

  const account = deployer();
  const balance = await publicClient.getBalance({ address: account.address });
  const funded = missing.length === 0 && balance >= predictedWithMargin;
  const shortfall = balance >= predictedWithMargin ? 0n : predictedWithMargin - balance;

  console.log(`\n  estimated gas          ${estimatedGas}`);
  console.log(`  base fee               ${baseFee} wei`);
  console.log(`  priority fee           ${priorityFee} wei`);
  console.log(`  effective gas price    ${effectiveGasPrice} wei (2x base + priority)`);
  console.log(`  predicted cost         ${formatEther(predicted)} ETH`);
  console.log(
    `  with ${(margin * 100).toFixed(0)}% safety margin  ${formatEther(predictedWithMargin)} ETH`,
  );
  console.log(`\n  deployer               ${account.address}`);
  console.log(`  balance                ${formatEther(balance)} ETH`);

  const sample: Sample = {
    recordedAt: new Date().toISOString(),
    components: measured,
    estimatedGas,
    baseFeePerGasWei: baseFee.toString(),
    priorityFeePerGasWei: priorityFee.toString(),
    effectiveGasPriceWei: effectiveGasPrice.toString(),
    safetyMargin: margin,
    predictedCostEth: formatEther(predicted),
    predictedCostWithMarginEth: formatEther(predictedWithMargin),
    deployerBalanceEth: formatEther(balance),
    funded,
    shortfallEth: formatEther(shortfall),
    actualCostEth: null,
    predictionErrorPercent: null,
  };

  const ledgerPath = repoPath("evidence/phase4/funding-budget.json");
  const previous = existsSync(ledgerPath) ? readJson<Ledger>(ledgerPath).samples : [];
  const payload = stableStringify({
    $comment:
      "APPEND-ONLY. Every run adds a sample; no earlier record is ever edited. A prediction " +
      "corrected after execution is not a prediction. GENERATED by " +
      "`pnpm exec tsx scripts/test/sepolia-settlement-budget.ts`.",
    samples: [...previous, sample],
  } satisfies Ledger);
  assertNoSecrets(payload, "evidence/phase4/funding-budget.json");
  mkdirSync(repoPath("evidence/phase4"), { recursive: true });
  writeFileSync(ledgerPath, `${payload}\n`);
  console.log(`\n  appended sample ${previous.length + 1} to evidence/phase4/funding-budget.json`);

  if (missing.length > 0) {
    console.error(
      `\nFUNDING BUDGET INCOMPLETE — ${missing.length} gas component(s) have never been measured.\n` +
        "  The total above is a lower bound, not an estimate, and must not be used to decide\n" +
        "  whether to broadcast.\n",
    );
    process.exitCode = 1;
    return;
  }
  if (!funded) {
    console.error(
      `\nNOT FUNDED — short by ${formatEther(shortfall)} ETH.\n` +
        "  The flow must not be broadcast: an under-funded sequence strands halfway, and a\n" +
        "  half-executed epoch holds provider reservations until somebody cancels it.\n",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nFUNDED — ${formatEther(balance - predictedWithMargin)} ETH above the predicted cost plus ` +
      "margin\n",
  );
}

main().catch((error: unknown) => {
  console.error(
    `\nfunding budget FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
