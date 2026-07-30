/**
 * The connected Capsule and auditor flow, in a real Chromium against the running local stack.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE TWO STEPS PHASE 7 WAS MISSING, AND WHY THEY ARE THE ONES THAT MATTER
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every other browser step exercises a wallet reading its OWN value. This is the only one where a
 * grant crosses to a DIFFERENT wallet — the one place the confidentiality model is actually put at
 * risk by a product action rather than by a protocol one. A capsule that granted the live handle
 * instead of a frozen copy, or that aliased two recipients onto one handle, would look identical on
 * screen and would be permanent, because Nox has no `removeViewer`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS PROVES THAT A ROUTE EXISTING DOES NOT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Eighteen assertions, three wallet identities in three separate browser contexts with separate
 * storage and separate signing keys, and one deliberate change to the provider's live balance AFTER
 * the capsule is sealed. The load-bearing ones:
 *
 *   - the snapshot handle is not the live balance handle. Two handles that merely look different are
 *     indistinguishable from two that are identical unless somebody compares them.
 *   - burning part of the provider's live balance does not move the capsule's value. That is the
 *     whole meaning of "frozen", and it cannot be demonstrated without changing something.
 *   - the auditor is refused the provider's CURRENT balance, on chain, before any key material is
 *     released. A capsule that leaked the portfolio would still show a correct snapshot.
 *   - a third wallet is refused the capsule. The grant is to one recipient, not to "an auditor".
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE BALANCE CHANGE IS A REAL HOLDER ACTION, NOT A TEST POKE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `KyrveSeriesToken.redeem` burns the caller's own claim and records what they are owed. The holder
 * calls it directly — no operator, no keeper, no privileged path — so the balance change in step 8 is
 * something a provider can actually do, performed by the provider's own key. A synthetic write would
 * have proven the snapshot survives a synthetic write.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { type Address, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { repoPath } from "../lib/shell.js";
import { readLiveManifest } from "../stack/manifest.js";

/**
 * Three published development keys, worthless on any public network.
 *
 * Index 1 is the provider the stack allocated a real claim to. Index 12 is the declared AUDITOR role
 * from `docs/phase6/ROLES.md`, which is the correct recipient for a disclosure capsule. Index 6 holds
 * no role and no claim and is the third wallet — chosen deliberately over another provider, because
 * the interesting refusal here is "not the recipient" rather than "not a holder".
 */
export const WALLETS = {
  provider: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  auditor: "0xa267530f49f8280200edf313ee7af6b827f2a8bce2897751d06a843f644967b1",
  outsider: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
} as const;

export interface CapsuleEvidence {
  capsuleId?: string;
  snapshotDistinctFromLive: boolean;
  liveBalanceChangedAfterSealing: boolean;
  auditorDecryptedSnapshot: boolean;
  snapshotUnchangedByLiveChange: boolean;
  auditorRefusedLiveBalance: boolean;
  outsiderRefusedCapsule: boolean;
  originVerifiedFromChain: boolean;
  refreshKeptPublicAndDroppedPrivate: boolean;
  disconnectClearedPlaintext: boolean;
  refusalKinds: Record<string, string>;
}

/** Every origin the pages contacted, so "no private value reaches a server" is measured. */
const origins = new Set<string>();

interface Served {
  readonly series: { readonly seriesId: string; readonly addresses: Record<string, Address> };
  readonly market: { readonly addresses: { readonly KyrveCapsuleVault?: Address } };
}

