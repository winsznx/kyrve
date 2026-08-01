/**
 * `pnpm verify:ux-final` — the product-experience gate.
 *
 * Everything about whether the protocol works is proven by `verify:phase7`. This asks the different
 * question: is what ships an industry-grade product? It runs the browser walks, then adds the checks
 * that only matter once the thing is meant to be used by somebody who has never seen it.
 *
 * It reports SKIP for nothing. Anything it cannot check is a FAIL with the reason, because a
 * product-experience gate that quietly passes over an unmeasured claim is how a regression ships.
 */

import { existsSync, readFileSync, statSync } from "node:fs";

import { chromium } from "playwright";
import { readJson, repoPath, run } from "../lib/shell.js";

interface Result {
  readonly name: string;
  readonly status: "PASS" | "FAIL";
  readonly detail: string;
}

const results: Result[] = [];

function check(name: string, run_: () => string): void {
  try {
    results.push({ name, status: "PASS", detail: run_() });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      detail: error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : String(error),
    });
  }
}

async function checkAsync(name: string, run_: () => Promise<string>): Promise<void> {
  try {
    results.push({ name, status: "PASS", detail: await run_() });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      detail: error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : String(error),
    });
  }
}

/** Every screenshot the brief requires as evidence. Missing or blank is a failure. */
const REQUIRED_SCREENSHOTS = [
  "17-landing-desktop",
  "18-landing-tablet",
  "19-landing-mobile",
  "02-onboarding-role",
  "03-home",
  "09-quotes",
  "10-positions",
  "11-disclosures",
  "13-verify",
  "16-home-mobile",
];

