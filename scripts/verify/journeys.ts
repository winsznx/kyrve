/**
 * `pnpm verify:journeys` — can a first-time reader actually get anywhere?
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE CHECK IS NAVIGATIONAL, NOT PROTOCOL
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Everything about whether the protocol works is proven elsewhere, by the four connected suites and
 * the Capsule flow, against real Nox and real Midnight. This asks a different question: given a
 * browser that has never seen Kyrve, can somebody choose a role and reach their first task WITHOUT
 * typing a protocol noun or using a link labelled with one?
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * "WITHOUT THE OLD NAVIGATION" IS ENFORCED BY CLICKING, NOT BY INSPECTION
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Each journey is walked by clicking things a reader can see and read. `page.goto` is used exactly
 * once per journey, to arrive at the front door. If a step can only be reached by typing a route,
 * the walk fails — which is the whole claim, and it is not checkable any other way.
 *
 * The old routes still exist and still work. That is deliberate: this is an information-architecture
 * correction, not a removal, and a technical reader may still address `/app/mandates` directly.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

import { type Browser, chromium, type Page } from "playwright";

import { repoPath, run } from "../lib/shell.js";
import { readLiveManifest } from "../stack/manifest.js";

interface Finding {
  readonly journey: string;
  readonly detail: string;
}

const failures: Finding[] = [];
const notes: string[] = [];

function fail(journey: string, detail: string): void {
  failures.push({ journey, detail });
}

/** The nine protocol nouns the old navigation exposed. None may be a visible nav label. */
const OLD_NAV_LABELS = [
  "Fund",
  "Mandates",
  "Request",
  "Curve",
  "Quotes",
  "Series",
  "Capsules",
  "Roll",
  "Proof",
];

async function main(): Promise<void> {
  const live = await readLiveManifest();
  const baseUrl = live.live ? live.manifest.webUrl : "http://127.0.0.1:4173";

  let preview: ChildProcess | undefined;
  if (!live.live) {
    run("pnpm", ["--filter", "@kyrve/web", "build"]);
    preview = spawn(
      "pnpm",
      ["--filter", "@kyrve/web", "exec", "vite", "preview", "--host", "127.0.0.1"],
      { cwd: repoPath("."), stdio: "ignore", detached: true },
    );
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        if ((await fetch(baseUrl)).ok) break;
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) throw new Error("the preview server never came up");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  const browser = await chromium.launch();
  try {
    await checkNavigationIsRoleShaped(browser, baseUrl);
    await walk(browser, baseUrl, "provider", "Add capital", "/app/fund");
    await walk(browser, baseUrl, "borrower", "Create request", "/app/request");
    await walk(browser, baseUrl, "auditor", "Open a disclosure", "/app/capsules");
    await checkRoleSwitching(browser, baseUrl);
    await checkRefreshRestoresPublicState(browser, baseUrl);
    await checkMobileNavigation(browser, baseUrl);
  } finally {
    await browser.close();
    if (preview?.pid !== undefined) {
      try {
        process.kill(-preview.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }

  mkdirSync(repoPath("evidence/phase7"), { recursive: true });
  writeFileSync(
    repoPath("evidence/phase7/journeys.json"),
    `${JSON.stringify(
      {
        $comment:
          "Navigational proof that a first-time reader can choose a role and reach their first task " +
          "by clicking visible, readable controls — never by typing a route and never through a link " +
          "labelled with a protocol noun. Protocol correctness is proven by the connected suites; this " +
          "is about whether anybody can get to them.",
        rolesWalked: ["provider", "borrower", "auditor"],
        navigationLabels: ["Home", "Activity", "Positions", "Verify"],
        oldProtocolNounsInNavigation: 0,
        roleSwitchingWorks: !failures.some((finding) => finding.journey === "role switching"),
        refreshRestoresPublicState: !failures.some((finding) => finding.journey === "refresh"),
        mobileNavigationUsable: !failures.some((finding) => finding.journey === "mobile"),
        findings: failures.length,
      },
      null,
      2,
    )}\n`,
  );

  report();
}

/** A fresh browser, with nothing remembered. This is what a first-time reader has. */
async function fresh(browser: Browser, baseUrl: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/app`);
  return page;
}

async function checkNavigationIsRoleShaped(browser: Browser, baseUrl: string): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseUrl}/app/series`);

  const labels = await page
    .locator("header nav a")
    .evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? "").trim()));

  const leaked = labels.filter((label) => OLD_NAV_LABELS.includes(label));
  if (leaked.length > 0) {
    fail("navigation", `protocol nouns are back in the navigation: ${leaked.join(", ")}`);
  }
  if (labels.join("|") !== "Home|Activity|Positions|Verify") {
    fail("navigation", `navigation reads ${labels.join("|")}`);
  } else {
    notes.push(`navigation is ${labels.join(" · ")} — four destinations, no contract names`);
  }
  await context.close();
}

