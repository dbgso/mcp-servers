import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "clover", "json"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/__tests__/**",
        "src/**/index.ts",
        "src/types/**",
      ],
      // The project standard is 95 (`coding-rules__test-coverage`). This package
      // sits below it, and had no config at all, so nothing stopped it slipping
      // further. These are a ratchet set just under today's numbers: they fail
      // CI on a regression now, and get raised as the gap is closed. Raising
      // them to 95 is tracked separately -- the shortfall is in `tunnel.ts` and
      // `duckdb.ts`, not in anything a current PR touches.
      thresholds: {
        statements: 87,
        branches: 81,
        functions: 82,
        lines: 87,
      },
    },
  },
});