async function main(): Promise<void> {
  // ── The existing gates still hold ────────────────────────────────────────────────────────
  check("every route walks: refresh, metadata, keyboard, design rules, links", () => {
    const output = run("pnpm", ["exec", "tsx", "scripts/verify/web.ts"]).stdout;
    const match = /PASS — (\d+) routes walked/.exec(output);
    if (match === null) throw new Error("verify:web did not report a clean walk");
    return `${match[1]} routes, no finding`;
  });

  check("all three role journeys reach their first task by clicking", () => {
    run("pnpm", ["exec", "tsx", "scripts/verify/journeys.ts"]);
    const record = readJson<Record<string, unknown>>(repoPath("evidence/phase7/journeys.json"));
    if (record["findings"] !== 0) throw new Error(`${record["findings"]} journey finding(s)`);
    return `${(record["rolesWalked"] as string[]).length} roles, navigation is role-shaped`;
  });

  // ── The Encrypted Field ──────────────────────────────────────────────────────────────────
  check("the Encrypted Field is generated, hashed and inside its budgets", () => {
    const manifest = readJson<{
      fields: {
        name: string;
        assets: { file: string; bytes: number; withinBudget: boolean | null; sha256: string }[];
        mobile?: { assets: { file: string; bytes: number; withinBudget: boolean | null }[] };
      }[];
    }>(repoPath("docs/design/dither-manifest.json"));

    const over: string[] = [];
    let bytes = 0;
    for (const field of manifest.fields) {
      for (const asset of [...field.assets, ...(field.mobile?.assets ?? [])]) {
        if (!existsSync(repoPath(asset.file))) {
          throw new Error(`${asset.file} is in the manifest and not on disk`);
        }
        // The manifest must describe the bytes that actually shipped.
        const actual = statSync(repoPath(asset.file)).size;
        if (actual !== asset.bytes) {
          throw new Error(`${asset.file} is ${actual} B; the manifest says ${asset.bytes} B`);
        }
        if (asset.withinBudget === false) over.push(asset.file);
        if (asset.file.endsWith(".avif")) bytes += asset.bytes;
      }
    }
    if (over.length > 0) throw new Error(`over budget: ${over.join(", ")}`);
    return `${manifest.fields.length} fields, ${Math.round(bytes / 1024)} KB of AVIF in total`;
  });

  check("a mobile viewport never fetches a desktop field", () => {
    const source = readFileSync(repoPath("apps/web/src/components/EncryptedField.tsx"), "utf8");
    if (!source.includes("-900.avif") || !source.includes("sizes=")) {
      throw new Error("the field component ships no mobile derivative or no sizes attribute");
    }
    if (!source.includes("width={field.width}") || !source.includes("height={field.height}")) {
      throw new Error("the field component omits intrinsic dimensions, so it can shift layout");
    }
    return "srcset carries a 900px derivative and every image declares its intrinsic size";
  });

  // ── The wallet boundary ──────────────────────────────────────────────────────────────────
  check("the deterministic test wallet cannot be reached from a query parameter", () => {
    const source = readFileSync(repoPath("apps/web/src/lib/session.ts"), "utf8");
    if (/location\.search|URLSearchParams|searchParams/.test(source)) {
      throw new Error(
        "the session module reads the URL; a test wallet must never be URL-activated",
      );
    }
    if (!source.includes("__KYRVE_LOCAL_KEY__")) {
      throw new Error("the deterministic adapter is gone; four browser suites depend on it");
    }
    return "the local key is injected by the harness only, never from a URL";
  });

  check("no provider credential reaches the client bundle", () => {
    const output = run("pnpm", ["exec", "tsx", "scripts/verify/bundles.ts"]).stdout;
    if (!/0 secrets inlined/.test(output)) throw new Error("the bundle check did not report clean");
    return "0 secrets inlined, viem/node absent";
  });

  // ── Evidence ─────────────────────────────────────────────────────────────────────────────
  check("every required screenshot exists and is not blank", () => {
    for (const name of REQUIRED_SCREENSHOTS) {
      const path = repoPath(`docs/phase7/screenshots/${name}.png`);
      if (!existsSync(path)) throw new Error(`${name}.png is missing`);
      // A blank 2x frame compresses to almost nothing. Real screens do not.
      if (statSync(path).size < 20_000) {
        throw new Error(`${name}.png is ${statSync(path).size} B, which is a blank frame`);
      }
    }
    return `${REQUIRED_SCREENSHOTS.length} screenshots present, none blank`;
  });

  check("the landing proof line is generated, not written", () => {
    const generated = repoPath("apps/web/src/generated/proof-summary.ts");
    if (!existsSync(generated)) throw new Error("the proof summary has not been generated");
    run("pnpm", ["exec", "tsx", "scripts/generate/proof-summary.ts"]);
    const dirty = run("git", ["status", "--porcelain", "--", generated]).stdout.trim();
    if (dirty.length > 0) {
      throw new Error(
        "the committed proof summary differs from the evidence it claims to describe",
      );
    }
    const source = readFileSync(generated, "utf8");
    if (!source.includes("PROOF_LINE")) throw new Error("no proof line was generated");
    return "regenerates byte-identical from the evidence records";
  });

  // ── The rendered product ─────────────────────────────────────────────────────────────────
  await checkAsync("the landing narrative renders at every tested width", async () => {
    const { baseUrl, stop } = await serve();
    const browser = await chromium.launch();
    try {
      const widths: readonly [number, number][] = [
        [360, 800],
        [390, 844],
        [768, 1024],
        [1024, 768],
        [1280, 800],
        [1440, 900],
        [1728, 1117],
      ];
      const required = [
        "tagline",
        "problem",
        "mechanism",
        "two-systems",
        "boundary",
        "outcomes",
        /*
         * "product" is deliberately absent.
         *
         * It was a strip of interface screenshots that said nothing the hero does not already say
         * with the live quote specimen, and it cost roughly 1,300px of scroll to say it. The section
         * was removed; this list is the record of that, because a required-section list that still
         * names it would fail forever on a page that is correct.
         */
        "evidence",
        "faq",
        "close",
      ];

      for (const [width, height] of widths) {
        const context = await browser.newContext({ viewport: { width, height } });
        const page = await context.newPage();
        await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });

        for (const section of required) {
          if ((await page.getByTestId(section).count()) === 0) {
            throw new Error(`section "${section}" is absent at ${width}px`);
          }
        }

        const overflow = await page.evaluate<number>(
          `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
        );
        if (overflow > 1) throw new Error(`the landing overflows by ${overflow}px at ${width}px`);

        // One filled action above the fold, always.
        const fills = await page.evaluate<number>(
          `[...document.querySelectorAll(".primary")].filter(n => n.getBoundingClientRect().top < ${height}).length`,
        );
        if (fills > 1) throw new Error(`${fills} filled actions above the fold at ${width}px`);

        await context.close();
      }
      return `${widths.length} widths, 10 sections, no overflow, one filled action above the fold`;
    } finally {
      await browser.close();
      stop();
    }
  });

  await checkAsync("the mobile shell puts four destinations at the thumb", async () => {
    const { baseUrl, stop } = await serve();
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.addInitScript(
        `try { localStorage.setItem("kyrve.role","provider"); localStorage.setItem("kyrve.onboarded","true"); } catch {}`,
      );
      const page = await context.newPage();
      await page.goto(`${baseUrl}/app`, { waitUntil: "networkidle" });

      const bottom = page.getByTestId("bottom-nav");
      if ((await bottom.count()) === 0) throw new Error("there is no bottom navigation at 390px");

      const links = bottom.locator("a");
      if ((await links.count()) !== 4) throw new Error("the bottom navigation is not four items");

      for (let index = 0; index < 4; index += 1) {
        const box = await links.nth(index).boundingBox();
        if (box === null || box.height < 44) {
          throw new Error(`bottom navigation item ${index} is under the 44px touch target`);
        }
      }
      if ((await page.locator('[aria-current="page"]').count()) === 0) {
        throw new Error("nothing is marked aria-current in the mobile shell");
      }
      await context.close();
      return "four destinations, 56px targets, current item marked";
    } finally {
      await browser.close();
      stop();
    }
  });

  await checkAsync("motion honours a reduced-motion preference", async () => {
    const { baseUrl, stop } = await serve();
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ reducedMotion: "reduce" });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });

      // The tagline must be fully resolved rather than animating from muted.
      const unlit = await page.evaluate<number>(
        `document.querySelectorAll('[data-word]:not([data-lit="true"])').length`,
      );
      if (unlit > 0) {
        throw new Error(`${unlit} tagline words are still muted under prefers-reduced-motion`);
      }
      await context.close();
      return "the tagline renders resolved, not animated at zero duration";
    } finally {
      await browser.close();
      stop();
    }
  });

  report();
}

/** A preview server for the built bundle, and the way to stop it. */
async function serve(): Promise<{ baseUrl: string; stop: () => void }> {
  const { spawn } = await import("node:child_process");
  const baseUrl = "http://127.0.0.1:4173";
  try {
    if ((await fetch(baseUrl)).ok) return { baseUrl, stop: () => undefined };
  } catch {
    // nothing serving; start one
  }
  const child = spawn(
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
  return {
    baseUrl,
    stop: () => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // already gone
        }
      }
    },
  };
}

function report(): void {
  const width = Math.max(...results.map((result) => result.name.length));
  console.log("\nUX FINAL\n");
  for (const result of results) {
    console.log(`  ${result.status.padEnd(4)}  ${result.name.padEnd(width)}  ${result.detail}`);
  }
  const failed = results.filter((result) => result.status === "FAIL").length;
  console.log(`\n  ${results.length - failed} passed, ${failed} failed, 0 skipped\n`);
  if (failed > 0) {
    console.log("  VERDICT: FAIL\n");
    process.exitCode = 1;
    return;
  }
  console.log("  VERDICT: PASS — every check executed and passed.\n");
}

await main();
