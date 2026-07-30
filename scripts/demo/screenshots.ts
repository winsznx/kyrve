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

import { mkdirSync } from "node:fs";

import { chromium } from "playwright";

import { repoPath } from "../lib/shell.js";
import { readLiveManifest } from "../stack/manifest.js";

const OUT = repoPath("docs/phase7/screenshots");

/** The surfaces worth a picture, in the order somebody meets them. */
const SURFACES: readonly {
  readonly name: string;
  readonly path: string;
  readonly full?: boolean;
}[] = [
  { name: "01-landing", path: "/", full: true },
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
  { name: "15-demo-mode", path: "/demo", full: true },
];

async function main(): Promise<void> {
  const live = await readLiveManifest();
  const baseUrl = live.live ? live.manifest.webUrl : "http://127.0.0.1:4173";
  if (!live.live) {
    console.log(
      `\n  no local stack is running — capturing against ${baseUrl} if something answers`,
    );
    console.log("  For screens with real settled state, run `pnpm stack:local` first.\n");
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
      await target
        .goto(`${baseUrl}${surface.path}`, { waitUntil: "networkidle" })
        .catch(() => undefined);
      await target.waitForTimeout(600);
      await target.screenshot({
        path: `${OUT}/${surface.name}.png`,
        fullPage: surface.full === true,
      });
      console.log(`  captured ${surface.name}`);
      if (target !== page) await target.context().close();
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
    await small.goto(`${baseUrl}/app`, { waitUntil: "networkidle" }).catch(() => undefined);
    await small.waitForTimeout(600);
    await small.screenshot({ path: `${OUT}/16-home-mobile.png` });
    console.log("  captured 16-home-mobile");
    await mobile.close();

    await context.close();
  } finally {
    await browser.close();
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