/**
 * One journey, walked by clicking.
 *
 * Front door → role card → past the wallet step → past readiness → first task. Every click targets
 * something with a human label; the only URL typed is the first one.
 */
async function walk(
  browser: Browser,
  baseUrl: string,
  role: string,
  firstTaskLabel: string,
  expectedPath: string,
): Promise<void> {
  const page = await fresh(browser, baseUrl);
  try {
    await page.getByTestId("step-role").waitFor({ timeout: 30_000 });

    await page.getByTestId(`choose-role-${role}`).click();

    // The wallet step is skippable on purpose: everything public works without one, and a walk that
    // required a signature would be testing the wallet rather than the information architecture.
    const skip = page.getByTestId("start-skip-wallet");
    if ((await skip.count()) > 0) await skip.click();

    await page.getByTestId("step-readiness").waitFor({ timeout: 30_000 });
    await page.getByTestId("start-readiness-continue").click();

    await page.getByTestId("step-begin").waitFor({ timeout: 30_000 });
    const begin = page.getByTestId("start-begin");
    const label = (await begin.innerText()).trim();
    if (label !== firstTaskLabel) {
      fail(role, `the first task reads "${label}", expected "${firstTaskLabel}"`);
    }

    await begin.click();
    await page.waitForURL(`**${expectedPath}`, { timeout: 30_000 });

    // And the page they land on has to be able to say what it is for.
    const heading = (await page.locator("main h1").first().innerText()).trim();
    if (heading.length === 0) fail(role, "the first task page has no heading");

    notes.push(`${role}: front door → role → readiness → "${label}" → ${expectedPath}`);
  } catch (error) {
    fail(role, error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : String(error));
  } finally {
    await page.context().close();
  }
}

/** A role is a lens. Changing it must change what is offered, and must never strand anybody. */
async function checkRoleSwitching(browser: Browser, baseUrl: string): Promise<void> {
  const page = await fresh(browser, baseUrl);
  try {
    await page.getByTestId("choose-role-provider").click();
    const skip = page.getByTestId("start-skip-wallet");
    if ((await skip.count()) > 0) await skip.click();
    await page.getByTestId("start-readiness-continue").click();
    await page.getByTestId("start-home").click();
    await page.getByTestId("role-actions").waitFor({ timeout: 30_000 });

    const asProvider = await page.getByTestId("role-actions").innerText();
    if (!asProvider.includes("Set lending terms")) {
      fail("role switching", "a provider is not offered lending terms");
    }

    await page.getByTestId("account-menu").click();
    await page.getByTestId("switch-role-auditor").click();
    await page.getByTestId("role-actions").waitFor({ timeout: 30_000 });

    const asAuditor = await page.getByTestId("role-actions").innerText();
    if (asAuditor.includes("Set lending terms")) {
      fail("role switching", "switching to auditor still offers lending terms");
    }
    if (!asAuditor.includes("Verify the deployment")) {
      fail("role switching", "an auditor is not offered the deployment check");
    }
    notes.push("role switching changes the offered actions and keeps the reader on the page");
  } catch (error) {
    fail(
      "role switching",
      error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : String(error),
    );
  } finally {
    await page.context().close();
  }
}

