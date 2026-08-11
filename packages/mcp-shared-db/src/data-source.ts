/**
 * Engine-agnostic data access surface used by the operation layer.
 *
 * Adapter packages (mcp-shared-db-postgres, future mcp-shared-db-mysql, ...)
 * implement this interface, typically by composing
 * `mcp-shared-db-sql/createSqlDataSource` with an engine-specific dialect.
 * The operation layer never reaches into engine-specific clients — it only
 * validates, projects whitelisted columns, then delegates.
 *
 * Implementations are expected to:
 *   - return rows as `Record<string, unknown>` keyed by JS field name
 *     (the same names used in selectableFields / tableMetadata)
 *   - return only the fields named in `columns` (server-side projection
 *     when possible — defense-in-depth, not security)
 *   - throw on connectivity errors; ops will surface them
 */

export interface FindByPkInput {
  table: string;
  pk: unknown;
  columns: string[];
}

export interface FindByEqInput {
  table: string;
  field: string;
  value: unknown;
  columns: string[];
  limit: number;
}

export interface FindByRangeInput {
  table: string;
  field: string;
  from: Date;
  to: Date;
  columns: string[];
  limit: number;
}

export interface FindByJsonPathInput {
  table: string;
  field: string;
  /** Always normalized to start with "$." (operations layer normalizes). */
  path: string;
  value: unknown;
  columns: string[];
  limit: number;
}

/**
 * Normalised result of `EXPLAIN`-style cost queries. Each adapter parses its
 * native plan format (Postgres JSON, MySQL JSON, SQLite rows) into this shape.
 *
 * `estimatedRows` and `totalCost` may be `null` when the engine doesn't
 * surface them without an analyze pass (notably SQLite via `EXPLAIN QUERY PLAN`).
 */
export interface ExplainResult {
  /** Planner's row-count estimate for the query. */
  estimatedRows: number | null;
  /** Engine-specific cost number; relative within an engine, not portable. */
  totalCost: number | null;
  /** One-line summary of the leading scan node, for human reading. */
  planSummary: string;
  /** Raw native plan, kept for diagnostics. Engine-specific shape. */
  raw: unknown;
}

export interface DataSource {
  findByPk(input: FindByPkInput): Promise<Record<string, unknown> | null>;
  findByEq(input: FindByEqInput): Promise<Record<string, unknown>[]>;
  findByRange(input: FindByRangeInput): Promise<Record<string, unknown>[]>;
  findByJsonPath(input: FindByJsonPathInput): Promise<Record<string, unknown>[]>;
  /**
   * Cost-only preview of `findByRange`. Used by the read MCP's
   * `get_by_date_range` auto-EXPLAIN guard so the op can size-check before
   * paying for the actual scan — `LIMIT` only caps result rows, not scan width.
   */
  explainFindByRange(input: FindByRangeInput): Promise<ExplainResult>;
  /**
   * Run `EXPLAIN` on an arbitrary caller-supplied SQL string. The query is
   * planned but never executed (no ANALYZE). **Bypasses the selectableFields
   * whitelist by design** — surface for the `explain_sql` op which is meant
   * for ad-hoc cost sizing. DB-role permissions are the actual ACL boundary.
   *
   * `params` are bound to the SQL via the driver's parameterised path
   * (extended protocol) so multi-statement injection (`...; DROP TABLE`) is
   * blocked at the wire.
   *
   * Implementations for engines without a query planner (e.g. document
   * stores) should throw `Error('EXPLAIN not supported by this engine')`.
   */
  explainSql(args: { sql: string; params: unknown[] }): Promise<ExplainResult>;
}
