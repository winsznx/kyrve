/**
 * Write `public/site.webmanifest` from `@kyrve/config`.
 *
 * A web app manifest that is hand-maintained alongside a typed constant drifts — the icon list
 * gains a size the assets do not have, or the theme colour stops matching the canvas, and neither
 * shows up until an install prompt renders wrong on someone's phone. Generating it means the served
 * bytes and the typed value are the same thing.
 *
 * Every icon path is checked against `public/` before writing. A manifest that points at a missing
 * icon fails the install silently.
 */

import { existsSync, writeFileSync } from "node:fs";

import { webAppManifest } from "../../packages/config/src/index.js";

import { repoPath } from "../lib/shell.js";

function main(): void {
  const manifest = webAppManifest();

  const missing = manifest.icons
    .map((icon) => icon.src)
    .filter((src) => !existsSync(repoPath(`public${src}`)));

  if (missing.length > 0) {
    console.error(`site.webmanifest would reference missing icons: ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const out = repoPath("public/site.webmanifest");
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`generated public/site.webmanifest (${manifest.icons.length} icons, all present)`);
}

main();
