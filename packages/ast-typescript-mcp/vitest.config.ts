import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // `findReferences` scans the repository: `git grep` picks candidate files
    // by symbol name and ts-morph parses each one. For a short name like `add`
    // that is around a hundred files, which takes ~15s alone and over 30s when
    // the rest of the suite is competing for the same cores -- so the 30s
    // ceiling failed this suite on a loaded machine while passing on an idle
    // one. The work is real, not a hang; the limit is here to catch a hang.
    testTimeout: 90000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "clover", "json"],
    },
  },
});
