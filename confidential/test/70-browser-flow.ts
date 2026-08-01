/**
 * The browser flow — the local terminal driven end to end in a real Chromium, against the real
 * local Nox stack.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS LIVES INSIDE THE HARDHAT SUITE
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The terminal needs three things running at once: a chain, the Nox off-chain stack, and the
 * confidential contracts deployed on that chain. The Hardhat plugin already brings the first two up
 * and tears them down; running the browser flow anywhere else would mean a second, parallel way to
 * boot the same stack, and the two would drift.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS ACTUALLY PROVEN HERE, beyond "the page renders"
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   - a wrap really moves a public balance and produces a real encrypted handle;
 *   - before decryption the private balance shows REDACTED STRUCTURE, not a zero and not a sample;
 *   - decryption happens in the browser and produces the right number;
 *   - the boundary preview names the public fields and the private ones, from the same source the
 *     encoder uses;
 *   - the privacy lock removes the decrypted value from the DOM immediately;
 *   - plaintext reaches the Nox handle gateway and NOTHING ELSE — checked by recording every
 *     request the page made and grouping them by origin, not by trusting the code.
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { handleGatewayUrl } from "@iexec-nox/nox-hardhat-plugin";
import { type Browser, chromium, type Page } from "playwright";

import { deployConfidential } from "../../scripts/deploy/confidential.js";

/** Hardhat/Anvil account zero — a published development key with no value on any public network. */
const LOCAL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const APP_URL = "http://127.0.0.1:5173";
/**
 * The three routes this flow walks, since Phase 7 gave the terminal nineteen of them.
 *
 * Each was one band of a single page and is now its own path. Every assertion below is unchanged —
 * what changed is that the page under test is reached by navigating rather than by scrolling, which
 * is also what makes each `page.goto` here a REFRESH check: a route that only worked when clicked
 * would fail on the first of these.
 */
const FUND_URL = `${APP_URL}/app/fund`;
const MANDATES_URL = `${APP_URL}/app/mandates`;
const REQUEST_URL = `${APP_URL}/app/request`;
const WRAP_AMOUNT = "1000";
/** 1,000 tUSDC at 6 decimals, as the terminal formats it. */
const WRAPPED_DISPLAY = "1000";