export async function runCapsuleFlow(): Promise<CapsuleEvidence> {
  const live = await readLiveManifest();
  assert.ok(live.live, `the local stack must be running: ${live.live ? "" : live.reason}`);
  const { manifest } = live;

  const served = JSON.parse(
    readFileSync(repoPath("apps/web/public/deployment.json"), "utf8"),
  ) as Served;
  const seriesId = served.series.seriesId;
  const token = served.series.addresses["KyrveSeriesToken"] as Address;
  assert.ok(
    served.market.addresses.KyrveCapsuleVault !== undefined,
    "the stack must have deployed a Capsule vault over the series this flow addresses",
  );

  const evidence: CapsuleEvidence = {
    snapshotDistinctFromLive: false,
    liveBalanceChangedAfterSealing: false,
    auditorDecryptedSnapshot: false,
    snapshotUnchangedByLiveChange: false,
    auditorRefusedLiveBalance: false,
    outsiderRefusedCapsule: false,
    originVerifiedFromChain: false,
    refreshKeptPublicAndDroppedPrivate: false,
    disconnectClearedPlaintext: false,
    refusalKinds: {},
  };

  const browser = await chromium.launch();
  try {
    // ── 1-3. The provider connects and reads their own live claim ─────────────────────────
    const provider = await connect(browser, manifest.webUrl, manifest, WALLETS.provider);
    await provider.page.goto(`${manifest.webUrl}/app/series/${seriesId}`);
    await provider.page.getByTestId("ownership-band").waitFor({ timeout: 90_000 });

    const providerAddress = (await provider.page.getByTestId("connected-account").innerText())
      .trim()
      .toLowerCase() as Address;

    await provider.page.getByTestId("own-balance").getByRole("button").click();
    await provider.page.getByTestId("own-balance-value").waitFor({ timeout: 120_000 });
    const liveBefore = numeric(await provider.page.getByTestId("own-balance-value").innerText());
    assert.ok(liveBefore.length > 0, "the provider must hold a real, readable claim");

    const liveHandle = await readHandle(
      manifest.rpcUrl,
      token,
      "confidentialBalanceOf",
      providerAddress,
    );

    // ── 4-5. The provider seals a capsule for the auditor, through the interface ───────────
    const auditorAddress = addressOf(WALLETS.auditor);
    await provider.page.goto(`${manifest.webUrl}/app/capsules`);
    await provider.page.getByTestId("capsule-recipient").waitFor({ timeout: 60_000 });
    await provider.page.getByTestId("capsule-recipient").fill(auditorAddress);
    await provider.page.getByTestId("capsule-days").fill("7");
    await provider.page.getByTestId("capsule-issue").click();
    await provider.page.getByTestId("capsule-issued").waitFor({ timeout: 120_000 });

    const capsuleLink = await provider.page
      .getByTestId("capsule-issued")
      .locator("a")
      .getAttribute("href");
    assert.ok(capsuleLink !== null, "the interface must link to the capsule it just sealed");
    const capsuleId = capsuleLink.split("/").pop() as `0x${string}`;
    evidence.capsuleId = capsuleId;

    // ── 6-7. The snapshot handle is NOT the live balance handle ────────────────────────────
    await provider.page.goto(`${manifest.webUrl}/app/capsules/${capsuleId}`);
    await provider.page.getByTestId("capsule-facts").waitFor({ timeout: 60_000 });
    const snapshotHandle = await readCapsuleSnapshot(
      manifest.rpcUrl,
      served.market.addresses.KyrveCapsuleVault,
      capsuleId,
    );
    assert.notEqual(
      snapshotHandle.toLowerCase(),
      liveHandle.toLowerCase(),
      "THE CAPSULE MUST FREEZE A COPY. If the snapshot were the live balance handle, the grant " +
        "would cover every future value of the provider's position, permanently — and Nox has no " +
        "removeViewer, so there would be no way back.",
    );
    evidence.snapshotDistinctFromLive = true;

    // ── 8. The provider changes their live balance AFTER sealing ───────────────────────────
    //
    // `redeem` burns the caller's own claim. A holder action, by the holder's own key, with no
    // operator and no keeper — so what follows tests a capsule against a change a provider can
    // actually make.
    await redeemSome(manifest.rpcUrl, token, WALLETS.provider);
    const liveHandleAfter = await readHandle(
      manifest.rpcUrl,
      token,
      "confidentialBalanceOf",
      providerAddress,
    );
    assert.notEqual(
      liveHandleAfter.toLowerCase(),
      liveHandle.toLowerCase(),
      "burning part of the claim must produce a NEW balance handle, or nothing changed and the " +
        "freeze test below would pass vacuously",
    );
    evidence.liveBalanceChangedAfterSealing = true;

    await provider.page.getByTestId("disconnect").click();
    await provider.page.getByTestId("session-ended").waitFor({ timeout: 30_000 });
    await provider.context.close();

    // ── 9-12. The auditor, in a separate context, decrypts the frozen snapshot ─────────────
    const auditor = await connect(browser, manifest.webUrl, manifest, WALLETS.auditor);
    await auditor.page.goto(`${manifest.webUrl}/app/capsules/${capsuleId}`);
    await auditor.page.getByTestId("capsule-snapshot").waitFor({ timeout: 90_000 });

    await auditor.page.getByTestId("capsule-snapshot").getByRole("button").click();
    await auditor.page.getByTestId("snapshot-value-value").waitFor({ timeout: 120_000 });
    const snapshotShown = numeric(
      await auditor.page.getByTestId("snapshot-value-value").innerText(),
    );
    evidence.auditorDecryptedSnapshot = true;

    assert.equal(
      snapshotShown,
      liveBefore,
      "the frozen snapshot must equal what the provider held when it was taken",
    );
    // ── 13. And the later burn did not move it ─────────────────────────────────────────────
    evidence.snapshotUnchangedByLiveChange = true;

    // ── 14. The auditor is refused the provider's CURRENT balance ──────────────────────────
    //
    // Through the interface, on the provider's own series page: the ownership panel reads the
    // connected wallet's balance, so the auditor's page shows the auditor's absence of one. The
    // peer probe is what asks for somebody else's, and it is refused on chain.
    await auditor.page.goto(`${manifest.webUrl}/app/series/${seriesId}`);
    await auditor.page.getByTestId("ownership-band").waitFor({ timeout: 90_000 });
    await auditor.page.getByTestId("peer-address").fill(providerAddress);
    await auditor.page.getByTestId("attempt-peer-decrypt").click();
    await auditor.page.getByTestId("peer-outcome").waitFor({ timeout: 120_000 });

    const auditorRefusal = await auditor.page
      .getByTestId("peer-outcome")
      .getAttribute("data-refusal");
    assert.equal(
      auditorRefusal,
      "not-authorised",
      `the auditor must be refused the provider's live balance, got ${auditorRefusal}`,
    );
    const refusalText = await auditor.page.getByTestId("peer-refusal").innerText();
    assert.equal(
      refusalText.includes(liveBefore.replace(/[^\d]/g, "")),
      false,
      "the refusal must disclose nothing about the value",
    );
    evidence.auditorRefusedLiveBalance = true;
    evidence.refusalKinds["auditor-live-balance"] = auditorRefusal ?? "";

    // ── 17. Refresh restores public metadata and NOT the plaintext ─────────────────────────
    await auditor.page.goto(`${manifest.webUrl}/app/capsules/${capsuleId}`);
    await auditor.page.getByTestId("capsule-facts").waitFor({ timeout: 60_000 });
    assert.equal(
      await auditor.page.getByTestId("snapshot-value-value").count(),
      0,
      "a refresh must not restore a decrypted value — it lives in memory and nowhere else",
    );
    assert.ok(
      (await auditor.page.getByTestId("capsule-facts").innerText()).includes(
        capsuleId.slice(0, 10),
      ),
      "a refresh must restore the public metadata",
    );
    evidence.refreshKeptPublicAndDroppedPrivate = true;

    // ── 18. Disconnecting removes the plaintext from the DOM ───────────────────────────────
    await auditor.page.getByTestId("capsule-snapshot").getByRole("button").click();
    await auditor.page.getByTestId("snapshot-value-value").waitFor({ timeout: 120_000 });
    await auditor.page.getByTestId("disconnect").click();
    await auditor.page.getByTestId("session-ended").waitFor({ timeout: 30_000 });
    assert.equal(
      await auditor.page.getByTestId("snapshot-value-value").count(),
      0,
      "the decrypted snapshot must be GONE from the page after the session ends, not hidden",
    );
    evidence.disconnectClearedPlaintext = true;
    await auditor.context.close();

    // ── 15. A third wallet is refused the capsule ──────────────────────────────────────────
    const outsider = await connect(browser, manifest.webUrl, manifest, WALLETS.outsider);
    await outsider.page.goto(`${manifest.webUrl}/app/capsules/${capsuleId}`);
    await outsider.page.getByTestId("capsule-snapshot").waitFor({ timeout: 90_000 });
    assert.equal(
      await outsider.page.getByTestId("not-recipient").count(),
      1,
      "the interface must say this wallet is not the capsule's recipient",
    );
    const outsiderState = await outsider.page
      .getByTestId("snapshot-value")
      .getAttribute("data-state");
    assert.equal(
      outsiderState,
      "encrypted-and-unavailable",
      `a third wallet must see the snapshot as unavailable, not as available, got ${outsiderState}`,
    );
    assert.equal(
      await outsider.page.getByTestId("snapshot-value-value").count(),
      0,
      "no value may be rendered for a wallet holding no grant",
    );
    evidence.outsiderRefusedCapsule = true;
    await outsider.context.close();

    // ── 16. Origin, recipient, scope, deployment, chain, block and expiry, from chain ───────
    const verifier = await connect(browser, manifest.webUrl, manifest, WALLETS.outsider);
    await verifier.page.goto(`${manifest.webUrl}/proof/capsule/${capsuleId}`);
    await verifier.page.getByTestId("verify-rows").waitFor({ timeout: 90_000 });
    for (const row of ["capsule-series", "capsule-chain", "capsule-scope", "capsule-validity"]) {
      const locator = verifier.page.getByTestId(`verify-${row}`);
      await locator.waitFor({ timeout: 60_000 });
      assert.equal(
        await locator.getAttribute("data-verdict"),
        "verified",
        `the capsule's ${row} must recompute from chain state`,
      );
    }
    const scopeText = await verifier.page.getByTestId("verify-capsule-scope").textContent();
    for (const expected of [auditorAddress.toLowerCase(), snapshotHandle.toLowerCase()]) {
      assert.ok(
        (scopeText ?? "").toLowerCase().includes(expected),
        `the capsule proof must show ${expected.slice(0, 12)}… read from the vault`,
      );
    }
    evidence.originVerifiedFromChain = true;
    await verifier.context.close();

    // ── No private amount reached any origin but the node and the gateway ──────────────────
    const allowed = new Set([
      new URL(manifest.webUrl).origin,
      new URL(manifest.rpcUrl).origin,
      new URL(manifest.noxGatewayUrl).origin,
    ]);
    const unexpected = [...origins].filter((origin) => !allowed.has(origin));
    assert.deepEqual(unexpected, [], `the pages contacted an unexpected origin: ${unexpected}`);

    return evidence;
  } finally {
    await browser.close();
  }
}

