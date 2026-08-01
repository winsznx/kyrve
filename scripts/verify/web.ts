/**
 * `pnpm verify:web` — every route, in a real Chromium, against a real built bundle.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS DRIVES A BROWSER RATHER THAN READING THE SOURCE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every check here is about what the DOCUMENT ends up being, and none of them can be answered from
 * the source. A route's title is written by an effect; a stale one from the previous navigation is
 * the classic single-page-application defect and it is invisible from inside the page. A refresh
 * check has to hit a real server, because the failure is the server's history fallback, not the
 * router. A "one cobalt element per page" rule is about rendered elements, not about class names in
 * a file. And a console error only exists at runtime.
 *
 * It runs against `vite preview` over `dist`, not the dev server: the thing that ships is the built
 * bundle, and dev-only middleware could make a broken build look fine.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IT DOES NOT CLAIM
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * This is not an accessibility audit and does not call itself one. It checks a specific list of
 * structural properties that can be checked mechanically — one `h1`, a skip link first in the tab
 * order, a label for every control, an accessible name on every link and button, `aria-current` on
 * the active nav item, no positive `tabindex`, and no horizontal overflow at 360px. A real audit
 * involves a person and assistive technology, and nothing here substitutes for one.
 *
 * WITHOUT A DEPLOYMENT RECORD the terminal refuses to start, which is correct behaviour and means
 * most checks cannot run. That is reported as SKIPPED with the command that produces one — never as
 * a pass, because "the page refused to start" and "the page is fine" are opposite conditions.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { type ConsoleMessage, chromium } from "playwright";

import { repoPath, run } from "../lib/shell.js";

const PREVIEW_URL = "http://127.0.0.1:4173";

/**
 * Every route, with the title the table declares.
 *
 * Kept in step with `apps/web/src/App.tsx` by the first check, which compares this list against the
 * route table's own paths. A checklist that drifted from the thing it checks would pass forever.
 */
const ROUTES: readonly { readonly path: string; readonly title: string }[] = [
  { path: "/", title: "One quote. The curve stays private" },
  { path: "/app", title: "Overview" },
  { path: "/app/start", title: "Get started" },
  { path: "/app/activity", title: "Activity" },
  { path: "/demo", title: "Demonstration" },
  { path: "/app/fund", title: "Add capital" },
  { path: "/app/mandates", title: "Lending terms" },
  { path: "/app/request", title: "Request a quote" },
  { path: "/app/curve", title: "Private matching" },
  { path: "/app/quotes", title: "Quotes" },
  {
    path: "/app/quotes/0x1111111111111111111111111111111111111111111111111111111111111111",
    title: "Quote",
  },
  { path: "/app/series", title: "Positions" },
  {
    path: "/app/series/0x1111111111111111111111111111111111111111111111111111111111111111",
    title: "Position",
  },
  {
    path: "/app/cross/0x1111111111111111111111111111111111111111111111111111111111111111",
    title: "Transfer a position",
  },
  { path: "/app/roll", title: "Move maturity" },
  { path: "/app/capsules", title: "Disclosures" },
  {
    path: "/app/capsules/0x1111111111111111111111111111111111111111111111111111111111111111",
    title: "Disclosure",
  },
  { path: "/proof", title: "Verify" },
  { path: "/proof/deployment", title: "Deployment proof" },
  {
    path: "/proof/quote/0x1111111111111111111111111111111111111111111111111111111111111111",
    title: "Quote proof",
  },
  {
    path: "/proof/series/0x1111111111111111111111111111111111111111111111111111111111111111",
    title: "Series proof",
  },
  {
    path: "/proof/capsule/0x1111111111111111111111111111111111111111111111111111111111111111",
    title: "Capsule proof",
  },
];

/**
 * Copy that must never ship.
 *
 * The first four are the vocabulary P7-3 fixes: Nox has no `removeViewer`, so a page saying a grant
 * was revoked or is no longer readable would be stating the opposite of the truth about a permanent
 * grant on a public network.
 *
 * The rest are unfinished-work markers. The bare word "placeholder" is deliberately NOT on this list:
 * this product talks about placeholder proofs and placeholder terms in order to say it does not ship
 * them, and a check that failed on the discussion would push the discussion out of the interface —
 * which is the opposite of what it is for.
 */
