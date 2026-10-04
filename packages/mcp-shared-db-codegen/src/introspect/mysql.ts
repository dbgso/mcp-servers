/**
 * MySQL introspector backed by `information_schema`.
 *
 * The class is constructed with a duck-typed `MysqlQueryClient` so tests can
 * inject a fake. The default factory is `createMysqlClient(url)` from
 * `mcp-shared-db-mysql` -- the same connection setup db-read-mcp uses
 * (TLS from `?ssl=true` / `?ssl-mode=`, `multipleStatements` forced off). It
 * lazy-imports `mysql2/promise`, keeping `mysql2` out of the import graph for
 * callers that only use the format / heuristics modules.
 *
 * NOTE: `information_schema.tables.table_rows` is a **statistics-sampled
 * approximation**, not an exact count. InnoDB can return values off by 30%+
 * for million-row tables. Use it for descriptive output only, not for
 * runtime cost-control decisions.
 */
import type { RawColumn } from "./types.js";
import { mapMysqlType } from "./mysql-types.js";
import { CatalogIntrospector, type CatalogQuery } from "./catalog-introspector.js";

export { createMysqlClient } from "mcp-shared-db-mysql";

export interface MysqlQueryResultRow {
  [column: string]: unknown;
}

export interface MysqlQueryResult<T extends MysqlQueryResultRow = MysqlQueryResultRow> {
  rows: T[];
}

/** Args for {@link MysqlQueryClient.query}. */
export interface MysqlQueryArgs {
  text: string;
  values?: unknown[];
}

/**
 * Minimal subset of the `mcp-shared-db-mysql` client we depend on. Easy to
 * mock in tests; the shared client satisfies it.
 */
export interface MysqlQueryClient {
  connect(): Promise<void>;
  query<T extends MysqlQueryResultRow = MysqlQueryResultRow>(
    args: MysqlQueryArgs,
  ): Promise<MysqlQueryResult<T>>;
  end(): Promise<void>;
}

export const MYSQL_QUERIES = {
  schemas: `
    SELECT schema_name AS schema_name
    FROM information_schema.schemata
    WHERE schema_name NOT IN ('mysql','sys','performance_schema','information_schema')
    ORDER BY schema_name
  `,
  tables: `
    SELECT table_name AS name,
           table_comment AS description,
           table_rows AS row_count
    FROM information_schema.tables
    WHERE table_schema = ?
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `,
  columns: `
    SELECT column_name AS name,
           data_type AS data_type,
           column_type AS column_type,
           character_maximum_length AS char_max_length,
           is_nullable AS is_nullable,
           column_default AS column_default,
           column_comment AS description
    FROM information_schema.columns
    WHERE table_schema = ?
      AND table_name = ?
    ORDER BY ordinal_position
  `,
  primaryKey: `
    SELECT column_name AS column_name
    FROM information_schema.key_column_usage
    WHERE table_schema = ?
      AND table_name = ?
      AND constraint_name = 'PRIMARY'
    ORDER BY ordinal_position
  `,
  indexes: `
    SELECT index_name AS index_name,
           column_name AS column_name,
           (non_unique = 0) AS is_unique,
           seq_in_index AS pos
    FROM information_schema.statistics
    WHERE table_schema = ?
      AND table_name = ?
      AND index_name <> 'PRIMARY'
    ORDER BY index_name, seq_in_index
  `,
  foreignKeys: `
    SELECT kcu.column_name AS field,
           kcu.referenced_table_schema AS ref_schema,
           kcu.referenced_table_name AS ref_table,
           kcu.referenced_column_name AS ref_field
    FROM information_schema.key_column_usage kcu
    WHERE kcu.table_schema = ?
      AND kcu.table_name = ?
      AND kcu.referenced_table_name IS NOT NULL
    ORDER BY kcu.ordinal_position
  `,
} as const;

type ColumnRow = MysqlQueryResultRow & {
  name: string;
  data_type: string;
  column_type: string;
  char_max_length: number | null;
  is_nullable: string;
  column_default: string | null;
  description: string | null;
};

function rowToColumn(row: ColumnRow): RawColumn {
  // `column_type` carries the precision suffix (e.g. `tinyint(1)`) we need
  // to disambiguate boolean-by-convention from a small int. `data_type`
  // alone strips that out.
  const nativeType = row.column_type ?? row.data_type;
  const column: RawColumn = {
    name: row.name,
    nativeType,
    type: mapMysqlType(nativeType),
    nullable: row.is_nullable === "YES",
  };
  if (row.column_default !== null) column.default = row.column_default;
  // MySQL reports a column without a comment as "".
  if (row.description !== null && row.description !== "") {
    column.description = row.description;
  }
  return column;
}

export class MysqlIntrospector extends CatalogIntrospector<ColumnRow> {
  constructor(private readonly client: MysqlQueryClient) {
    super(client);
  }

  protected async query<T extends MysqlQueryResultRow>({ key, values }: CatalogQuery): Promise<T[]> {
    const result = await this.client.query<T>({ text: MYSQL_QUERIES[key], values });
    return result.rows;
  }

  protected toColumn(row: ColumnRow): RawColumn {
    return rowToColumn(row);
  }
}
