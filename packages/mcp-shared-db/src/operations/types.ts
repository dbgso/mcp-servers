import type { Operation } from "mcp-shared";
import type { DatabaseCoreContext } from "mcp-shared-db-core";
import type { DataSource } from "../data-source.js";
import type { TableMetadataMap } from "../metadata.js";

/**
 * RDB-specific context. Extends the DB-agnostic core context so that
 * `mcp-shared-db-core`'s `list_tables` / `describe_table` operations work
 * unchanged inside the RDB registry.
 *
 * `tableMetadata` is narrowed to RDB's richer `TableMetadataMap` (with
 * indexes/foreignKeys), which is structurally a subtype of the core's
 * `GenericTableMetadataMap`.
 *
 * Engine-specific concerns (SQL dialect, pg client, etc.) live behind the
 * `dataSource` adapter — they're never touched by the operation layer.
 */
export interface DatabaseOperationContext extends DatabaseCoreContext {
  dataSource: DataSource;
  tableMetadata: TableMetadataMap;
}

export type DatabaseOperation<TArgs = unknown> = Operation<TArgs, DatabaseOperationContext>;