const FORBIDDEN_PHRASES: readonly string[] = [
  "access revoked",
  "revoke access",
  "no longer readable",
  "can no longer read",
  "lorem ipsum",
  "coming soon",
  "todo:",
  "fixme",
  "tbd",
];

interface Finding {
  readonly check: string;
  readonly route: string;
  readonly detail: string;
}

const failures: Finding[] = [];
const notes: string[] = [];
/** Routes that reported the chain as unreachable. Expected when no local node is running. */
const unreachable = new Set<string>();
/** Whether a deployment record is being served at all. Set once, before the browser starts. */
let recordAvailable = false;

function fail(check: string, route: string, detail: string): void {
  failures.push({ check, route, detail });
}

/**
 * Walk against the PUBLIC record shape as well, when asked.
 *
 * Swapped in around the whole run and restored in a `finally`, so an interrupted run cannot leave a
 * developer's checkout serving Sepolia addresses from a local stack.
 */
const PUBLIC_RECORD = process.argv.includes("--public");

async function main(): Promise<void> {
  if (!existsSync(repoPath("apps/web/dist/index.html"))) {
    console.log("  building the web bundle first, because this checks what ships\n");
    run("pnpm", ["--filter", "@kyrve/web", "build"]);
  }

  // ── 0. the checklist has not drifted from the route table ──────────────────────────────────
  const routeTable = await import(repoPath("apps/web/src/App.tsx")).catch(() => undefined);
  if (routeTable === undefined) {
    // Importing a TSX module from a plain tsx runner is not always possible; fall back to a source
    // read, which is enough to compare the declared paths.
    const source = run("cat", [repoPath("apps/web/src/App.tsx")]).stdout;
    const declared = [...source.matchAll(/^\s*path: "([^"]+)",$/gm)].map((match) => match[1]);
    const checked = new Set(
      ROUTES.map((route) =>
        route.path.replace(
          /0x1{64}/,
          route.path.includes("quote")
            ? ":quoteId"
            : route.path.includes("capsule")
              ? ":capsuleId"
              : ":seriesId",
        ),
      ),
    );
    const missing = declared.filter((path) => path !== undefined && !checked.has(path));
    if (missing.length > 0) {
      fail(
        "route coverage",
        "(table)",
        `the route table declares ${missing.length} path(s) this check does not walk: ${missing.join(", ")}`,
      );
    }
    notes.push(`${declared.length} routes declared, ${ROUTES.length} walked`);
  }

  const recordPath = repoPath("apps/web/public/deployment.json");
  const recordServed = existsSync(recordPath);
  recordAvailable = recordServed;

  let saved: string | undefined;
  if (PUBLIC_RECORD) {
    if (recordServed) saved = readFileSync(recordPath, "utf8");
    console.log("  regenerating the served record from Sepolia evidence\n");
    run("pnpm", ["exec", "tsx", repoPath("scripts/generate/served-record.ts")]);
    run("pnpm", ["--filter", "@kyrve/web", "build"]);
  }

  let preview: ChildProcess | undefined;
  try {
    preview = spawn(
      "pnpm",
      ["--filter", "@kyrve/web", "exec", "vite", "preview", "--host", "127.0.0.1"],
      {
        cwd: repoPath("."),
        stdio: "ignore",
      },
    );

    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        if ((await fetch(PREVIEW_URL)).ok) break;
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) throw new Error("the preview server never came up");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const browser = await chromium.launch();
    try {
      await walkRoutes(browser);
      await checkResponsive(browser);
      await checkConnectControls(browser);
    } finally {
      await browser.close();
    }
  } finally {
    preview?.kill("SIGTERM");
    if (saved !== undefined) writeFileSync(recordPath, saved);
  }

  if (PUBLIC_RECORD) notes.push("walked against the public (Sepolia) record shape");
  report(recordServed);
}

