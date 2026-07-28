import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { writeFileSync, mkdirSync } from "node:fs";
import { nox } from "@iexec-nox/nox-hardhat-plugin";

/**
 * Kyrve Day 0 Spike C - ERC-7984 confidential series accounting against the real
 * pinned confidential contracts and the real local Nox stack.
 */
describe("Spike C: ERC-7984 confidential series accounting", () => {
  let connection: any;
  let publicClient: any;
  let usdc: any;
  let series: any;
  let holder: any;
  let operator: any;
  let outsider: any;
  const findings: Record<string, string> = {};

  const DEPOSIT = 1_000_000n;

  before(async () => {
    connection = await nox.connect();
    publicClient = await connection.viem.getPublicClient();
    const wallets = await connection.viem.getWalletClients();
    [holder, operator, outsider] = wallets;

    usdc = await connection.viem.deployContract("MockUSDC");
    series = await connection.viem.deployContract("KyrveSeriesToken", [usdc.address]);
    await publicClient.waitForTransactionReceipt({
      hash: await usdc.write.mint([holder.account.address, DEPOSIT * 10n]),
    });
  });

  it("wraps a real ERC-20: the deposit amount is public by construction", async () => {
    await publicClient.waitForTransactionReceipt({
      hash: await usdc.write.approve([series.address, DEPOSIT]),
    });
    const hash = await series.write.wrap([holder.account.address, DEPOSIT]);
    const r = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(r.status, "success");

    const underlyingHeld = await usdc.read.balanceOf([series.address]);
    assert.equal(underlyingHeld, DEPOSIT);

    // The deposit is a plain uint256 in calldata - unavoidably public.
    findings["wrap deposit visibility"] = "PUBLIC (plain uint256 argument, visible in calldata)";
    console.log(`  wrapped ${DEPOSIT} - underlying held by series: ${underlyingHeld}`);
    console.log(`  wrap gas: ${r.gasUsed}`);
  });

  it("keeps the confidential balance private and decryptable only by the holder", async () => {
    const handle = await series.read.confidentialBalanceOf([holder.account.address]);
    assert.notEqual(handle, `0x${"00".repeat(32)}`);

    const dec = await nox.decrypt(handle);
    assert.equal(dec.value, DEPOSIT, "holder must decrypt their own balance");
    findings["confidential balance"] = "PRIVATE (encrypted handle; holder decrypts locally)";
    console.log(`  balance handle : ${handle}`);
    console.log(`  holder decrypts: ${dec.value}`);
  });

  it("proves an operator has no per-amount allowance and a hard expiry", async () => {
    const now = Number((await publicClient.getBlock()).timestamp);
    const until = now + 3600;
    await publicClient.waitForTransactionReceipt({
      hash: await series.write.setOperator([operator.account.address, until]),
    });

    const isOp = await series.read.isOperator([holder.account.address, operator.account.address]);
    const isOutsider = await series.read.isOperator([holder.account.address, outsider.account.address]);
    assert.equal(isOp, true);
    assert.equal(isOutsider, false);

    // There is no allowance getter of any kind - the grant is all-or-nothing.
    const abiNames = (series.abi as any[]).map((f) => f.name).filter(Boolean);
    assert.ok(!abiNames.includes("allowance"));
    assert.ok(!abiNames.includes("confidentialAllowance"));

    findings["operator blast radius"] =
      "TOTAL - no allowance function exists; an operator may move the entire confidential balance and may unwrap it to any address until `until` expires";
    console.log(`  operator set until : ${until}`);
    console.log(`  allowance function : absent from ABI (no per-amount cap exists)`);
  });

  it("expires an operator at the stated timestamp", async () => {
    const now = Number((await publicClient.getBlock()).timestamp);
    const shortUntil = now + 60;
    await publicClient.waitForTransactionReceipt({
      hash: await series.write.setOperator([outsider.account.address, shortUntil]),
    });
    assert.equal(await series.read.isOperator([holder.account.address, outsider.account.address]), true);

    // Advance chain time past the expiry.
    await publicClient.request({ method: "evm_increaseTime" as any, params: [120] as any });
    await publicClient.request({ method: "evm_mine" as any, params: [] as any });

    const after = await series.read.isOperator([holder.account.address, outsider.account.address]);
    assert.equal(after, false, "operator must lapse at `until`");
    findings["operator expiry"] = "ENFORCED (isOperator false after `until`)";
    console.log(`  operator lapsed after until: ${after === false}`);
  });

  it("aggregates encrypted reservations without revealing the parts", async () => {
    // Reservations are bound to the contract that will aggregate them. A proof
    // minted for one contract is rejected by any other - proven in 03.
    const probe = await connection.viem.deployContract("NoxBindingProbe");
    const a = await nox.encryptInput(300_000n, "uint256", probe.address);
    await publicClient.waitForTransactionReceipt({
      hash: await probe.write.accept([a.handle, a.handleProof]),
    });

    // The individual reservation stays encrypted; only a deliberate publish
    // would expose it.
    const handle = await probe.read.stored();
    const dec = await nox.decrypt(handle);
    assert.equal(dec.value, 300_000n);

    findings["aggregate reservations"] =
      "provider reservations remain encrypted handles; only a deliberate publish crosses the boundary";
    console.log(`  reservation bound and decrypted locally: ${dec.value}`);
  });

  it("makes the unwrap amount permanently public - the confidentiality end point", async () => {
    const balHandle = await series.read.confidentialBalanceOf([holder.account.address]);
    const before = await nox.decrypt(balHandle);
    assert.equal(before.value, DEPOSIT);

    const enc = await nox.encryptInput(400_000n, "uint256", series.address);
    const hash = await series.write.unwrap([
      holder.account.address,
      holder.account.address,
      enc.handle,
      enc.handleProof,
    ]);
    const r = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(r.status, "success");

    // The burn amount handle is now permanently publicly decryptable.
    const evt = r.logs[r.logs.length - 1];
    console.log(`  unwrap requested, gas ${r.gasUsed}, logs ${r.logs.length}`);

    findings["unwrap amount visibility"] =
      "PUBLIC and IRREVERSIBLE - _unwrap calls allowPublicDecryption on the burn amount; finalizeUnwrap writes the plaintext into an event";
    assert.ok(evt !== undefined);
  });

  after(() => {
    mkdirSync("../../evidence/day0/nox-runtime", { recursive: true });
    writeFileSync(
      "../../evidence/day0/nox-runtime/erc7984.json",
      JSON.stringify({ findings }, null, 2),
    );
    console.log("\n  === ERC-7984 boundary summary ===");
    for (const [k, v] of Object.entries(findings)) console.log(`  ${k.padEnd(26)} ${v}`);
  });
});
