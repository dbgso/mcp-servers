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
        // Files that erase to an empty module: `data-source.ts` is the
        // adapter interface, `metadata.ts` and `selectable-fields.ts` are
        // re-export shims kept so existing imports resolve, and `helpers.ts`
        // is an `export {}` left where engine-specific helpers used to live.
        // v8 reports each as 0%, which is a measurement artifact rather than
        // a missing test: there is nothing in them to call.
        "src/data-source.ts",
        "src/metadata.ts",
        "src/selectable-fields.ts",
        "src/helpers.ts",
        // Same: these two are one-line re-exports of the core operations,
        // kept so the RDB registry can list them alongside its own.
        "src/operations/describe-table.ts",
        "src/operations/list-tables.ts",
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
