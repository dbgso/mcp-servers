// Re-exported from mcp-shared-db-core to keep imports stable for existing
// callers. New code should import directly from `mcp-shared-db-core`.
export type {
  SelectableFieldInfo,
  TableConfig,
  SelectableFieldsMap,
} from "mcp-shared-db-core";
export {
  getAllFieldNames,
  redactPii,
  redactPiiMany,
} from "mcp-shared-db-core";