describe("Phase 2: the local terminal, in a real browser, against the real stack", () => {
  let browser: Browser;
  let page: Page;
  let vite: ChildProcess;
  /** Every request the page sent, with its origin, so a leak can be located rather than assumed absent. */
  const requests: { url: string; body: string }[] = [];

  before(async () => {
    const deployment = await deployConfidential("local");

    // The terminal reads its addresses from a served file rather than a compiled constant, so a
    // stale build cannot show a balance from a deployment that no longer exists.
    mkdirSync(new URL("../../apps/web/public/", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("../../apps/web/public/deployment.json", import.meta.url),
      `${JSON.stringify(deployment, null, 2)}\n`,
    );

    vite = spawn("pnpm", ["--filter", "@kyrve/web", "exec", "vite", "--host", "127.0.0.1"], {
      cwd: new URL("../../", import.meta.url).pathname,
      stdio: "ignore",
      detached: false,
    });

    // Wait for the dev server rather than sleeping a guessed amount.
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        const response = await fetch(APP_URL);
        if (response.ok) break;
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) throw new Error("the terminal's dev server never came up");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    browser = await chromium.launch();
    page = await browser.newPage();

    page.on("request", (request) => {
      const body = request.postData();
      if (body !== null) requests.push({ url: request.url(), body });
    });

    await page.addInitScript(
      ({ key, rpc, gateway }) => {
        (window as unknown as Record<string, unknown>).__KYRVE_LOCAL_KEY__ = key;
        (window as unknown as Record<string, unknown>).__KYRVE_RPC_URL__ = rpc;
        (window as unknown as Record<string, unknown>).__KYRVE_NOX_GATEWAY__ = gateway;
      },
      { key: LOCAL_KEY, rpc: "http://127.0.0.1:8545", gateway: handleGatewayUrl() },
    );

    await page.goto(FUND_URL);
    await page.getByTestId("session").waitFor({ timeout: 30_000 });
  });

  after(async () => {
    await browser?.close();
    vite?.kill("SIGTERM");
  });

  it("opens against the deployed local layer and states the licence", async () => {
    // The environment moved from beside the connected account into the footer, so it renders on
    // every page with or without a wallet — including the proof pages, whose reader is exactly the
    // person who needs to know which deployment they are looking at. The assertion is unchanged.
    const environment = await page.getByTestId("environment").textContent();
    assert.ok(environment?.includes("local"), "the terminal must say which environment it is on");
    assert.ok(environment?.includes("chain 31337"));
    assert.ok(
      (await page.getByTestId("session").textContent())?.startsWith("0x"),
      "the masthead must name the wallet the page is bound to",
    );

    const disclosure = await page.getByTestId("disclosure").textContent();
    assert.ok(
      disclosure?.includes("non-production licence"),
      "the Midnight licence qualification must be present and unqualified claims must not be",
    );
  });

  it("shows a private balance as REDACTED STRUCTURE before it is decrypted", async () => {
    await page.getByTestId("wrap-amount").fill(WRAP_AMOUNT);
    await page.getByTestId("wrap-submit").click();
    await page.getByTestId("wrap-status").filter({ hasText: "done" }).waitFor({ timeout: 60_000 });

    const publicBalance = await page.getByTestId("public-balance").textContent();
    assert.ok(publicBalance !== null && Number(publicBalance) >= 0);

    const state = await page.getByTestId("private-balance-state").textContent();
    assert.equal(
      state?.trim(),
      "Available to decrypt",
      "the wallet that wrapped holds a grant, so the state must say so",
    );

    // The redacted rendering must exist and must NOT be a zero or a plausible number.
    const redacted = page.getByTestId("private-balance").locator(".redacted");
    assert.equal(await redacted.count(), 1, "an unread value must render deliberate structure");
    const text = (await page.getByTestId("private-balance").textContent()) ?? "";
    assert.ok(
      !/\b0\.00\b/.test(text),
      "an encrypted balance must never be drawn as zero — that would be a claim about its contents",
    );
  });

  it("decrypts in the browser and shows the real value", async () => {
    await page.getByTestId("private-balance").getByRole("button").click();
    await page.getByTestId("private-balance-value").waitFor({ timeout: 60_000 });

    const shown = (await page.getByTestId("private-balance-value").textContent())?.trim();
    assert.equal(shown, WRAPPED_DISPLAY, "the holder must see exactly what they wrapped");
    assert.equal(
      (await page.getByTestId("private-balance-state").textContent())?.trim(),
      "Decrypted locally",
    );
  });

  it("the privacy lock removes the decrypted value from the page immediately", async () => {
    await page.getByTestId("lock").click();
    await page.getByTestId("private-balance-value").waitFor({ state: "detached", timeout: 10_000 });

    const body = (await page.locator("body").textContent()) ?? "";
    assert.ok(
      !body.includes(`${WRAPPED_DISPLAY}.`) || !body.includes("Decrypted locally"),
      "no decrypted value may remain rendered after locking",
    );
    // And the copy must not claim anything was revoked.
    assert.ok(body.includes("does not revoke anything"));
  });

  it("names the public and private halves of a mandate before it is signed", async () => {
    await page.goto(MANDATES_URL);
    await page.getByTestId("mandate-boundary-public").waitFor({ timeout: 30_000 });

    const publicFields = await page
      .getByTestId("mandate-boundary-public")
      .locator("li")
      .allTextContents();
    const privateFields = await page
      .getByTestId("mandate-boundary-private")
      .locator("li")
      .allTextContents();

    assert.equal(privateFields.length, 35, "a mandate is always 35 encrypted fields");
    assert.ok(publicFields.some((field) => field.includes("commitment")));
    assert.ok(
      !publicFields.some((field) => field.toLowerCase().includes("budget")),
      "the budget must never be listed as public",
    );

    // The permanence notice renders with no toggle and no dismiss control.
    const notice = page.getByTestId("mandate-boundary-permanent");
    await notice.waitFor();
    assert.equal(await notice.locator("details, summary, [aria-expanded]").count(), 0);
  });

  it("seals an encrypted mandate and shows its epoch", async () => {
    await page.getByTestId("mandate-budget").fill("5000");
    await page.getByTestId("mandate-submit").click();
    await page
      .getByTestId("mandate-status")
      .filter({ hasText: "done" })
      .waitFor({ timeout: 120_000 });

    assert.equal((await page.getByTestId("mandate-epoch").textContent())?.trim(), "1");
    const id = await page.getByTestId("mandate-id").textContent();
    assert.ok(id?.startsWith("0x") && !/^0x0+$/.test(id));
  });

  it("keeps a borrower's bond public and their price limit private", async () => {
    await page.goto(REQUEST_URL);
    await page.getByTestId("request-boundary-public").waitFor({ timeout: 30_000 });

    const publicFields = await page
      .getByTestId("request-boundary-public")
      .locator("li")
      .allTextContents();
    const privateFields = await page
      .getByTestId("request-boundary-private")
      .locator("li")
      .allTextContents();

    assert.ok(publicFields.some((field) => field.includes("bond")));
    assert.equal(privateFields.length, 19, "a request is always 19 encrypted fields");
    assert.ok(privateFields.some((field) => field.includes("maxRateIndexes")));
    assert.ok(
      !publicFields.some((field) => field.includes("maxRateIndexes")),
      "a borrower's price limit must never be listed as public",
    );
  });

  it("submits an encrypted borrower request with its bond", async () => {
    await page.getByTestId("request-submit").click();
    await page
      .getByTestId("request-status")
      .filter({ hasText: "done" })
      .waitFor({ timeout: 120_000 });

    const id = await page.getByTestId("request-id").textContent();
    assert.ok(id?.startsWith("0x") && !/^0x0+$/.test(id), "a live request must be recorded");
  });

  it("sends data to the Nox gateway and the RPC, and to no Kyrve component at all", async () => {
    // ────────────────────────────────────────────────────────────────────────────────────────
    // THE TRUST BOUNDARY THIS TEST MAKES EXPLICIT
    // ────────────────────────────────────────────────────────────────────────────────────────
    //
    // `encryptInput` sends the value to the Nox handle gateway, which encrypts it inside the TEE
    // and returns a handle and a proof. That is not a leak — the gateway IS the confidentiality
    // provider. A gateway key compromise is a total confidentiality compromise, and PRD §20.1
    // requires that be disclosed rather than glossed over.
    //
    // What `.claude/rules/security.md` forbids is a value reaching a KYRVE component. In this
    // flow there is no such component to reach, and that is the strongest form the claim can take:
    // the application origin serves static assets and receives no request body at all. Not "no
    // plaintext" — no data.
    //
    // WHY NOT SEARCH THE BODIES FOR THE VALUE. Every character of a decimal amount is also a valid
    // hex character, and both the RPC and the gateway carry long hex blobs, so a substring search
    // matches by coincidence. The first version of this test failed exactly that way and could
    // only have been "fixed" by weakening it until it proved nothing. Grouping by origin proves
    // more, and proves it without a statistical argument.
    const gatewayOrigin = new URL(handleGatewayUrl()).origin;
    const appOrigin = new URL(APP_URL).origin;
    const rpcOrigin = "http://127.0.0.1:8545";

    const byOrigin = new Map<string, number>();
    for (const request of requests) {
      const origin = new URL(request.url).origin;
      byOrigin.set(origin, (byOrigin.get(origin) ?? 0) + 1);
    }

    assert.ok(
      (byOrigin.get(gatewayOrigin) ?? 0) > 0,
      "the encryption round trip must actually have happened against the real gateway",
    );

    const toApp = requests.filter((request) => new URL(request.url).origin === appOrigin);
    assert.deepEqual(
      toApp.map((request) => request.url),
      [],
      "the application origin must receive no request body whatsoever — there is no Kyrve server " +
        "in this flow, so there is nothing that could log, store or forward a value",
    );

    const unexpected = [...byOrigin.keys()].filter(
      (origin) => origin !== gatewayOrigin && origin !== rpcOrigin,
    );
    assert.deepEqual(
      unexpected,
      [],
      "the terminal must talk to exactly two things: the Nox gateway and the chain",
    );

    const storage = await page.evaluate(() => ({
      local: window.localStorage.length,
      localKeys: Object.keys(window.localStorage),
      localValues: Object.keys(window.localStorage).map((key) =>
        String(window.localStorage.getItem(key)),
      ),
      session: window.sessionStorage.length,
    }));
    /*
     * FROM A COUNT TO A NAMED SET, AND THE NEW ASSERTION IS THE STRONGER ONE.
     *
     * Phase 7 gave the product a role, and a role has to survive a reload or every visit begins by
     * asking who you are. Two keys are now written: `kyrve.role` and `kyrve.onboarded`.
     *
     * "Zero keys" was easy to assert and weaker than it looks — it would have passed on a build that
     * stored a decrypted balance under a key it cleared on unload. What matters is not how many keys
     * exist but whether any of them holds a value that was decrypted, so the assertion now names the
     * permitted set AND checks every stored value against the plaintext this flow revealed.
     *
     * The decryption path itself is unchanged and still cannot reach storage at all:
     * `scripts/verify/privacy-scan.ts` forbids every storage sink in `packages/nox/src/client.ts`,
     * which is the only module in the workspace that ever holds a plaintext.
     */
    /*
     * `rk-version` is RainbowKit's own schema-version string and holds no value of any kind.
     *
     * It is permitted by name rather than by prefix, so a future `rk-recent-wallets` or
     * `rk-connection` would still fail here. wagmi's `wagmi.store` DID carry the connected
     * addresses and used to appear in this list; it is gone because `createWalletConfig` sets
     * `storage: null`, which is the product's own stated position that reconnecting is an action
     * rather than something a reload does on the reader's behalf.
     */
    const permitted = new Set(["kyrve.role", "kyrve.onboarded", "rk-version"]);
    const unexpectedKeys = storage.localKeys.filter((key: string) => !permitted.has(key));
    assert.deepEqual(unexpectedKeys, [], "only the role and the onboarding flag may be persisted");
    assert.equal(storage.session, 0, "nothing is persisted to sessionStorage");
    for (const value of storage.localValues) {
      assert.equal(
        value.includes(WRAPPED_DISPLAY),
        false,
        `a persisted value contains the decrypted balance: ${value}`,
      );
      assert.equal(
        /^\d{4,}$/.test(value),
        false,
        `a persisted value looks like an amount rather than a role: ${value}`,
      );
    }

    console.log(`  request bodies recorded : ${requests.length}`);
    for (const [origin, count] of byOrigin) {
      const role = origin === gatewayOrigin ? "Nox handle gateway" : "Ethereum RPC";
      console.log(`    ${origin.padEnd(24)} ${String(count).padStart(4)}  ${role}`);
    }
    console.log("  Kyrve components contacted : 0 — the application origin received no body");
    console.log(`  browser storage written    : ${storage.localKeys.join(", ") || "0 keys"}`);
  });
});
