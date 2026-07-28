import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { writeFileSync, mkdirSync } from "node:fs";
import { nox } from "@iexec-nox/nox-hardhat-plugin";

/**
 * Kyrve Day 0 Spike D - hierarchical curve engine benchmark.
 *
 * Measures the real, decomposed confidential curve against the local Nox stack and
 * checks every encrypted result against a plaintext reference model. Produces the
 * normative operation budget in docs/day0/OPERATION-BUDGET.md.
 */

const BLOCK_GAS = 30_000_000;
const SAFE_TX_GAS = 24_000_000; // 80% of a block, leaving headroom

// ---------------------------------------------------------------------------
// Plaintext reference model - the encrypted engine must match this exactly
// ---------------------------------------------------------------------------

interface RefProvider {
  capacity: bigint;
  minTickIndex: number;
  enabled: number;
  borrowerOk: number;
  portfolioOk: number;
}

function referenceCurve(
  provs: RefProvider[],
  tickIndexes: number[],
  minProviders: number,
  requested: bigint,
) {
  const cached = provs.map((p) => {
    const flags = p.enabled * p.borrowerOk * p.portfolioOk;
    const eligible = flags === 1 && p.capacity > 0n;
    return { countIfEligible: eligible ? 1 : 0, capacityIfEligible: eligible ? p.capacity : 0n };
  });

  const leaves = tickIndexes.map((tick, idx) => {
    let cap = 0n;
    let cnt = 0;
    provs.forEach((p, i) => {
      const rateOk = tick >= p.minTickIndex;
      if (rateOk) {
        cap += cached[i].capacityIfEligible;
        cnt += cached[i].countIfEligible;
      }
    });
    const gated = cnt >= minProviders ? cap : 0n;
    const fillable = gated < requested ? gated : requested;
    return { idx, capacityAcc: cap, countAcc: cnt, fillable };
  });

  let best = { idx: 0, fillable: 0n, capacityAcc: 0n };
  for (const lf of leaves) {
    if (lf.fillable > best.fillable) best = { idx: lf.idx, fillable: lf.fillable, capacityAcc: lf.capacityAcc };
  }
  return { cached, leaves, best };
}

function makeProviders(n: number): RefProvider[] {
  // Deterministic fixture: a mix of eligible, disabled, rate-restricted and empty.
  return Array.from({ length: n }, (_, i) => ({
    capacity: i % 7 === 6 ? 0n : BigInt((i + 1) * 1_000_000),
    minTickIndex: (i * 5) % 40,
    enabled: i % 11 === 10 ? 0 : 1,
    borrowerOk: i % 13 === 12 ? 0 : 1,
    portfolioOk: i % 17 === 16 ? 0 : 1,
  }));
}

interface StageRow {
  stage: string;
  units: number;
  gas: number;
  gasPerUnit: number;
}

