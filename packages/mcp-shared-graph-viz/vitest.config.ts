import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Barrels and type-only modules hold no executable code.
      exclude: [
        "src/__tests__/**",
        "src/index.ts",
        "src/types.ts",
        "src/layouts/index.ts",
        "src/layouts/types.ts",
      ],
      reporter: ["text", "html", "clover", "json"],
      thresholds: {
        lines: 95,
        statements: 95,
        branches: 90,
        functions: 95,
      },
    },
  },
});
