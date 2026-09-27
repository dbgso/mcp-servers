import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      exclude: [
        "src/index.ts",              // Entry point
        "src/server.ts",             // MCP server setup
        "src/handlers/base.ts",      // Abstract base class
        "src/handlers/index.ts",     // Handler registry
        "src/tools/base-handler.ts", // Abstract tool handler
        "src/tools/index.ts",        // Re-exports
        "src/tools/registry.ts",     // Tool registry setup
        "src/tools/types.ts",        // Type definitions
        "**/*.d.ts",
        "**/node_modules/**",
      ],
      // The project standard, per `coding-rules__test-coverage`. This package
      // carried 85/70/95/85 instead, with a comment calling that "realistic
      // for code with I/O error handling" -- but the gap was not error
      // handling. It was the AsciiDoc block converter and serialiser, whose
      // arms the integration suite never reached, and where two of them were
      // silently dropping content on write.
      //
      // The per-file rule for `src/tools/handlers/*.ts` (90/85/90/90) is gone:
      // a rule below the global one only ever restates it.
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
