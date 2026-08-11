/**
 * Fixture module: shape mirrors what `mcp-shared-db-codegen` produces. Loaded
 * via dynamic import in `load-config.test.ts`.
 */
import type { SelectableFieldsMap } from "mcp-shared-db";

export const selectableFields: SelectableFieldsMap = {
  users: {
    description: "fixture users table",
    fields: {
      id: { select: "expose" },
      name: { select: "redact", note: "real name" },
    },
  },
};
