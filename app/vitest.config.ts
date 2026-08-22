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
    // The "../lib/*/src/**" include is deliberately narrow: it keeps collection
    // inside each workspace package's source tree, so vitest never descends into
    // lib/*/node_modules and collects zod's own bundled tests (which fail on
    // missing dev-only imports). The node_modules/dist excludes below are
    // belt-and-braces against the same hazard — a relative "**/node_modules/**"
    // alone does not match paths reached by escaping this directory.
    include: ["**/*.test.ts", "**/*.test.tsx", "../lib/*/src/**/*.test.ts"],
    exclude: ["node_modules", ".next", "**/node_modules/**", "../lib/**/node_modules/**", "**/dist/**"],
    // Several route tests load the real @workspace/db (they need its schema-derived
    // exports, e.g. dependentsOf/isBlocking), which constructs a pg.Pool at module
    // scope — 2.5-3.2s in a cold worker. Under full-suite parallel load that cost
    // pushes past the 5000ms default and flakes tests that are otherwise fine. 20s
    // still fails a genuinely hung test; it just stops punishing cold-start cost.
    testTimeout: 20000,
  },
});
