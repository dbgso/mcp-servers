/**
 * Fixture module: shape mirrors what `mcp-shared-db-codegen` produces. Loaded
 * via dynamic import in `load-config.test.ts` to verify the launcher can pick
 * up user-supplied metadata at runtime.
 */
import type { TableMetadataMap } from "mcp-shared-db";

export const tableMetadata: TableMetadataMap = {
  users: {
    tableName: "users",
    primaryKey: ["id"],
    fields: {
      id: { type: "string", nullable: false },
      name: { type: "string", nullable: false },
    },
  },
};
