import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/index.ts"],
      reporter: ["text", "html", "clover", "json"],
      thresholds: {
        lines: 100,
        statements: 95,
        branches: 90,
        functions: 100,
      },
    },
  },
});
