import type { Operation } from "mcp-shared";
import type { SelectableFieldsMap } from "./selectable-fields.js";
import type { GenericTableMetadataMap } from "./metadata.js";

/**
 * Minimum context required by DB-agnostic operations (list_tables, describe_table).
 *
 * RDB-specific and DynamoDB-specific contexts must extend this — that lets
 * the discovery operations be reused across DB types via TypeScript's
 * structural subtyping (the wider context is assignable to the narrower one).
 */
export interface DatabaseCoreContext {
  selectableFields: SelectableFieldsMap;
  tableMetadata: GenericTableMetadataMap;
}

export type CoreOperation<TArgs = unknown> = Operation<TArgs, DatabaseCoreContext>;
