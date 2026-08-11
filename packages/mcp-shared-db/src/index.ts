// Layer 1: Structural metadata (auto-generatable)
export type {
  RelationalFieldType,
  FieldMetadata,
  IndexMetadata,
  ForeignKeyMetadata,
  TableMetadata,
  TableMetadataMap,
} from "./metadata.js";

// Layer 2: Selectable-fields config (hand-edited PII / access-control whitelist)
export type {
  SelectableFieldInfo,
  TableConfig,
  SelectableFieldsMap,
} from "./selectable-fields.js";
export {
  getAllFieldNames,
  redactPii,
  redactPiiMany,
} from "./selectable-fields.js";

// DataSource interface — engine-agnostic data access surface used by ops.
export type {
  DataSource,
  FindByPkInput,
  FindByEqInput,
  FindByRangeInput,
  FindByJsonPathInput,
  ExplainResult,
} from "./data-source.js";

// Tool factory (describe + execute pair)
export { createDatabaseTools } from "./tools-factory.js";
export type { CreateDatabaseToolsConfig } from "./tools-factory.js";

// Operations (for advanced wiring or extension)
export type { DatabaseOperation, DatabaseOperationContext } from "./operations/types.js";
export { databaseRegistry, allDatabaseOperations } from "./operations/registry.js";
