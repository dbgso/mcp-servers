// Layer 2 — PII / access-control whitelist
export type {
  FieldVisibility,
  SelectableFieldInfo,
  TableConfig,
  SelectableFieldsMap,
} from "./selectable-fields.js";
export {
  getAllFieldNames,
  getEffectiveNote,
  getEffectivePolicy,
  getQueryableFieldNames,
  redactPii,
  redactPiiMany,
} from "./selectable-fields.js";

// Legacy-detection helper for startup nudges (db-read-mcp consumes it).
export type {
  LegacyUsageReport,
  LegacyUsageEntry,
} from "./legacy-detector.js";
export { detectLegacySelectableFieldsUsage } from "./legacy-detector.js";

// Layer 1 — generic structural metadata
export type {
  GenericFieldType,
  GenericFieldMetadata,
  GenericTableMetadata,
  GenericTableMetadataMap,
} from "./metadata.js";

// Layer 1 — RDB-flavoured structural metadata (indexes / foreign keys)
export type {
  RelationalFieldType,
  FieldMetadata,
  IndexMetadata,
  ForeignKeyMetadata,
  RdbTableMetadata,
  RdbTableMetadataMap,
} from "./rdb-metadata.js";

// Access-control helpers
export { listAvailableTables, isTableAllowed, isColumnAllowed } from "./access-control.js";

// Index-coverage helpers (used by read ops to flag un-indexed lookups)
export { hasLeadingIndex, unindexedColumnWarning } from "./index-check.js";

// Core context shared by DB-agnostic operations
export type { DatabaseCoreContext, CoreOperation } from "./types.js";

// Reusable DB-agnostic operations
export { listTablesOp } from "./operations/list-tables.js";
export { describeTableOp } from "./operations/describe-table.js";

// Native-type classifier (used by validator heuristics)
export type { NativeTypeClass } from "./native-type-classifier.js";
export { classifyNativeType, looksLikeForeignKeyName } from "./native-type-classifier.js";

// Pure validator for selectable-fields coverage
export type {
  ValidationIssueKind,
  ValidationIssue,
  ValidationSummary,
  PiiOverapplyByKind,
  ValidateSelectableFieldsCoverageParams,
  ValidateSelectableFieldsCoverageResult,
} from "./validate.js";
export { validateSelectableFieldsCoverage } from "./validate.js";
