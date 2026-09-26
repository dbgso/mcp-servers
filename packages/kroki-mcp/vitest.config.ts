import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "clover", "json"],
      // Every source file, not only the ones a test happens to import.
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/__tests__/**",
        "src/**/index.ts",
        "src/**/types.ts",
        // The version shim. Its one branch is decided by the bundler's
        // `define`: from source only the fallback can run, and from a build
        // only the substituted literal.
        "src/version.ts",
      ],
      // The project standard, per `coding-rules__test-coverage`. This package
      // declared none, so nothing was checked.
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
