import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx", "../lib/*/src/**/*.test.ts"],
    exclude: ["node_modules", ".next"],
    // Several route tests load the real @workspace/db (they need its schema-derived
    // exports, e.g. dependentsOf/isBlocking), which constructs a pg.Pool at module
    // scope — 2.5-3.2s in a cold worker. Under full-suite parallel load that cost
    // pushes past the 5000ms default and flakes tests that are otherwise fine. 20s
    // still fails a genuinely hung test; it just stops punishing cold-start cost.
    testTimeout: 20000,
  },
});
