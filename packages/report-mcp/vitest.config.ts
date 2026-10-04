import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "clover", "json"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/__tests__/**",
        "src/index.ts",
        "src/**/types.ts",
        // The version shim. Its one branch is decided by the bundler's
        // `define`: from source only the fallback can run.
        "src/version.ts",
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