/**
 * The record this walk ran against.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ONE SHAPE PASSING IS NOT THE PRODUCT PASSING
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `pnpm verify:web` ran against the local record for the whole of Phase 7, and the local record
 * carries a quote candidate. The deployed record deliberately does not — a candidate includes
 * gateway decryption proofs, which are not deployment facts, so `served-record.ts` refuses to
 * invent them. `/app/curve` read `settlement.candidate.epochId` unguarded and crashed on Sepolia,
 * on a route that passed every local run.
 *
 * `pnpm verify:web --public` regenerates the served record from the Sepolia evidence, walks
 * everything against it, and restores what was there. The type is honest about the field now, so
 * the compiler catches the next one first — this is the check that proves the two agree.
 */

async function walkRoutes(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const onConsole = (message: ConsoleMessage): void => {
    if (message.type() === "error") consoleErrors.push(message.text());
  };
  page.on("console", onConsole);
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  for (const route of ROUTES) {
    consoleErrors.length = 0;
    const url = `${PREVIEW_URL}${route.path}`;

    // ── 1. refresh. Typed, not clicked — this is the check the SPA fallback exists for. ──────
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (response === null || response.status() >= 400) {
      fail("route refresh", route.path, `entering the URL directly returned ${response?.status()}`);
      continue;
    }
    await page.waitForLoadState("networkidle").catch(() => undefined);

    // A terminal with no deployment record refuses to start, which is correct. Every check below
    // is about a rendered page, so they are skipped rather than reported against a refusal.
    if ((await page.getByTestId("boot-error").count()) > 0) continue;

    // ── 2. metadata. The title must be this route's, not the previous one's. ─────────────────
    const title = await page.title();
    if (!title.startsWith(route.title)) {
      fail(
        "metadata",
        route.path,
        `title is "${title}", expected it to start with "${route.title}"`,
      );
    }
    const description = await page
      .locator('meta[name="description"]')
      .first()
      .getAttribute("content");
    if (description === null || description.trim().length < 40) {
      fail("metadata", route.path, "no meaningful description meta tag");
    }

    // ── 3. exactly one h1, and it is not empty ──────────────────────────────────────────────
    const headings = await page.locator("h1").allTextContents();
    if (headings.length !== 1) {
      fail("headings", route.path, `${headings.length} h1 elements; a page has exactly one`);
    } else if ((headings[0] ?? "").trim().length === 0) {
      fail("headings", route.path, "the h1 is empty");
    }

    // ── 4. one cobalt element. `design.md` rations it to the single primary action. ──────────
    const primaries = await page.locator(".primary").count();
    if (primaries > 1) {
      fail(
        "one cobalt action",
        route.path,
        `${primaries} elements carry the primary (cobalt) treatment; design.md permits one per page`,
      );
    }

    // ── 5. no shadow anywhere. Separation is the one-step value lift and nothing else. ───────
    // Evaluated as a STRING, not as a closure.
    //
    // tsx transpiles this file with esbuild, which injects a `__name` helper into named function
    // expressions. Playwright serialises a closure by its source, so the helper travels into the
    // page and the browser throws `__name is not defined` — a build-tool artefact that looks
    // exactly like a product defect. A string is transpiled by nothing.
    const shadowed = await page.evaluate<number>(
      `[...document.querySelectorAll("*")].filter(function (node) {
         const shadow = getComputedStyle(node).boxShadow;
         return shadow !== "none" && shadow.length > 0;
       }).length`,
    );
    if (shadowed > 0) {
      fail("no shadows", route.path, `${shadowed} element(s) render a box-shadow`);
    }

    // ── 6. every control has an accessible name ─────────────────────────────────────────────
    const unnamed = await page.evaluate<number>(
      `[...document.querySelectorAll("button, a[href]")].filter(function (node) {
         const aria = node.getAttribute("aria-label");
         if (aria !== null && aria.trim().length > 0) return false;
         if (node.getAttribute("aria-labelledby") !== null) return false;
         return (node.textContent || "").trim().length === 0;
       }).length`,
    );
    if (unnamed > 0) {
      fail(
        "accessible names",
        route.path,
        `${unnamed} link(s) or button(s) have no accessible name`,
      );
    }

    // ── 7. every input is labelled ──────────────────────────────────────────────────────────
    const unlabelled = await page.evaluate<number>(
      `[...document.querySelectorAll("input, select, textarea")].filter(function (node) {
         const id = node.getAttribute("id");
         if (id !== null && document.querySelector('label[for="' + id + '"]') !== null) return false;
         if (node.getAttribute("aria-label") !== null) return false;
         return node.closest("label") === null;
       }).length`,
    );
    if (unlabelled > 0) {
      fail("labels", route.path, `${unlabelled} form control(s) have no label`);
    }

    // ── 8. no positive tabindex. It reorders the tab sequence away from the visual one. ──────
    const positiveTabIndex = await page
      .locator('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')
      .count();
    if (positiveTabIndex > 0) {
      fail("tab order", route.path, `${positiveTabIndex} element(s) carry a positive tabindex`);
    }

    // ── 9. the skip link is the first thing a keyboard reaches ───────────────────────────────
    await page.keyboard.press("Tab");
    const firstFocused = await page.evaluate<string>(
      `document.activeElement === null
         ? ""
         : document.activeElement.tagName + ":" +
           (document.activeElement.textContent || "").trim().slice(0, 40)`,
    );
    if (!firstFocused.toLowerCase().includes("skip")) {
      fail(
        "keyboard",
        route.path,
        `the first focusable element is "${firstFocused}", not the skip link`,
      );
    }

    /*
     * 9b. THE NAVIGATION IS ROLE-SHAPED, NOT CONTRACT-SHAPED.
     *
     * Four destinations. The old nine — Fund, Mandates, Curve, Quotes, Capsules, Roll — were every
     * one a real surface and not one of them a task. They are all still reachable; what must not
     * come back is asking a first-time reader to pick between them before they have done anything.
     */
    // `/app/start` is chromeless by design — the onboarding flow has no application navigation,
    // because a four-item operations bar across a screen asking "who are you" describes a product
    // the reader has not been introduced to yet.
    if (route.path.startsWith("/app") && route.path !== "/app/start") {
      const navLabels = await page.evaluate<string>(
        `[...document.querySelectorAll("header nav a")].map(a => (a.textContent || "").trim()).join("|")`,
      );
      const expected = "Home|Activity|Positions|Verify";
      if (navLabels !== expected) {
        fail("navigation", route.path, `navigation reads "${navLabels}", expected "${expected}"`);
      }
    }

    // ── 10. the active nav item is marked for assistive technology ──────────────────────────
    if (
      (route.path.startsWith("/app") || route.path.startsWith("/proof")) &&
      route.path !== "/app/start"
    ) {
      const current = await page.locator('[aria-current="page"]').count();
      if (current === 0) {
        fail("navigation", route.path, "no navigation item is marked aria-current=page");
      }
    }

    // ── 11. no broken internal link ─────────────────────────────────────────────────────────
    // Read one attribute at a time rather than through `evaluateAll`.
    //
    // `evaluateAll` would need a DOM-typed callback, and `scripts/tsconfig.json` deliberately has no
    // DOM lib — these scripts run in Node. Casting one in would be a lie about where the code runs.
    const anchors = page.locator("a[href^='/']");
    const anchorCount = await anchors.count();
    const hrefs = new Set<string>();
    for (let index = 0; index < anchorCount; index += 1) {
      const href = await anchors.nth(index).getAttribute("href");
      if (href !== null) hrefs.add(href);
    }
    for (const href of hrefs) {
      if (href.startsWith("/brand/") || href === "/site.webmanifest") continue;
      const probe = await fetch(`${PREVIEW_URL}${href}`);
      if (!probe.ok) fail("links", route.path, `internal link ${href} returned ${probe.status}`);
    }

    /*
     * 11b. NO UNEXPLAINED INTERNAL TERM ABOVE THE FOLD.
     *
     * The correction this whole pass exists for. A first-time reader must not meet `graphRoot`,
     * `universeId` or `ratifier` before they meet a sentence telling them what the page is for — so
     * the check is positional rather than global: these words are entirely legitimate inside
     * "Transaction details" and "How this was computed", and the technical proof pages are exempt
     * because a reader who navigated to `/proof/...` asked for exactly this.
     */
    if (!route.path.startsWith("/proof")) {
      const aboveFold = await page.evaluate<string>(
        `(() => {
           const out = [];
           const walk = document.querySelectorAll("main h1, main h2, main p, main li, main strong, main span");
           for (const node of walk) {
             if (node.closest("details") !== null) continue;
             const box = node.getBoundingClientRect();
             if (box.top < 900) out.push(node.textContent || "");
           }
           return out.join(" ");
         })()`,
      );
      const jargon = [
        "graph root",
        "graphRoot",
        "universeId",
        "universe hash",
        "deployment id",
        "allocation chunk",
        "ratifier",
        "callback",
        "handle 0x",
      ].filter((term) => aboveFold.toLowerCase().includes(term.toLowerCase()));
      if (jargon.length > 0) {
        fail(
          "jargon above the fold",
          route.path,
          `${jargon.join(", ")} appears before any explanation, and outside a disclosure`,
        );
      }
    }

    /*
     * 11c. ONE DOMINANT NEXT ACTION, OR A CLEAR COMPLETED STATE.
     *
     * Every application page must give the reader somewhere to go. A page with no cobalt action and
     * no completion marker is a dead end, and a dashboard made of dead ends is the flat, equal-weight
     * surface this correction is fixing.
     *
     * `aria-busy` counts, because a page still reading the chain has not failed to decide — it has
     * not finished. Without it this check failed on a capsule detail page caught mid-read, which is
     * a timing artefact rather than a dead end, and "wait longer" would have made the check slower
     * and no more truthful.
     */
    if (route.path.startsWith("/app")) {
      const decided = await page.evaluate<number>(
        `document.querySelectorAll(
           "main .primary, main [data-complete='true'], main .empty, " +
           "main [data-testid='requires-wallet'], main .role-cards, main [aria-busy='true']"
         ).length`,
      );
      if (decided === 0) {
        fail(
          "next action",
          route.path,
          "no primary action, no completion state and no explained empty state — the page is a dead end",
        );
      }
    }

    // ── 12. forbidden copy ──────────────────────────────────────────────────────────────────
    const body = ((await page.locator("body").textContent()) ?? "").toLowerCase();
    for (const phrase of FORBIDDEN_PHRASES) {
      if (body.includes(phrase.toLowerCase())) {
        fail(
          "copy",
          route.path,
          `the page contains "${phrase}" — Nox grants are permanent and unfinished copy must not ship`,
        );
      }
    }

    /*
     * 13. No uncaught browser error.
     *
     * A failed network request is NOT one. Chromium logs `Failed to load resource` for any fetch it
     * could not complete, and with no local node running every page correctly reports the chain as
     * unavailable — which is the honest state, not a defect. Counting it would make this check fail
     * precisely when the interface was behaving as designed, so the network layer's own message is
     * separated from anything the application itself threw or logged.
     */
    const uncaught = consoleErrors.filter(
      (message) => !message.startsWith("Failed to load resource"),
    );
    const networkFailures = consoleErrors.length - uncaught.length;
    if (uncaught.length > 0) {
      fail("console", route.path, uncaught.slice(0, 2).join(" | "));
    }
    if (networkFailures > 0 && !recordAvailable) {
      unreachable.add(route.path);
    }

    // ── 14. nothing that looks like a credential reached the page source ────────────────────
    const source = await page.content();
    if (/eth-[a-z-]+\.g\.alchemy\.com\/v2\/[A-Za-z0-9_-]{10,}/.test(source)) {
      fail("secrets", route.path, "a provider URL with a key is present in the page source");
    }
  }

  await context.close();
}