describe("Spike D: hierarchical confidential curve engine", () => {
  let connection: any;
  let publicClient: any;
  let engine: any;
  const stages: StageRow[] = [];
  const PROVIDERS = 16;
  const MIN_PROVIDERS = 3;
  const REQUESTED = 50_000_000n;
  const refProvs = makeProviders(PROVIDERS);

  async function gasOf(promise: Promise<`0x${string}`>) {
    const hash = await promise;
    const r = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(r.status, "success");
    return Number(r.gasUsed);
  }

  before(async () => {
    connection = await nox.connect();
    publicClient = await connection.viem.getPublicClient();
    engine = await connection.viem.deployContract("KyrveCurveEngine");

    const req = await nox.encryptInput(REQUESTED, "uint256", engine.address);
    await gasOf(engine.write.seedRequest([req.handle, req.handleProof]));

    let seedGas = 0;
    for (let i = 0; i < PROVIDERS; i++) {
      const p = refProvs[i];
      const [c, t, e, b, pf] = await Promise.all([
        nox.encryptInput(p.capacity, "uint256", engine.address),
        nox.encryptInput(BigInt(p.minTickIndex), "uint16", engine.address),
        nox.encryptInput(BigInt(p.enabled), "uint16", engine.address),
        nox.encryptInput(BigInt(p.borrowerOk), "uint16", engine.address),
        nox.encryptInput(BigInt(p.portfolioOk), "uint16", engine.address),
      ]);
      seedGas += await gasOf(
        engine.write.seedProvider([
          BigInt(i),
          c.handle, c.handleProof,
          t.handle, t.handleProof,
          e.handle, e.handleProof,
          b.handle, b.handleProof,
          pf.handle, pf.handleProof,
        ]),
      );
    }
    stages.push({ stage: "A seedProvider", units: PROVIDERS, gas: seedGas, gasPerUnit: Math.round(seedGas / PROVIDERS) });
    console.log(`  Stage A seedProvider  x${PROVIDERS}  total ${seedGas}  per provider ${Math.round(seedGas / PROVIDERS)}`);
  });

  it("Stage B: caches provider-level predicates once per provider", async () => {
    let g = 0;
    for (let i = 0; i < PROVIDERS; i++) g += await gasOf(engine.write.cacheProvider([BigInt(i)]));
    stages.push({ stage: "B cacheProvider", units: PROVIDERS, gas: g, gasPerUnit: Math.round(g / PROVIDERS) });
    console.log(`  Stage B cacheProvider x${PROVIDERS}  total ${g}  per provider ${Math.round(g / PROVIDERS)}`);
  });

  it("Stage C: measures marginal per-cell cost at several chunk widths", async () => {
    const widths = [1, 2, 4, 8, 16];
    const measured: Record<number, number> = {};
    for (const w of widths) {
      const leafIdx = 900 + w; // scratch leaves, never finalized
      measured[w] = await gasOf(engine.write.accumulateLeafChunk([BigInt(leafIdx), 39, 0n, BigInt(w)]));
      console.log(`  Stage C chunk width ${String(w).padStart(2)}  gas ${measured[w]}`);
    }
    const perCell = Math.round((measured[16] - measured[1]) / 15);
    const overhead = measured[1] - perCell;
    stages.push({ stage: "C accumulate/cell", units: 1, gas: perCell, gasPerUnit: perCell });
    console.log(`  => marginal per (provider,leaf) cell: ${perCell} gas`);
    console.log(`  => fixed per-chunk overhead:          ${overhead} gas`);
    console.log(`  => max cells in one ${SAFE_TX_GAS / 1e6}M-gas tx:      ${Math.floor((SAFE_TX_GAS - overhead) / perCell)}`);
  });

  it("Stage D+E+F: measures finalize, reduce and allocate", async () => {
    // Build 8 real leaves so reduce has something to work on.
    const LEAVES = 8;
    const ticks = Array.from({ length: LEAVES }, (_, i) => i * 5 + 4);
    let accGas = 0;
    for (let l = 0; l < LEAVES; l++) {
      accGas += await gasOf(engine.write.accumulateLeafChunk([BigInt(l), ticks[l], 0n, BigInt(PROVIDERS)]));
    }
    console.log(`  Stage C  ${LEAVES} leaves x ${PROVIDERS} providers  total ${accGas}`);

    let finGas = 0;
    for (let l = 0; l < LEAVES; l++) finGas += await gasOf(engine.write.finalizeLeaf([BigInt(l), MIN_PROVIDERS]));
    stages.push({ stage: "D finalizeLeaf", units: LEAVES, gas: finGas, gasPerUnit: Math.round(finGas / LEAVES) });
    console.log(`  Stage D finalizeLeaf  x${LEAVES}  total ${finGas}  per leaf ${Math.round(finGas / LEAVES)}`);

    const redGas = await gasOf(engine.write.reduceWinnerChunk([0n, BigInt(LEAVES), true]));
    stages.push({ stage: "E reduceWinner", units: LEAVES, gas: redGas, gasPerUnit: Math.round(redGas / LEAVES) });
    console.log(`  Stage E reduceWinner  x${LEAVES}  total ${redGas}  per leaf ${Math.round(redGas / LEAVES)}`);

    let allocGas = 0;
    for (let i = 0; i < PROVIDERS; i++) allocGas += await gasOf(engine.write.allocate([BigInt(i), ticks[LEAVES - 1]]));
    stages.push({ stage: "F allocate", units: PROVIDERS, gas: allocGas, gasPerUnit: Math.round(allocGas / PROVIDERS) });
    console.log(`  Stage F allocate      x${PROVIDERS}  total ${allocGas}  per provider ${Math.round(allocGas / PROVIDERS)}`);

    // The single deliberate public/private boundary crossing.
    const pubGas = await gasOf(engine.write.publishWinner([]));
    stages.push({ stage: "E2 publishWinner", units: 1, gas: pubGas, gasPerUnit: pubGas });
    console.log(`  Stage E2 publishWinner       gas ${pubGas}`);

    // ---- result equivalence against the plaintext reference ----
    const ref = referenceCurve(refProvs, ticks, MIN_PROVIDERS, REQUESTED);
    const winFill = await nox.publicDecrypt(await engine.read.winnerFillable());
    const winIdx = await nox.publicDecrypt(await engine.read.winnerLeafIndex());

    console.log(`\n  reference winner : leaf ${ref.best.idx} fillable ${ref.best.fillable}`);
    console.log(`  encrypted winner : leaf ${winIdx.value} fillable ${winFill.value}`);
    assert.equal(winFill.value, ref.best.fillable, "encrypted fillable must match plaintext reference");
    assert.equal(Number(winIdx.value), ref.best.idx, "encrypted winning leaf must match plaintext reference");
  });

  after(() => {
    const perCell = stages.find((s) => s.stage === "C accumulate/cell")?.gas ?? 0;
    const cachePer = stages.find((s) => s.stage === "B cacheProvider")?.gasPerUnit ?? 0;
    const finPer = stages.find((s) => s.stage === "D finalizeLeaf")?.gasPerUnit ?? 0;
    const redPer = stages.find((s) => s.stage === "E reduceWinner")?.gasPerUnit ?? 0;
    const allocPer = stages.find((s) => s.stage === "F allocate")?.gasPerUnit ?? 0;

    const envelopes = [
      [4, 16], [8, 32], [8, 64], [16, 64], [16, 128],
    ].map(([P, L]) => {
      const cells = P * L;
      const cellGas = cells * perCell;
      const totalGas = P * cachePer + cellGas + L * finPer + L * redPer + P * allocPer;
      const cellsPerTx = Math.floor(SAFE_TX_GAS / perCell);
      const txs = Math.ceil(cells / cellsPerTx) + Math.ceil(L / 64) + 2;
      return { providers: P, leaves: L, cells, cellGas, totalGas, txs, maxTxGas: SAFE_TX_GAS };
    });

    console.log("\n  === ENVELOPES (derived from measured marginal costs) ===");
    console.log("  providers x leaves |  cells |    cell gas |   total gas | txs");
    for (const e of envelopes) {
      console.log(
        `  ${String(e.providers).padStart(9)} x ${String(e.leaves).padStart(3)} | ${String(e.cells).padStart(6)} | ${String(e.cellGas).padStart(11)} | ${String(e.totalGas).padStart(11)} | ${String(e.txs).padStart(3)}`,
      );
    }

    mkdirSync("../../evidence/day0/nox-runtime", { recursive: true });
    writeFileSync(
      "../../evidence/day0/nox-runtime/curve-benchmark.json",
      JSON.stringify({ blockGas: BLOCK_GAS, safeTxGas: SAFE_TX_GAS, stages, envelopes }, null, 2),
    );
  });
});