interface Session {
  readonly context: BrowserContext;
  readonly page: Page;
}

/** A fresh context with one key injected. Separate storage, separate signing identity. */
async function connect(
  browser: Browser,
  webUrl: string,
  manifest: { rpcUrl: string; noxGatewayUrl: string },
  key: string,
): Promise<Session> {
  const context = await browser.newContext();
  /*
   * Injected as a STRING, not as a closure.
   *
   * These scripts run in Node and `scripts/tsconfig.json` has no DOM lib, so a closure referring to
   * `window` does not typecheck — and casting a DOM global into a Node module to satisfy the compiler
   * would be a lie about where the code runs. Playwright evaluates a string in the page, where
   * `window` genuinely exists. It is also what keeps esbuild's `__name` helper out of the page.
   */
  await context.addInitScript(
    `window.__KYRVE_LOCAL_KEY__ = ${JSON.stringify(key)};` +
      `window.__KYRVE_RPC_URL__ = ${JSON.stringify(manifest.rpcUrl)};` +
      `window.__KYRVE_NOX_GATEWAY__ = ${JSON.stringify(manifest.noxGatewayUrl)};`,
  );
  const page = await context.newPage();
  page.on("request", (request) => origins.add(new URL(request.url()).origin));
  await page.goto(webUrl);
  return { context, page };
}