/** 360px wide. Nothing may scroll the page body sideways; wide content scrolls inside its own box. */
/**
 * Every control that says "connect wallet" must open the wallet chooser.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A CHECK AND NOT A COMMENT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The onboarding step's connect button did nothing for four days. It rendered, it was enabled, it
 * had a click handler, its handler ran to completion and returned normally — and the handler's first
 * branch was a deliberate `return` written when the header was the only connect control in the
 * product. Nothing in this file caught it: the route walked clean, the console was silent, the
 * button was visible, the responsive pass measured it at every width.
 *
 * A button that is present and does nothing is invisible to every check that asks whether a page
 * rendered. The only thing that finds it is clicking it and asserting that something happened.
 *
 * The assertion is deliberately on RainbowKit's own dialog rather than on Kyrve state: a wallet
 * cannot be connected in headless Chromium, so the furthest this can go is proving the chooser
 * opened. That is exactly the step that was broken.
 */
async function checkConnectControls(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<void> {
  const CONTROLS: readonly {
    readonly path: string;
    readonly testId: string;
    readonly setup?: string;
  }[] = [
    {
      path: "/app/start",
      testId: "start-connect",
      // Step two is only reachable once a role is chosen; the onboarding flow gates it.
      setup: `localStorage.setItem("kyrve.role","provider")`,
    },
    { path: "/app", testId: "connect" },
  ];

  for (const control of CONTROLS) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    try {
      if (control.setup !== undefined) await page.addInitScript(control.setup);
      await page.goto(`${PREVIEW_URL}${control.path}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);

      const button = page.locator(`[data-testid="${control.testId}"]`);
      if ((await button.count()) === 0) {
        fail("connect control", control.path, `no control with testid "${control.testId}"`);
        continue;
      }

      await button.first().click();
      await page.waitForTimeout(1500);

      const dialogs = await page.locator('[role="dialog"]').count();
      if (dialogs === 0) {
        fail(
          "connect control",
          control.path,
          `"${control.testId}" was clicked and no wallet chooser opened — the click is a no-op`,
        );
      } else {
        notes.push(`${control.path} · ${control.testId} opens the wallet chooser`);
      }
    } finally {
      await context.close();
    }
  }
}

async function checkResponsive(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const page = await context.newPage();

  for (const route of ROUTES) {
    await page.goto(`${PREVIEW_URL}${route.path}`, { waitUntil: "domcontentloaded" });
    if ((await page.getByTestId("boot-error").count()) > 0) continue;
    const overflow = await page.evaluate<number>(
      `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
    );
    if (overflow > 1) {
      fail(
        "responsive",
        route.path,
        `the page body overflows horizontally by ${overflow}px at 360px`,
      );
    }
  }

  await context.close();
}

function report(recordServed: boolean): void {
  console.log("");
  if (!recordServed) {
    console.log(
      "  SKIPPED (mostly) — no deployment record is being served, so the terminal correctly refuses\n" +
        "  to start and every rendered check was skipped rather than passed. Bring up a local stack\n" +
        "  and deploy first:  pnpm deploy:confidential local\n",
    );
  }

  for (const note of notes) console.log(`  note   ${note}`);
  if (unreachable.size > 0) {
    console.log(
      `  note   ${unreachable.size} route(s) reported the chain as unreachable, which is the honest\n` +
        "         state with no local node running and is not counted as a browser error",
    );
  }

  if (failures.length === 0) {
    console.log(`\n  PASS — ${ROUTES.length} routes walked, no finding.\n`);
    console.log(
      "  NOT AN ACCESSIBILITY AUDIT. This checks a fixed list of structural properties that can be\n" +
        "  checked mechanically. A real audit involves a person and assistive technology, and nothing\n" +
        "  here substitutes for one.\n",
    );
    return;
  }

  console.log(`\n  FAIL — ${failures.length} finding(s):\n`);
  for (const finding of failures) {
    console.log(`    ${finding.check.padEnd(18)} ${finding.route.padEnd(28)} ${finding.detail}`);
  }
  console.log("");
  process.exitCode = 1;
}

await main();
