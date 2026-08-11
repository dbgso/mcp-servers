import {
  createDescribeExecuteHandlers,
  type ToolHandler,
} from "mcp-shared";
import type { SelectableFieldsMap } from "./selectable-fields.js";
import type { TableMetadataMap } from "./metadata.js";
import type { DataSource } from "./data-source.js";
import { databaseRegistry } from "./operations/registry.js";

const DEFAULT_PREAMBLE = [
  "All operations are read-only. Provides safe, schema-aware access to a relational database.",
  "",
  "## Recommended workflow",
  "",
  "1. **Discover tables**: `list_tables` to see what is queryable.",
  "2. **Inspect a table**: `describe_table` for columns / types / PII flags.",
  "3. **Lookup**: `get_by_pk` for single rows, `get_by_fk` for related rows.",
  "4. **Filter**: `get_by_index` (any column), `get_by_date_range` (timestamp),",
  "   `json_search` (JSON column).",
  "",
  "## Date-range guard (automatic)",
  "",
  "`get_by_date_range` runs `EXPLAIN` first and refuses when the planner's",
  "row-count estimate exceeds the configured threshold (default 100,000;",
  "override with the `DBREAD_MAX_ESTIMATED_ROWS` env var). The error",
  "response includes `estimatedRows` and `planSummary` so you can pick a",
  "narrower range. If you genuinely need the wide scan, pass",
  "`confirmExpensive: true` and the guard will let it through.",
  "Engines that don't surface a planner estimate (e.g. SQLite without",
  "ANALYZE) have the guard bypassed automatically.",
  "",
  "## Ad-hoc cost sizing",
  "",
  "`explain_sql` accepts an arbitrary SQL string and returns the planner's",
  "estimate without executing the query. **It bypasses the selectable-fields",
  "whitelist by design** — selectable-fields is a row-data redaction ACL,",
  "not a schema-discovery ACL. The DB role is the actual ACL boundary: any",
  "table the role can SELECT, this op can EXPLAIN. Operators must restrict",
  "the role to tables that may be revealed.",
  "",
  "Fields marked `pii: true` come back as `\"[REDACTED]\"` (null stays null).",
].join("\n");

export interface CreateDatabaseToolsConfig {
  /** Layer 2: PII / access-control whitelist (hand-edited). */
  selectableFields: SelectableFieldsMap;
  /** Layer 1: structural metadata (auto-generatable). Provides PKs, types, indexes, FKs. */
  tableMetadata: TableMetadataMap;
  /** Lazy DataSource factory. Invoked on each execute call (adapter caches its own connection). */
  getDataSource: () => Promise<DataSource>;
  /** Override tool prefix (default: "db"). Produces "<prefix>_describe" / "<prefix>_execute". */
  toolPrefix?: string;
  describeDescription?: string;
  executeDescription?: string;
  preamble?: string;
}

/**
 * Build the relational-database describe/execute tool pair.
 *
 * - `<prefix>_describe`: lists/details available operations.
 * - `<prefix>_execute`: runs an operation by id with `{ operation, params }`.
 *
 * The DataSource adapter (mcp-shared-db-postgres / mcp-shared-db-mongo / ...)
 * is engine-specific and is supplied by the caller. The operation layer
 * never sees engine internals.
 */
export function createDatabaseTools(config: CreateDatabaseToolsConfig): ToolHandler[] {
  const [describe, execute] = createDescribeExecuteHandlers({
    prefix: config.toolPrefix ?? "db",
    registry: databaseRegistry,
    listTitle: "Database Operations",
    preamble: config.preamble ?? DEFAULT_PREAMBLE,
    ...(config.describeDescription && { describeDescription: config.describeDescription }),
    ...(config.executeDescription && { executeDescription: config.executeDescription }),
    buildContext: async () => ({
      dataSource: await config.getDataSource(),
      selectableFields: config.selectableFields,
      tableMetadata: config.tableMetadata,
    }),
  });
  return [describe, execute];
}
