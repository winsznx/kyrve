import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { writeFileSync, mkdirSync } from "node:fs";
import { nox } from "@iexec-nox/nox-hardhat-plugin";

/**
 * Kyrve Day 0 Spike C - input binding, ACL lifecycle, async timing and
 * confidential-failure indistinguishability, all against the real local stack.
 */

interface Sample {
  scenario: string;
  ops: number;
  txGas: number;
  inclusionMs: number;
  handleReadyMs: number;
}

describe("Spike C: binding, ACL, lifecycle, indistinguishability", () => {
  let connection: any;
  let publicClient: any;
  let probe: any;
  let otherApp: any;
  let indist: any;
  let walletA: any;
  let walletB: any;
  const samples: Sample[] = [];
  const findings: Record<string, string> = {};

  before(async () => {
    connection = await nox.connect();
    publicClient = await connection.viem.getPublicClient();
    const wallets = await connection.viem.getWalletClients();
    walletA = wallets[0];
    walletB = wallets[1];
    probe = await connection.viem.deployContract("NoxBindingProbe");
    otherApp = await connection.viem.deployContract("NoxOtherApp");
    indist = await connection.viem.deployContract("NoxIndistinguishable");
  });

  // -------------------------------------------------------------------------
  // 2.2 external encrypted input binding
  // -------------------------------------------------------------------------

  it("accepts a correctly bound proof from the direct caller", async () => {
    const enc = await nox.encryptInput(12345n, "uint256", probe.address);
    const hash = await probe.write.accept([enc.handle, enc.handleProof]);
    const r = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(r.status, "success");
    findings["correct binding"] = "ACCEPTED";
  });

  it("rejects a proof presented by a different owner", async () => {
    const enc = await nox.encryptInput(999n, "uint256", probe.address);
    await assert.rejects(
      async () => {
        const hash = await probe.write.accept([enc.handle, enc.handleProof], { account: walletB.account });
        await publicClient.waitForTransactionReceipt({ hash });
      },
      "a proof bound to wallet A must not be usable by wallet B",
    );
    findings["wrong owner"] = "REJECTED";
  });

  it("rejects a proof minted for a different application contract", async () => {
    const enc = await nox.encryptInput(777n, "uint256", probe.address);
    await assert.rejects(
      async () => {
        const hash = await otherApp.write.accept([enc.handle, enc.handleProof]);
        await publicClient.waitForTransactionReceipt({ hash });
      },
      "a proof bound to probe must not be usable by otherApp",
    );
    findings["wrong app contract"] = "REJECTED";
  });

  it("rejects a malformed proof", async () => {
    const enc = await nox.encryptInput(555n, "uint256", probe.address);
    const mangled = (enc.handleProof.slice(0, -2) + "ff") as `0x${string}`;
    await assert.rejects(async () => {
      const hash = await probe.write.accept([enc.handle, mangled]);
      await publicClient.waitForTransactionReceipt({ hash });
    }, "a tampered signature must be rejected");
    findings["malformed proof"] = "REJECTED";
  });

  it("rejects a truncated proof", async () => {
    const enc = await nox.encryptInput(556n, "uint256", probe.address);
    const short = enc.handleProof.slice(0, 40) as `0x${string}`;
    await assert.rejects(async () => {
      const hash = await probe.write.accept([enc.handle, short]);
      await publicClient.waitForTransactionReceipt({ hash });
    }, "a short proof must be rejected");
    findings["truncated proof"] = "REJECTED";
  });

  // -------------------------------------------------------------------------
  // 2.5 ACL runtime
  // -------------------------------------------------------------------------

  it("proves the ACL lifecycle and the irreversibility of grants", async () => {
    const enc = await nox.encryptInput(4242n, "uint256", probe.address);
    await publicClient.waitForTransactionReceipt({
      hash: await probe.write.accept([enc.handle, enc.handleProof]),
    });

    const viewerBefore = await probe.read.isViewerOf([walletB.account.address]);
    await publicClient.waitForTransactionReceipt({
      hash: await probe.write.makeViewer([walletB.account.address]),
    });
    const viewerAfter = await probe.read.isViewerOf([walletB.account.address]);

    assert.equal(viewerBefore, false);
    assert.equal(viewerAfter, true);
    findings["addViewer"] = "GRANTED, and no removeViewer exists in the ABI";

    const publicBefore = await probe.read.isPublic();
    await publicClient.waitForTransactionReceipt({ hash: await probe.write.publish() });
    const publicAfter = await probe.read.isPublic();
    assert.equal(publicBefore, false);
    assert.equal(publicAfter, true);
    findings["allowPublicDecryption"] = "SET, and there is no un-set";

    // Confirm there is genuinely no revocation entry point.
    const abiNames = (probe.abi as any[]).map((f) => f.name).filter(Boolean);
    assert.ok(!abiNames.includes("removeViewer"));
    console.log(`  viewer granted   : ${viewerBefore} -> ${viewerAfter}`);
    console.log(`  publicly decrypt : ${publicBefore} -> ${publicAfter}`);
  });

  // -------------------------------------------------------------------------
  // 2.4 async lifecycle, repeated samples
  // -------------------------------------------------------------------------

  it("measures the async lifecycle with repeated samples", async () => {
    async function run(scenario: string, ops: number, runs: number) {
      for (let i = 0; i < runs; i++) {
        const a = await nox.encryptInput(BigInt(1000 + i), "uint256", indist.address);
        const e = await nox.encryptInput(1n, "uint16", indist.address);
        const t0 = Date.now();
        const hash = await indist.write.contribute([BigInt(i), a.handle, a.handleProof, e.handle, e.handleProof]);
        const r = await publicClient.waitForTransactionReceipt({ hash });
        const t1 = Date.now();
        await publicClient.waitForTransactionReceipt({ hash: await indist.write.publish() });
        const handle = await indist.read.total();
        await nox.publicDecrypt(handle);
        const t2 = Date.now();
        samples.push({
          scenario,
          ops,
          txGas: Number(r.gasUsed),
          inclusionMs: t1 - t0,
          handleReadyMs: t2 - t1,
        });
      }
    }

    await publicClient.waitForTransactionReceipt({ hash: await indist.write.seedTotal() });
    await run("small graph (6 ops)", 6, 10);

    const stat = (key: keyof Sample) => {
      const v = samples.map((s) => Number(s[key])).sort((a, b) => a - b);
      const p = (q: number) => v[Math.min(v.length - 1, Math.floor(v.length * q))];
      return { min: v[0], median: p(0.5), p90: p(0.9), max: v[v.length - 1] };
    };
    const ready = stat("handleReadyMs");
    const incl = stat("inclusionMs");
    console.log(`  runs                 : ${samples.length}`);
    console.log(`  tx inclusion ms      : min ${incl.min} median ${incl.median} p90 ${incl.p90} max ${incl.max}`);
    console.log(`  handle ready ms      : min ${ready.min} median ${ready.median} p90 ${ready.p90} max ${ready.max}`);
    assert.ok(samples.length === 10);
  });

  // -------------------------------------------------------------------------
  // 3.6 confidential-failure indistinguishability
  // -------------------------------------------------------------------------

  it("makes eligible and rejected contributions publicly indistinguishable", async () => {
    const fresh = await connection.viem.deployContract("NoxIndistinguishable");
    await publicClient.waitForTransactionReceipt({ hash: await fresh.write.seedTotal() });

    const cases = [
      { name: "eligible", amount: 1_000n, eligible: 1n },
      { name: "rate-ineligible", amount: 1_000n, eligible: 0n },
      { name: "underfunded", amount: 0n, eligible: 1n },
      { name: "cap-constrained", amount: 1_000n, eligible: 0n },
      { name: "market-disabled", amount: 1_000n, eligible: 0n },
    ];

    const observed: { name: string; gas: number; status: string; logs: number; topics: string }[] = [];
    for (const [i, c] of cases.entries()) {
      const a = await nox.encryptInput(c.amount, "uint256", fresh.address);
      const e = await nox.encryptInput(c.eligible, "uint16", fresh.address);
      const hash = await fresh.write.contribute([BigInt(i), a.handle, a.handleProof, e.handle, e.handleProof]);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      observed.push({
        name: c.name,
        gas: Number(r.gasUsed),
        status: r.status,
        logs: r.logs.length,
        topics: r.logs.map((l: any) => l.topics[0]).join(","),
      });
    }

    console.log("  scenario           status   gas     logs  topic0");
    for (const o of observed) {
      console.log(`  ${o.name.padEnd(18)} ${o.status.padEnd(8)} ${String(o.gas).padStart(7)}  ${o.logs}     ${o.topics.slice(0, 12)}...`);
    }

    const statuses = new Set(observed.map((o) => o.status));
    const logCounts = new Set(observed.map((o) => o.logs));
    const topics = new Set(observed.map((o) => o.topics));
    const gases = new Set(observed.map((o) => o.gas));

    assert.equal(statuses.size, 1, "all scenarios must share one public status");
    assert.equal(logCounts.size, 1, "all scenarios must emit the same number of logs");
    assert.equal(topics.size, 1, "all scenarios must emit the same event signature");

    findings["indistinguishability"] =
      `status/logs/topics identical across ${cases.length} scenarios; distinct gas values observed: ${gases.size}`;
    console.log(`\n  distinct gas values across scenarios: ${gases.size} (1 = no gas-side leakage)`);

    // The sum must equal only the eligible contribution.
    await publicClient.waitForTransactionReceipt({ hash: await fresh.write.publish() });
    const total = await nox.publicDecrypt(await fresh.read.total());
    assert.equal(total.value, 1_000n, "only the eligible contribution may reach the total");
    console.log(`  decrypted total: ${total.value} (only the single eligible 1000 contributed)`);
  });

  after(() => {
    mkdirSync("../../evidence/day0/nox-runtime", { recursive: true });
    writeFileSync(
      "../../evidence/day0/nox-runtime/binding-acl-lifecycle.json",
      JSON.stringify({ findings, samples }, null, 2),
    );
  });
});
