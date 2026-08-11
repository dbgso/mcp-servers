/**
 * Engine abstraction surface for parameterised SQL generation.
 *
 * `Dialect` describes everything the pure builder needs to know about the
 * target engine: how to quote identifiers, how to format placeholders, and
 * how to express a JSON-path equality. Engine packages
 * (`mcp-shared-db-postgres`, future `mcp-shared-db-mysql`, ...) implement
 * this interface; `mcp-shared-db-sql` itself stays free of any engine
 * dependency.
 */

/**
 * A normalised JSON path. The operations layer hands the builder a string
 * that always starts with `$`/`$.`; we expose both the raw form (for
 * dialects that take it verbatim, e.g. MySQL `JSON_EXTRACT(col, '$.foo')`)
 * and the segment list (for dialects that need a variadic / array argument,
 * e.g. Postgres `col #>> '{foo,bar}'`). An empty `segments` array means the
 * caller passed the root path (`$`).
 */
export interface JsonPathInput {
  /** Raw normalised path, e.g. `"$.foo.bar"` or `"$"`. */
  raw: string;
  /** Segments e.g. `["foo", "bar"]`. Empty array means root. */
  segments: string[];
}

/**
 * Parameter accumulator passed to dialect callbacks. Each `add()` returns the
 * placeholder string (e.g. `$3` or `?`) that the caller should embed in the
 * SQL fragment. The implementation owns the order of values in the final
 * binding array.
 */
export interface ParamBuilder {
  /** Append a value and return its placeholder string. */
  add(value: unknown): string;
}

/**
 * Normalised result of an EXPLAIN call. Matches `ExplainResult` in
 * `mcp-shared-db` — re-declared here only to keep the SQL package free of
 * a dependency on the operations layer's interfaces.
 */
export interface DialectExplainResult {
  estimatedRows: number | null;
  totalCost: number | null;
  planSummary: string;
  raw: unknown;
}

/**
 * Pure dialect interface. Implementations must be deterministic and free of
 * side effects so the builder layer stays trivially unit-testable.
 */
export interface Dialect {
  /** Quote an identifier (table / column name) safely for this engine. */
  quoteIdent(name: string): string;
  /**
   * Build a parameter placeholder for the given 1-based index. Postgres
   * returns `$N`; MySQL/SQLite return `?` and ignore the index.
   */
  placeholder(index: number): string;
  /**
   * Build a SQL fragment that compares the JSON value at `path` on the
   * already-quoted `columnSql` to `valuePlaceholder`. The dialect may call
   * `params.add(...)` to allocate further placeholders (e.g. Postgres pushes
   * the segments as a `text[]`).
   */
  jsonPathEquals(input: {
    /** Already-quoted column reference (output of `quoteIdent`). */
    columnSql: string;
    /** Normalised JSON path with helper segments. */
    path: JsonPathInput;
    /** Pre-allocated placeholder for the comparison value. */
    valuePlaceholder: string;
    /** Used to allocate further placeholders. */
    params: ParamBuilder;
  }): string;
  /**
   * SQL prefix that, when prepended to a `SELECT`, returns the planner's
   * cost estimate instead of executing the query for real. Engine-specific:
   *   - Postgres: `EXPLAIN (FORMAT JSON)`
   *   - MySQL:    `EXPLAIN FORMAT=JSON`
   *   - SQLite:   `EXPLAIN QUERY PLAN`
   * No trailing space — the SQL DataSource adds it.
   */
  explainPrefix(): string;
  /**
   * Parse the row(s) returned by `<explainPrefix> <select>` into a normalised
   * `DialectExplainResult`. Engines whose plan format does not surface a
   * value should set `estimatedRows` / `totalCost` to `null` rather than
   * making one up.
   */
  parseExplainResult(rows: unknown[]): DialectExplainResult;
}
