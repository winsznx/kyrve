import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The local confidential terminal.
 *
 * `deployment.json` is served from `public/` and is written by `pnpm deploy:confidential local`,
 * never committed and never baked into the bundle. A terminal with addresses compiled in would
 * happily display a balance from a deployment that no longer exists.
 */
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: "es2022", sourcemap: true },
});
