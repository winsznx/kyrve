import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * The Kyrve web product.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * TWO STATIC ROOTS, AND WHY THEY ARE NOT MERGED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `apps/web/public/` holds `deployment.json`, which is WRITTEN by a deployment run and is never
 * committed. The repository's `public/` holds the approved brand rasters and the web manifest, which
 * are committed, hash-pinned in `brand.json` and re-checked by `pnpm brand:verify`.
 *
 * Copying the brand assets into the app's public directory would make what ships a derivative of a
 * derivative — the thing `docs/brand/ASSET-MANIFEST.md` says nothing does — and would put hash-pinned
 * files in a directory whose whole point is that its contents are disposable. So the approved assets
 * are served from where they are verified, by the plugin below, in dev and in the build alike.
 */
const REPO_PUBLIC = fileURLToPath(new URL("../../public/", import.meta.url));

function approvedBrandAssets(): Plugin {
  return {
    name: "kyrve-approved-brand-assets",

    // Dev and preview: serve the verified files in place. No copy, so a divergence between what the
    // page shows and what `brand:verify` checked is not representable.
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = (request.url ?? "").split("?")[0] ?? "";
        if (!url.startsWith("/brand/") && url !== "/site.webmanifest") {
          next();
          return;
        }
        const path = `${REPO_PUBLIC}${url.replace(/^\//, "")}`;
        try {
          statSync(path);
        } catch {
          next();
          return;
        }
        if (path.endsWith(".webmanifest")) {
          response.setHeader("content-type", "application/manifest+json");
        }
        createReadStream(path).pipe(response);
      });
    },

    // Build: one copy, straight from the verified originals into the output. Never from a previous
    // build's output — a derivative of a derivative compounds loss and cannot be re-derived.
    closeBundle() {
      if (!existsSync(REPO_PUBLIC)) return;
      cpSync(`${REPO_PUBLIC}brand`, fileURLToPath(new URL("./dist/brand/", import.meta.url)), {
        recursive: true,
      });
      const manifest = `${REPO_PUBLIC}site.webmanifest`;
      if (existsSync(manifest)) {
        cpSync(manifest, fileURLToPath(new URL("./dist/site.webmanifest", import.meta.url)));
      }
    },
  };
}

/**
 * Every route must render when it is TYPED, not only when it is clicked.
 *
 * `appType: "spa"` gives the dev and preview servers a history fallback, so `/app/series/0x…` entered
 * in the address bar reaches `index.html` and the router matches it. Without it, refreshing any route
 * below the root is a 404 — the classic single-page-application defect, invisible from inside the
 * application because clicking never exercises it. `scripts/verify/routes.ts` refreshes every route
 * against a real server for exactly that reason.
 *
 * `deployment.json` is served from `public/` and is written by a deployment run. It is never
 * committed and never baked into the bundle: a terminal with addresses compiled in would happily
 * display a balance from a deployment that no longer exists.
 */
export default defineConfig({
  appType: "spa",
  plugins: [react(), approvedBrandAssets()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: "es2022", sourcemap: true },
});
