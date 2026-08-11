// Engine-specific helper tests live in the adapter packages
// (`mcp-shared-db-sql`, `mcp-shared-db-postgres`). `helpers.ts` here is now
// an empty re-export. Vitest 4 rejects test files with no suites, so this
// placeholder keeps the file valid.
import { describe, it } from "vitest";

describe.skip("helpers (moved to adapter packages)", () => {
  it("placeholder", () => {});
});
