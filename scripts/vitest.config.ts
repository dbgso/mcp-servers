import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.mjs"],
    testTimeout: 30000,
    // No thresholds: this package is the repository's own build and
    // verification scripts, never published, and its tests are about the
    // checks themselves rather than about covering the scripts. The provider
    // is a dependency all the same, because CI now really does pass
    // `--coverage` to every package -- which is how this package came to fail
    // at startup with ERR_LOAD_URL the first time coverage actually ran.
    coverage: {
      provider: "v8",
      reporter: ["text"],
    },
  },
});
