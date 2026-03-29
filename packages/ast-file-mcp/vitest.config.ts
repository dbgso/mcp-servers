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
      thresholds: {
        // Global thresholds - realistic for code with I/O error handling
        statements: 85,
        branches: 70,
        functions: 95,
        lines: 85,
        // Per-file thresholds for tool handlers
        "src/tools/handlers/*.ts": {
          statements: 90,
          branches: 85,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
});
