import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "clover", "json"],
      // Every source file, not only the ones a test happens to import. The
      // default include counts nothing else, so a file with no test at all
      // does not appear in the total -- which is how `server.ts` sat at 0%
      // without showing up in the figure.
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/__tests__/**",
        "src/**/index.ts",
        "src/**/types.ts",
        "src/types/**",
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
