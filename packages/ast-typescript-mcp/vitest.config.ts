import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000, // 30 seconds for longer tests with coverage
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "clover", "json"],
    },
  },
});
