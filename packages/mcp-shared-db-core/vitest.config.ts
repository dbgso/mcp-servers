import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // Scoped to this package. Without it, coverage reaches through the
      // symlinks pnpm creates for workspace dependencies and reports their
      // files too — which made this package look far less covered than it is,
      // and made a well-covered file in a neighbour look nearly untested.
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/index.ts", "src/**/*.d.ts"],
      // Set from what the suite actually covers today, so the number can only
      // be moved deliberately. Not a target — a ratchet.
      thresholds: {
        statements: 98,
        branches: 97,
        functions: 100,
        lines: 100,
      },
    },
  },
});