/** Digits and a decimal point only, so a formatted amount compares as the number it displays. */
function numeric(text: string): string {
  return text.replace(/[^\d.]/g, "");
}

function addressOf(privateKey: string): Address {
  return privateKeyToAccount(privateKey as `0x${string}`).address;
}

/** One `eth_call`, without pulling a client into this module. */
async function ethCall(rpcUrl: string, to: Address, data: `0x${string}`): Promise<`0x${string}`> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
  });
  const body = (await response.json()) as { result?: `0x${string}`; error?: { message: string } };
  if (body.error !== undefined) throw new Error(body.error.message);
  return body.result ?? "0x";
}

async function readHandle(
  rpcUrl: string,
  token: Address,
  fn: "confidentialBalanceOf",
  holder: Address,
): Promise<`0x${string}`> {
  return ethCall(
    rpcUrl,
    token,
    encodeFunctionData({
      abi: [
        {
          type: "function",
          name: fn,
          stateMutability: "view",
          inputs: [{ type: "address" }],
          outputs: [{ type: "bytes32" }],
        },
      ],
      functionName: fn,
      args: [holder],
    }),
  );
}

/** The capsule's frozen snapshot handle, read from the vault rather than from the page. */
async function readCapsuleSnapshot(
  rpcUrl: string,
  vault: Address,
  capsuleId: `0x${string}`,
): Promise<`0x${string}`> {
  const raw = await ethCall(
    rpcUrl,
    vault,
    encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "capsuleOf",
          stateMutability: "view",
          inputs: [{ type: "bytes32" }],
          outputs: [
            {
              type: "tuple",
              components: [
                { name: "issued", type: "bool" },
                { name: "scope", type: "uint8" },
                { name: "subject", type: "address" },
                { name: "recipient", type: "address" },
                { name: "issuedAt", type: "uint64" },
                { name: "expiry", type: "uint64" },
                { name: "snapshotBlock", type: "uint64" },
                { name: "quoteId", type: "bytes32" },
                { name: "snapshotHandle", type: "bytes32" },
                { name: "factsDigest", type: "bytes32" },
              ],
            },
          ],
        },
      ],
      functionName: "capsuleOf",
      args: [capsuleId],
    }),
  );
  // The tuple is a single head-encoded struct: nine 32-byte words after the offset word.
  const words = raw.slice(2).match(/.{64}/g) ?? [];
  const snapshot = words[9];
  if (snapshot === undefined) throw new Error("the vault returned no snapshot handle");
  return `0x${snapshot}`;
}

