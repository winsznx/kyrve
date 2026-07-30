/**
 * `pnpm demo:screenshots` — every major surface, captured from the running product.
 *
 * Against the live local stack when one is up, so the screens show real settled state rather than
 * empty states. Without a stack it still runs and captures the honest empty product — which is worth
 * having too, because "what a new deployment looks like" is a real question.
 *
 * NO PRIVATE VALUE IS EVER IN FRAME. Nothing here decrypts, and the walk never clicks a decrypt
 * control. Every number in these images is public: a handle's existence, a public amount, a verdict.
 * A screenshot is the single easiest way for a decrypted balance to end up in a repository, and this
 * script is the one place that risk is concentrated — so it is stated here and enforced by never
 * touching the affordance.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

import { chromium, type Page } from "playwright";

import { repoPath, run } from "../lib/shell.js";
import { readLiveManifest } from "../stack/manifest.js";

const OUT = repoPath("docs/phase7/screenshots");

/** The surfaces worth a picture, in the order somebody meets them. */
const SURFACES: readonly {
  readonly name: string;
  readonly path: string;
  readonly full?: boolean;
}[] = [
  { name: "01-landing", path: "/" },
  { name: "02-onboarding-role", path: "/app/start" },
  { name: "03-home", path: "/app" },
  { name: "04-activity", path: "/app/activity" },
  { name: "05-add-capital", path: "/app/fund" },
  { name: "06-lending-terms", path: "/app/mandates" },
  { name: "07-request-a-quote", path: "/app/request" },
  { name: "08-private-matching", path: "/app/curve" },
  { name: "09-quotes", path: "/app/quotes" },
  { name: "10-positions", path: "/app/series" },
  { name: "11-disclosures", path: "/app/capsules" },
  { name: "12-move-maturity", path: "/app/roll" },
  { name: "13-verify", path: "/proof" },
  { name: "14-verify-deployment", path: "/proof/deployment" },
  { name: "15-demo-mode", path: "/demo" },
];

/**
 * Refuses to capture a page that did not render.
 *
 * A screenshot is evidence, and blank evidence written with a success line is the failure mode this
 * script actually hit: nothing was listening, the navigation error was swallowed, and sixteen white
 * frames were committed as proof.
 */
async function assertRendered(page: Page, path: string): Promise<void> {
  const text = (await page.innerText("body")).trim();
  if (text.length < 40) {
    throw new Error(`${path} rendered ${text.length} characters of text; refusing to capture it`);
  }
}

async function main(): Promise<void> {
  const live = await readLiveManifest();
  const baseUrl = live.live ? live.manifest.webUrl : "http://127.0.0.1:4173";

  /*
   * Start a preview server when no stack is up, and REFUSE to capture against nothing.
   *
   * The first version caught the navigation failure and screenshotted whatever the page happened to
   * be — which, with nothing listening, is a blank white frame. Sixteen blank images written with a
   * success message is the worst possible outcome for a script whose entire product is evidence.
   */
  let preview: ChildProcess | undefined;
  if (!live.live) {
    console.log("\n  no local stack — building and previewing the bundle");
    console.log("  For screens with real settled state, run `pnpm stack:local` first.\n");
    run("pnpm", ["--filter", "@kyrve/web", "build"]);
    preview = spawn(
      "pnpm",
      ["--filter", "@kyrve/web", "exec", "vite", "preview", "--host", "127.0.0.1"],
      { cwd: repoPath("."), stdio: "ignore", detached: true },
    );
  }

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(baseUrl)).ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      throw new Error(
        `nothing is serving at ${baseUrl}. Refusing to capture: a blank screenshot written with a ` +
          "success message is worse than no screenshot at all.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    /*
     * The role is seeded so the application screens show the product rather than the onboarding
     * flow. Written directly rather than clicked through: this is a capture script, and walking the
     * flow before every shot would make the images depend on the flow still working — which is what
     * `verify:journeys` is for.
     */
    await context.addInitScript(
      `try { window.localStorage.setItem("kyrve.role", "provider");
             window.localStorage.setItem("kyrve.onboarded", "true"); } catch {}`,
    );

    const page = await context.newPage();
    for (const surface of SURFACES) {
      // The onboarding shot needs a browser that has NOT been onboarded, or it redirects past it.
      const target = surface.path === "/app/start" ? await freshPage() : page;
      await target.goto(`${baseUrl}${surface.path}`, { waitUntil: "networkidle" });
      await target.waitForTimeout(700);
      await assertRendered(target, surface.path);
      await target.screenshot({
        path: `${OUT}/${surface.name}.png`,
        fullPage: surface.full === true,
      });
      console.log(`  captured ${surface.name}`);
      if (target !== page) await target.context().close();
    }

    /*
     * The landing at three widths, because "responsive" is a claim about specific breakpoints.
     *
     * Captured at viewport size rather than full page: a full-page shot of an eleven-section
     * narrative resizes the viewport, which re-triggers lazy loading and the entry observer and
     * produced a blank frame. Viewport captures at the three widths are the evidence that was
     * actually asked for.
     */
    for (const [label, width, height] of [
      ["17-landing-desktop", 1440, 900],
      ["18-landing-tablet", 768, 1024],
      ["19-landing-mobile", 390, 844],
    ] as const) {
      const context2 = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 2,
      });
      const shot = await context2.newPage();
      await shot.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
      await shot.waitForTimeout(900);
      await assertRendered(shot, "/");
      await shot.screenshot({ path: `${OUT}/${label}.png` });
      console.log(`  captured ${label}`);
      await context2.close();
    }

    // One mobile shot, because "mobile navigation remains usable" is a claim worth showing.
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    await mobile.addInitScript(
      `try { window.localStorage.setItem("kyrve.role", "provider");
             window.localStorage.setItem("kyrve.onboarded", "true"); } catch {}`,
    );
    const small = await mobile.newPage();
    await small.goto(`${baseUrl}/app`, { waitUntil: "networkidle" });
    await small.waitForTimeout(700);
    await assertRendered(small, "/app");
    await small.screenshot({ path: `${OUT}/16-home-mobile.png` });
    console.log("  captured 16-home-mobile");
    await mobile.close();

    await context.close();
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

  console.log(`\n  ${SURFACES.length + 1} surfaces written to docs/phase7/screenshots/\n`);

  async function freshPage() {
    const clean = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    return clean.newPage();
  }
}

await main();
