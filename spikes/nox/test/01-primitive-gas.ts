import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { writeFileSync, mkdirSync } from "node:fs";
import { nox } from "@iexec-nox/nox-hardhat-plugin";

/**
 * Kyrve Day 0 Spike C/D - per-primitive gas measurement.
 *
 * Every primitive runs at n=1 and n=N against the real local Nox stack. The marginal
 * per-operation cost is (gas(N) - gas(1)) / (N - 1), which cancels transaction and
 * calldata overhead. Feeds the operation budget in docs/day0/OPERATION-BUDGET.md.
 */

const N = 10;

interface Row {
  primitive: string;
  gasAt1: number;
  gasAtN: number;
  marginalGas: number;
  note: string;
}

describe("Spike C/D: Nox primitive gas", () => {
  let connection: Awaited<ReturnType<typeof nox.connect>>;
  let probe: any;
  let publicClient: any;
  const rows: Row[] = [];

  before(async () => {
    connection = await nox.connect();
    publicClient = await connection.viem.getPublicClient();
    probe = await connection.viem.deployContract("NoxPrimitiveGas");

    const big = await nox.encryptInput(1_000_000n, "uint256", probe.address);
    const small = await nox.encryptInput(7n, "uint256", probe.address);
    const s16a = await nox.encryptInput(3n, "uint16", probe.address);
    const s16b = await nox.encryptInput(5n, "uint16", probe.address);

    const tx = await probe.write.seed([
      big.handle, big.handleProof,
      small.handle, small.handleProof,
      s16a.handle, s16a.handleProof,
      s16b.handle, s16b.handleProof,
    ]);
    const r = await publicClient.waitForTransactionReceipt({ hash: tx });
    assert.equal(r.status, "success");
    console.log(`  seed tx gas (4x fromExternal + 4x allowThis + lt + allowThis): ${r.gasUsed}`);
  });

  async function measure(name: string, fn: string, note: string, extra: any[] = []) {
    const g = async (n: number) => {
      const hash = await probe.write[fn]([BigInt(n), ...extra]);
      const rec = await publicClient.waitForTransactionReceipt({ hash });
      assert.equal(rec.status, "success", `${fn} must succeed`);
      return Number(rec.gasUsed);
    };
    const gasAt1 = await g(1);
    const gasAtN = await g(N);
    const marginalGas = Math.round((gasAtN - gasAt1) / (N - 1));
    rows.push({ primitive: name, gasAt1, gasAtN, marginalGas, note });
    console.log(
      `  ${name.padEnd(18)} n=1 ${String(gasAt1).padStart(8)}   n=${N} ${String(gasAtN).padStart(9)}   marginal ${String(marginalGas).padStart(7)}`,
    );
  }

  it("measures arithmetic", async () => {
    await measure("add", "opAdd", "unsafe, wrapping");
    await measure("sub", "opSub", "unsafe, wrapping");
    await measure("mul", "opMul", "unsafe, wrapping");
    await measure("div", "opDiv", "unsafe, saturates on /0");
    await measure("safeAdd", "opSafeAdd", "returns (ebool,T)");
    await measure("safeSub", "opSafeSub", "returns (ebool,T)");
    await measure("safeMul", "opSafeMul", "returns (ebool,T)");
    await measure("safeDiv", "opSafeDiv", "returns (ebool,T)");
  });

  it("measures comparison and select", async () => {
    await measure("lt", "opLt", "-> ebool");
    await measure("ge", "opGe", "-> ebool");
    await measure("eq", "opEq", "-> ebool");
    await measure("select(euint256)", "opSelect256", "no ebool overload exists");
    await measure("select(euint16)", "opSelect16", "indicator width");
  });

  it("measures 16-bit width and conversions", async () => {
    await measure("add16", "opAdd16", "euint16");
    await measure("mul16", "opMul16", "euint16 - indicator combine");
    await measure("toEuint16", "opToEuint16", "plaintext -> handle");
    await measure("toEuint256", "opToEuint256", "plaintext -> handle");
  });

  it("measures ACL", async () => {
    const [w] = await connection.viem.getWalletClients();
    await measure("allowThis", "opAllowThis", "persistent, irreversible");
    await measure("allow", "opAllow", "persistent, irreversible", [w.account.address]);
    await measure("allowTransient", "opAllowTransient", "one transaction", [w.account.address]);
  });

  it("measures the Kyrve composites", async () => {
    await measure("indicator", "opIndicator", "ebool -> euint16 0/1");
    await measure("conjunction6", "opConjunction6", "6 selects + 5 muls = 1 eligibility cell");
  });

  after(() => {
    mkdirSync("../../evidence/day0/nox-runtime", { recursive: true });
    writeFileSync(
      "../../evidence/day0/nox-runtime/primitive-gas.json",
      JSON.stringify({ sampleN: N, rows }, null, 2),
    );
    const conj = rows.find((r) => r.primitive === "conjunction6");
    const ind = rows.find((r) => r.primitive === "indicator");
    console.log("\n  === derived ===");
    if (ind) console.log(`  one indicator (select+2 const): ${ind.marginalGas} gas`);
    if (conj) {
      console.log(`  one eligibility cell (6-term):  ${conj.marginalGas} gas`);
      console.log(`  16 providers x 128 leaves:      ${(conj.marginalGas * 16 * 128).toLocaleString()} gas`);
      console.log(`  cells per 30M-gas block:        ${Math.floor(30_000_000 / conj.marginalGas)}`);
    }
  });
});
