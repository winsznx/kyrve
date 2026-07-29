/**
 * EIP-7825: no single transaction may exceed 2^24 gas on an Osaka chain.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS CHECK EXISTS, AND WHY IT IS EXPECTED TO FAIL RIGHT NOW
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Phase 3 sized every stage width against a "transaction gas ceiling" of 24,000,000, measured on a
 * local Hardhat node that the Nox plugin had configured as an OP chain at Isthmus. Isthmus has no
 * per-transaction gas cap. Osaka does: 16,777,216 gas, whatever the block limit is — 60,000,000 on
 * that same node, which is exactly why the limit is invisible unless you look for it.
 *
 * Ethereum Sepolia is on Osaka. Kyrve's artifacts compile for Osaka. So the ceiling Phase 3 sized
 * against is not the ceiling that applies, and the recorded peak stage transaction of 20,300,000
 * gas cannot be submitted to the chain Kyrve targets. Phase 4 found this by configuring the local
 * node correctly — `confidential/test/09-osaka.ts` measures the cap on both sides of the boundary,
 * and the full-scale benchmark then failed with a bare out-of-gas at stage C.
 *
 * The 4-cell Sepolia epoch Phase 3 really executed is far below the cap and is unaffected. What is
 * affected is the LAUNCH-SCALE claim: a 16 x 128 universe is not executable as configured.
 *
 * This script does not paper over that. It reads the measurements Phase 3 actually recorded and
 * fails while any of them exceeds the cap, naming each one and what it would have to become. That
 * is a true failure about a real limit, and a green gate that hid it would be worth less than
 * nothing. Recorded as delta S-2 in docs/phase4/PRD-DELTA.md.
 */

import { existsSync } from "node:fs";

import { readJson, repoPath } from "../lib/shell.js";

/** EIP-7825. 2^24, measured on the local Osaka node, not read from a specification. */
const TRANSACTION_GAS_CAP = 16_777_216;

interface StageGas {
  readonly universe: {
    readonly providers: number;
    readonly leaves: number;
    readonly cells: number;
  };
  readonly limits: {
    readonly transactionGasCeiling: number;
    readonly peakTransactionGas: number;
  };
  readonly cellsPerChunk: number;
  readonly perUnit: Readonly<Record<string, number>>;
  readonly stages: Readonly<Record<string, { readonly calls: number; readonly max: number }>>;
}

function main(): void {
  const path = repoPath("evidence/phase3/stage-gas.json");
  if (!existsSync(path)) {
    throw new Error(
      `no stage-gas measurement at ${path}. It is produced by the confidential benchmark: ` +
        "`pnpm --filter @kyrve/confidential test`. Reporting PASS without it would be asserting " +
        "something about numbers nobody measured.",
    );
  }

  const evidence = readJson<StageGas>(path);
  const { universe, limits } = evidence;

  console.log(`gas-cap — EIP-7825, ${TRANSACTION_GAS_CAP} gas per transaction (Osaka)\n`);
  console.log(
    `  measured universe   ${universe.providers} x ${universe.leaves}, ${universe.cells} cells`,
  );
  console.log(`  peak transaction    ${limits.peakTransactionGas} gas`);
  console.log(
    `  Phase 3 ceiling     ${limits.transactionGasCeiling} gas (pre-Osaka, superseded)\n`,
  );

  const violations: string[] = [];

  if (limits.transactionGasCeiling > TRANSACTION_GAS_CAP) {
    violations.push(
      `the recorded transaction gas ceiling is ${limits.transactionGasCeiling}, which is ` +
        `${limits.transactionGasCeiling - TRANSACTION_GAS_CAP} gas above the Osaka cap. Every stage ` +
        "width sized against it is sized against a limit no Osaka chain enforces.",
    );
  }
  if (limits.peakTransactionGas > TRANSACTION_GAS_CAP) {
    violations.push(
      `the peak stage transaction is ${limits.peakTransactionGas} gas, ` +
        `${limits.peakTransactionGas - TRANSACTION_GAS_CAP} above the cap. Ethereum Sepolia would ` +
        "refuse it outright, so the launch-scale epoch is not executable as configured.",
    );
  }
  console.log("  per-stage peak transaction:");
  for (const [stage, measured] of Object.entries(evidence.stages)) {
    const over = measured.max - TRANSACTION_GAS_CAP;
    console.log(
      `  ${over > 0 ? "OVER " : "ok   "} ${stage.padEnd(22)} ${String(measured.max).padStart(10)} gas` +
        `  ${over > 0 ? `${over} OVER` : `${-over} to spare`}`,
    );
    if (over > 0) {
      violations.push(
        `stage ${stage} peaks at ${measured.max} gas per transaction, ${over} above the cap`,
      );
    }
  }

  if (violations.length > 0) {
    /**
     * The width that WOULD fit, computed from the measured per-cell cost rather than guessed.
     *
     * Only stage C scales with `cellsPerChunk`, and that is a UNIVERSE PARAMETER rather than a
     * compile-time constant — which is why the immediate remedy needs no redeployment.
     */
    const perCell = evidence.perUnit["accumulateCell"] ?? 0;
    const fixedOverhead =
      (evidence.stages["accumulateLeafChunk"]?.max ?? 0) - perCell * evidence.cellsPerChunk;
    const fittingWidth =
      perCell > 0 ? Math.floor((TRANSACTION_GAS_CAP - fixedOverhead) / perCell) : 0;
    // Round down to a power-of-two-friendly width with headroom for the next measurement.
    const recommended = Math.max(32, Math.floor((fittingWidth * 0.9) / 32) * 32);

    console.error("\ngas-cap FAIL — the measured epoch cannot execute on an Osaka chain:\n");
    for (const violation of violations) console.error(`  - ${violation}`);
    console.error(
      "\n  THE REMEDY, in two parts, stated so it is not rediscovered.\n\n" +
        `  IMMEDIATE, and it needs NO redeployment. Only stage C scales with cellsPerChunk, and\n` +
        `  that is a universe parameter passed to CurveUniverseRegistry.createUniverse — not a\n` +
        `  compile-time constant. The measured cost is ${perCell} gas per cell with about\n` +
        `  ${fixedOverhead} gas of fixed overhead, so ${fittingWidth} cells is the largest chunk that\n` +
        `  fits. Create universes at ${recommended} instead of ${evidence.cellsPerChunk}. Every other\n` +
        "  stage width already fits, so nothing else changes except the transaction count — which\n" +
        "  is the quantity delta R-7 already warns keeper timeouts must scale with.\n\n" +
        "  DURABLE, and it does need a redeployment. CurveUniverseRegistry.MAX_CELLS_PER_TRANSACTION\n" +
        `  is a compile-time constant of ${evidence.cellsPerChunk}, so an over-wide universe can\n` +
        "  still be CREATED today and will simply fail mid-epoch. Lowering it makes the mistake\n" +
        "  unmakeable, and the curve layer already on Sepolia carries the old value.\n\n" +
        "  Then re-measure the benchmark and update @kyrve/curve's CURVE_STAGE_GAS.\n" +
        "  Recorded as delta S-2.\n",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\ngas-cap PASS — every measured stage transaction fits the ${TRANSACTION_GAS_CAP} gas cap`,
  );
}

main();
