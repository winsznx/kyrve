import { defineConfig } from "vitest/config";

// Node-side unit and property tests only. Worker tests run under workerd through each
// worker's own vitest config and are invoked by `pnpm test:workers`; Solidity tests run
// under Foundry via `pnpm test:contracts`.
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