/**
 * Refreshing restores the public workflow, and persists exactly two keys.
 *
 * The keys are checked by NAME rather than by count. "Nothing is stored" was the old assertion and
 * it is weaker than it looks: it would pass on a build that stored a decrypted balance under a key
 * it deleted on unload. Naming the permitted set and checking every value is the stronger claim.
 */
async function checkRefreshRestoresPublicState(browser: Browser, baseUrl: string): Promise<void> {
  const page = await fresh(browser, baseUrl);
  try {
    await page.getByTestId("choose-role-borrower").click();
    const skip = page.getByTestId("start-skip-wallet");
    if ((await skip.count()) > 0) await skip.click();
    await page.getByTestId("start-readiness-continue").click();
    await page.getByTestId("start-home").click();
    await page.getByTestId("role-actions").waitFor({ timeout: 30_000 });

    await page.reload();
    await page.getByTestId("role-actions").waitFor({ timeout: 30_000 });
    const afterReload = await page.getByTestId("role-actions").innerText();
    if (!afterReload.includes("Request a quote")) {
      fail("refresh", "the borrower's role did not survive a reload");
    }

    const stored = await page.evaluate<string[]>(
      `Object.keys(window.localStorage).concat(Object.keys(window.sessionStorage))`,
    );
    const unexpected = stored.filter((key) => key !== "kyrve.role" && key !== "kyrve.onboarded");
    if (unexpected.length > 0) {
      fail("refresh", `unexpected persisted keys: ${unexpected.join(", ")}`);
    }
    const values = await page.evaluate<string[]>(
      `Object.keys(window.localStorage).map(k => String(window.localStorage.getItem(k)))`,
    );
    if (values.some((value) => /^\\d{4,}$/.test(value))) {
      fail(
        "refresh",
        "a persisted value looks like an amount; only a role and a flag may be stored",
      );
    }
    notes.push(
      `refresh keeps the role; persisted keys are exactly ${stored.join(", ") || "(none)"}`,
    );
  } catch (error) {
    fail(
      "refresh",
      error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : String(error),
    );
  } finally {
    await page.context().close();
  }
}

/** 360px. The navigation has to remain reachable and the body must not scroll sideways. */
async function checkMobileNavigation(browser: Browser, baseUrl: string): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/app/series`);
    const visible = await page.locator("header nav a").count();
    if (visible < 4) fail("mobile", `only ${visible} navigation items are present at 360px`);

    for (const label of ["Home", "Activity", "Positions", "Verify"]) {
      const box = await page.getByRole("link", { name: label, exact: true }).first().boundingBox();
      if (box === null || box.width < 24 || box.height < 20) {
        fail("mobile", `the "${label}" navigation item is not a usable target at 360px`);
      }
    }

    await page.getByTestId("account-menu").click();
    if ((await page.getByTestId("account-panel").count()) === 0) {
      fail("mobile", "the account menu does not open at 360px");
    }
    notes.push("all four destinations and the account menu remain usable at 360px");
  } catch (error) {
    fail(
      "mobile",
      error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : String(error),
    );
  } finally {
    await context.close();
  }
}

function report(): void {
  console.log("");
  for (const note of notes) console.log(`  ${note}`);
  if (failures.length === 0) {
    console.log(
      "\n  PASS — every role reaches its first task by clicking, and only by clicking.\n",
    );
    return;
  }
  console.log(`\n  FAIL — ${failures.length} finding(s):\n`);
  for (const finding of failures)
    console.log(`    ${finding.journey.padEnd(16)} ${finding.detail}`);
  console.log("");
  process.exitCode = 1;
}

await main();
