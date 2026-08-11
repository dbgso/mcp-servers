/**
 * DuckDB helpers -- `mcp-shared/duckdb`.
 *
 * Kept off the root barrel because it is the one entry that reaches
 * `@duckdb/node-api`, whose per-platform `.node` binaries a bundler cannot
 * resolve for platforms it does not ship. Importing this subpath is a package
 * declaring that it actually wants that dependency.
 */
export {
  countByField,
  queryRecords,
  queryFile,
  describeFile,
  sanitizeDuckDBError,
  getReadFunction,
} from "./utils/duckdb.js";

export type { CountByFieldResult, ReadOptions, FileAlias, ColumnInfo } from "./utils/duckdb.js";
