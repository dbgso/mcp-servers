/**
 * Generic SQL-backed `DataSource` factory. Engine packages wrap this with a
 * `query` callback (e.g. `pg.Client.query`) plus their own `Dialect`.
 *
 * Tables / columns are not whitelisted here — the operations layer does that
 * before invoking us. We only enforce structural pre-conditions that the
 * SQL layer relies on (e.g. single-column primary keys for `findByPk`).
 */
import type {
  DataSource,
  ExplainResult,
  FindByEqInput,
  FindByJsonPathInput,
  FindByPkInput,
  FindByRangeInput,
} from "mcp-shared-db";
import type { RdbTableMetadataMap } from "mcp-shared-db-core";
import {
  buildFindByEq,
  buildFindByJsonPath,
  buildFindByPk,
  buildFindByRange,
} from "./builder.js";
import type { Dialect } from "./dialect.js";

/** Args for {@link QueryFn}. */
export interface QueryFnArgs {
  sql: string;
  values: unknown[];
}

/**
 * Generic query callback the engine adapter supplies. Must return rows
 * keyed by JS field name (i.e. column alias). Connectivity / driver errors
 * should propagate.
 *
 * **Multi-statement input must be rejected at the wire**, before the
 * server executes any of it. `explain_sql` (and any future raw-SQL op)
 * accepts caller-supplied strings, and any engine that quietly executes
 * `SELECT 1; SELECT 2` exposes a side-effecting injection vector even
 * when our session is `default_transaction_read_only = on` (a malicious
 * second statement could `SET` the GUC off mid-batch). Adapters must
 * therefore force a single-statement protocol path:
 *   - pg-postgres: pass `queryMode: 'extended'` to `client.query` so
 *     pg-node always uses Parse + Bind + Execute (PG's Parse rejects
 *     multi-statement). Requires `pg >= 8.11`.
 *   - MySQL2: keep connection option `multipleStatements` at the default
 *     (`false`); do not enable it.
 *   - better-sqlite3: only one statement per `prepare()` by design — no
 *     extra config needed.
 * Implementations may keep a post-hoc detection (e.g. checking the
 * driver's response shape) as a tripwire, but the load-bearing defence
 * is the wire-level reject above.
 */
export type QueryFn = (
  args: QueryFnArgs,
) => Promise<{ rows: Record<string, unknown>[] }>;

export interface CreateSqlDataSourceConfig {
  query: QueryFn;
  dialect: Dialect;
  tableMetadata: RdbTableMetadataMap;
}

function requireMetadata(params: {
  config: CreateSqlDataSourceConfig;
  table: string;
}): RdbTableMetadataMap[string] {
  const { config, table } = params;
  const meta = config.tableMetadata[table];
  // Adapter must know every table the operation layer dispatches to it.
  if (!meta) throw new Error(`No metadata for table '${table}'`);
  return meta;
}

function requireSinglePk(params: {
  meta: RdbTableMetadataMap[string];
  table: string;
}): string {
  const { meta, table } = params;
  // Composite PKs aren't expressible through the `findByPk` shape
  // (operations layer rejects them up-front; this is defense-in-depth).
  const [pk] = meta.primaryKey;
  if (meta.primaryKey.length !== 1 || !pk) {
    throw new Error(
      `Table '${table}' must have a single-column primary key (got ${meta.primaryKey.length})`,
    );
  }
  return pk;
}

/**
 * Pick the physical table name to use in SQL. `dbTableName` lets the
 * metadata expose a logical key that differs from the on-disk identifier
 * (e.g. snake_case in Postgres mapped to camelCase in TypeScript). Falls
 * back to the logical table key when not set.
 */
function physicalTable(params: {
  meta: RdbTableMetadataMap[string];
  logical: string;
}): string {
  const { meta, logical } = params;
  return meta.dbTableName ?? logical;
}

export function createSqlDataSource(config: CreateSqlDataSourceConfig): DataSource {
  return {
    async findByPk(input: FindByPkInput) {
      const meta = requireMetadata({ config, table: input.table });
      const pkColumn = requireSinglePk({ meta, table: input.table });
      const built = buildFindByPk({
        dialect: config.dialect,
        table: physicalTable({ meta, logical: input.table }),
        pkColumn,
        pk: input.pk,
        columns: input.columns,
      });
      const r = await config.query({ sql: built.sql, values: built.values });
      return r.rows[0] ?? null;
    },

    async findByEq(input: FindByEqInput) {
      const meta = requireMetadata({ config, table: input.table });
      const built = buildFindByEq({
        dialect: config.dialect,
        table: physicalTable({ meta, logical: input.table }),
        field: input.field,
        value: input.value,
        columns: input.columns,
        limit: input.limit,
      });
      const r = await config.query({ sql: built.sql, values: built.values });
      return r.rows;
    },

    async findByRange(input: FindByRangeInput) {
      const meta = requireMetadata({ config, table: input.table });
      const built = buildFindByRange({
        dialect: config.dialect,
        table: physicalTable({ meta, logical: input.table }),
        field: input.field,
        from: input.from,
        to: input.to,
        columns: input.columns,
        limit: input.limit,
      });
      const r = await config.query({ sql: built.sql, values: built.values });
      return r.rows;
    },

    async findByJsonPath(input: FindByJsonPathInput) {
      const meta = requireMetadata({ config, table: input.table });
      const built = buildFindByJsonPath({
        dialect: config.dialect,
        table: physicalTable({ meta, logical: input.table }),
        field: input.field,
        path: input.path,
        value: input.value,
        columns: input.columns,
        limit: input.limit,
      });
      const r = await config.query({ sql: built.sql, values: built.values });
      return r.rows;
    },

    async explainFindByRange(input: FindByRangeInput): Promise<ExplainResult> {
      const meta = requireMetadata({ config, table: input.table });
      // Re-use the exact same SELECT the read path would issue. The dialect
      // wraps it with engine-specific EXPLAIN syntax; the parser normalises
      // each engine's plan format into a shared shape.
      const built = buildFindByRange({
        dialect: config.dialect,
        table: physicalTable({ meta, logical: input.table }),
        field: input.field,
        from: input.from,
        to: input.to,
        columns: input.columns,
        limit: input.limit,
      });
      const explainSql = `${config.dialect.explainPrefix()} ${built.sql}`;
      const r = await config.query({ sql: explainSql, values: built.values });
      return config.dialect.parseExplainResult(r.rows);
    },

    async explainSql(args: { sql: string; params: unknown[] }): Promise<ExplainResult> {
      // Wrap the caller's SQL with the engine's EXPLAIN prefix. The query
      // never executes for real (no ANALYZE), and going through `query(sql,
      // values)` forces extended protocol — multi-statement injection
      // (`...; DROP TABLE`) is blocked at the wire by the driver.
      const wrapped = `${config.dialect.explainPrefix()} ${args.sql}`;
      const r = await config.query({ sql: wrapped, values: args.params });
      return config.dialect.parseExplainResult(r.rows);
    },
  };
}
