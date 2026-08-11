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
        // Pure type modules — emit nothing at runtime.
        "src/introspect/types.ts",
        "src/operations/types.ts",
      ],
      thresholds: {
        lines: 100,
        statements: 95,
        branches: 90,
        functions: 100,
      },
    },
  },
});
