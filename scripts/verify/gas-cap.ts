/**
 * EIP-7825: no single transaction may exceed 2^24 gas on an Osaka chain.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS GATE IS FOR
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Phase 3 sized every stage width against a "transaction gas ceiling" of 24,000,000 — a judgement,
 * measured on a local Hardhat node the Nox plugin had configured as an OP chain at Isthmus, which
 * enforces no per-transaction gas limit at all. Osaka does: 16,777,216 gas, whatever the block limit
 * is, which on that same node is 60,000,000. That is precisely why the cap is invisible unless you
 * look for it.
 *
 * At 256 cells per chunk — Phase 3's recommendation — `accumulateLeafChunk` measured 18,193,386 gas.
 * It was the ONLY stage width over the cap, and it made the 16 x 128 launch universe unexecutable on
 * the chain Kyrve targets. Resolved in Phase 4: the bound is now 192, which measures 13,645,056, and
 * `CurveUniverseRegistry` refuses anything above it. Delta S-2.
 *
 * So this is a REGRESSION GATE now, not a standing failure. It reads the measurements the benchmark
 * actually recorded and fails if any stage exceeds the cap, which means it fails if anyone widens a
 * chunk past what the chain will accept. It also names any stage within 2,000,000 gas of the cap —
 * a warning rather than a failure, because those fit today, on a local measurement, and testnet gas
 * remains UNVERIFIED (AS-1).
 *
 * The negative fixture lives in two places, both asserting that 256 does NOT fit:
 * `packages/curve/test/constants.test.ts` in arithmetic, and `confidential/test/08-chunk-width.ts`
 * against the deployed registry. Neither can be satisfied by widening the bound back.
 */

import { existsSync } from "node:fs";

import { readJson, repoPath } from "../lib/shell.js";

/** EIP-7825. 2^24, measured on the local Osaka node, not read from a specification. */
const TRANSACTION_GAS_CAP = 16_777_216;
/**
 * Below this much headroom the next measurement could put a stage over, which is worth saying before
 * it happens rather than after. Mirrors `verify:contract-size`'s "tight" band, and for the same
 * reason: a limit you are 10% under is a limit you will meet.
 */
const WARN_HEADROOM_GAS = 2_000_000;

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
  const tight: string[] = [];
  for (const [stage, measured] of Object.entries(evidence.stages)) {
    const headroom = TRANSACTION_GAS_CAP - measured.max;
    const status = headroom < 0 ? "OVER " : headroom < WARN_HEADROOM_GAS ? "tight" : "ok   ";
    console.log(
      `  ${status} ${stage.padEnd(22)} ${String(measured.max).padStart(10)} gas` +
        `  ${headroom < 0 ? `${-headroom} OVER` : `${headroom} to spare`}`,
    );
    if (headroom < 0) {
      violations.push(
        `stage ${stage} peaks at ${measured.max} gas per transaction, ${-headroom} above the cap`,
      );
    } else if (headroom < WARN_HEADROOM_GAS) {
      tight.push(`${stage} (${headroom} to spare)`);
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
  console.log(
    `  measured at ${evidence.cellsPerChunk} cells per chunk over ${universe.cells} cells; the ` +
      "negative fixture that 256 does NOT fit lives in packages/curve/test/constants.test.ts and " +
      "confidential/test/08-chunk-width.ts",
  );
  if (tight.length > 0) {
    // A warning, not a failure. These stages fit today, on a local measurement, and testnet gas is
    // UNVERIFIED (AS-1) — so naming them is the honest middle ground between silence and a red gate.
    console.log(
      `  TIGHT, within ${WARN_HEADROOM_GAS} gas of the cap: ${tight.join(", ")}.\n` +
        "  These are the next widths that will need attention. Nothing is claimed about them beyond " +
        "the measurement above.",
    );
  }
}

main();
