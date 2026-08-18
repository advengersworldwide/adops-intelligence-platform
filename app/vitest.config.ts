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
    include: ["**/*.test.ts", "**/*.test.tsx", "../lib/**/*.test.ts"],
    // The "../lib/**" include escapes this directory, so the relative
    // "**/node_modules/**" pattern does not match the traversed paths — without
    // the explicit "../lib" entry, vitest collects zod's own bundled tests from
    // lib/*/node_modules and the suite fails on missing dev-only imports.
    exclude: ["node_modules", ".next", "**/node_modules/**", "../lib/**/node_modules/**", "**/dist/**"],
  },
});