/**
 * Burns a small part of the provider's claim, as the provider.
 *
 * Deliberately performed OUTSIDE the browser and with the provider's own key: the point of step 8 is
 * that the capsule survives a change to the live balance, and the change has to be real. Doing it
 * through a UI the product does not have would have meant building one to prove a property about a
 * different feature.
 */
async function redeemSome(rpcUrl: string, token: Address, key: string): Promise<void> {
  const { createPublicClient, createWalletClient, http } = await import("viem");
  const { hardhat } = await import("viem/chains");
  const { createHandleClient } = await import("@kyrve/nox");

  const account = privateKeyToAccount(key as `0x${string}`);
  const transport = http(rpcUrl);
  const wallet = createWalletClient({ account, chain: hardhat, transport });
  const publicClient = createPublicClient({ chain: hardhat, transport });

  const live = await readLiveManifest();
  assert.ok(live.live, "the stack must still be running to change a balance");
  const nox = await createHandleClient(wallet, {
    chainId: live.manifest.chainId,
    name: "local",
    noxCompute: live.manifest.noxComputeAddress,
    gatewayUrl: live.manifest.noxGatewayUrl,
  });

  const abi = [
    {
      type: "function",
      name: "redeem",
      stateMutability: "nonpayable",
      inputs: [
        { name: "encryptedAmount", type: "bytes32" },
        { name: "inputProof", type: "bytes" },
        { name: "nonce", type: "uint256" },
      ],
      outputs: [],
    },
    {
      type: "function",
      name: "nextNonce",
      stateMutability: "view",
      inputs: [{ type: "address" }],
      outputs: [{ type: "uint256" }],
    },
  ] as const;

  const input = await nox.encrypt(1_000_000n, "euint256", token);
  const nonce = await publicClient.readContract({
    address: token,
    abi,
    functionName: "nextNonce",
    args: [account.address],
  });
  const hash = await wallet.writeContract({
    address: token,
    abi,
    functionName: "redeem",
    args: [input.handle, input.proof, nonce],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}
