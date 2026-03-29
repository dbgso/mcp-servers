import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    setupFiles: ["./src/__tests__/vitest-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "clover", "json"],
      include: [
        "src/**/*.ts",
      ],
      exclude: [
        "src/**/__tests__/**",
        "src/**/index.ts",
        "src/types/**",
      ],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
