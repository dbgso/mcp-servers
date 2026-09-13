import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/__tests__/**",
        "src/index.ts",
        "src/**/*.d.ts",
      ],
      // Set from what the suite actually covers today, so the number can only
      // be moved deliberately. Not a target — a ratchet.
      thresholds: {
        statements: 96,
        branches: 90,
        functions: 92,
        lines: 99,
      },
    },
  },
});
