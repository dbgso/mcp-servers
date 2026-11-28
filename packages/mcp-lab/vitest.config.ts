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
        // The version shim: its one branch is decided by the bundler's
        // `define`, so only one side of it can run in any given build.
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
