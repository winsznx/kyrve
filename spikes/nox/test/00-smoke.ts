import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { nox, NOX_COMPUTE_ADDRESS, handleGatewayUrl, RPC_URL } from "@iexec-nox/nox-hardhat-plugin";

/**
 * Kyrve Day 0 Spike C - smoke.
 *
 * Proves the local Nox stack is genuinely running and executes a real encrypted
 * operation: two external encrypted inputs -> validated handles -> add -> public
 * decryption of the result. Nothing here is mocked.
 */
describe("Spike C smoke: real local Nox stack", () => {
  let connection: Awaited<ReturnType<typeof nox.connect>>;
  let probe: any;
  let caller: `0x${string}`;

  before(async () => {
    connection = await nox.connect();
    const [wallet] = await connection.viem.getWalletClients();
    caller = wallet.account.address;
    probe = await connection.viem.deployContract("NoxSmoke");
  });

  it("has a live NoxCompute at the plugin's deterministic address", async () => {
    const publicClient = await connection.viem.getPublicClient();
    const code = await publicClient.getCode({ address: NOX_COMPUTE_ADDRESS });
    assert.ok(code && code !== "0x", "NoxCompute must be etched");
    console.log("  NoxCompute      :", NOX_COMPUTE_ADDRESS);
    console.log("  NoxCompute bytes:", (code!.length - 2) / 2);
    console.log("  RPC             :", RPC_URL);
    console.log("  handle gateway  :", handleGatewayUrl());
    console.log("  probe contract  :", probe.address);
  });

  it("executes add(euint256, euint256) end to end and publicly decrypts the result", async () => {
    const a = 40n;
    const b = 2n;

    const encA = await nox.encryptInput(a, "uint256", probe.address);
    const encB = await nox.encryptInput(b, "uint256", probe.address);

    const t0 = Date.now();
    const txHash = await probe.write.addTwo([
      encA.handle,
      encA.handleProof,
      encB.handle,
      encB.handleProof,
    ]);
    const publicClient = await connection.viem.getPublicClient();
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const tInclusion = Date.now();

    assert.equal(receipt.status, "success");

    const resultHandle = await probe.read.sum();
    const decrypted = await nox.publicDecrypt(resultHandle);
    const tReady = Date.now();

    assert.equal(decrypted.value, a + b, "encrypted add must equal plaintext add");

    console.log("  caller            :", caller);
    console.log("  tx gas used       :", receipt.gasUsed.toString());
    console.log("  result handle     :", resultHandle);
    console.log("  decrypted value   :", decrypted.value.toString());
    console.log("  proof bytes       :", (decrypted.decryptionProof.length - 2) / 2);
    console.log("  tx inclusion ms   :", tInclusion - t0);
    console.log("  handle ready ms   :", tReady - tInclusion);
  });
});
