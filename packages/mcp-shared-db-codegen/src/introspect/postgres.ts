/**
 * PostgreSQL introspector backed by `pg_catalog` / `information_schema`.
 *
 * The class is constructed with a duck-typed `PgQueryClient` so tests can
 * inject a fake. The default factory is `createPgClient(url)` from
 * `mcp-shared-db-postgres`, which lazy-imports `pg` and wires up a real
 * `pg.Client` — keeping `pg` out of the import graph for callers that only
 * use the format / heuristics modules.
 */
import type { RawColumn } from "./types.js";
import { mapPostgresType } from "./postgres-types.js";
import { CatalogIntrospector, type CatalogQuery } from "./catalog-introspector.js";

export { createPgClient } from "mcp-shared-db-postgres";

export interface PgQueryResultRow {
  [column: string]: unknown;
}

export interface PgQueryResult<T extends PgQueryResultRow = PgQueryResultRow> {
  rows: T[];
}

/**
 * Minimal subset of `pg.Client` we depend on. Easy to mock in tests; the
 * `mcp-shared-db-postgres` client satisfies it.
 */
export interface PgQueryClient {
  connect(): Promise<void>;
  query<T extends PgQueryResultRow = PgQueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<PgQueryResult<T>>;
  end(): Promise<void>;
}

export const POSTGRES_QUERIES = {
  schemas: `
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name NOT LIKE 'pg_%'
      AND schema_name <> 'information_schema'
    ORDER BY schema_name
  `,
  tables: `
    SELECT t.table_name AS name,
           obj_description(c.oid) AS description,
           c.reltuples::bigint AS row_count
    FROM information_schema.tables t
    JOIN pg_namespace n ON n.nspname = t.table_schema
    JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = n.oid
    WHERE t.table_schema = $1
      AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name
  `,
  columns: `
    SELECT c.column_name AS name,
           c.data_type AS data_type,
           c.udt_name AS udt_name,
           c.character_maximum_length AS char_max_length,
           c.is_nullable AS is_nullable,
           c.column_default AS column_default,
           col_description(
             (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass,
             c.ordinal_position
           ) AS description
    FROM information_schema.columns c
    WHERE c.table_schema = $1
      AND c.table_name = $2
    ORDER BY c.ordinal_position
  `,
  primaryKey: `
    SELECT a.attname AS column_name, array_position(i.indkey, a.attnum) AS pos
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid
     AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass
      AND i.indisprimary
    ORDER BY pos
  `,
  indexes: `
    SELECT i.relname AS index_name,
           a.attname AS column_name,
           ix.indisunique AS is_unique,
           array_position(ix.indkey, a.attnum) AS pos
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_attribute a
      ON a.attrelid = ix.indrelid
     AND a.attnum = ANY(ix.indkey)
    WHERE ix.indrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass
      AND NOT ix.indisprimary
    ORDER BY i.relname, pos
  `,
  foreignKeys: `
    SELECT kcu.column_name AS field,
           ccu.table_schema AS ref_schema,
           ccu.table_name AS ref_table,
           ccu.column_name AS ref_field
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = $1
      AND tc.table_name = $2
    ORDER BY kcu.ordinal_position
  `,
} as const;

type ColumnRow = PgQueryResultRow & {
  name: string;
  data_type: string;
  udt_name: string | null;
  char_max_length: number | null;
  is_nullable: string;
  column_default: string | null;
  description: string | null;
};

/**
 * Build the printable native type. `data_type` reads `character varying`
 * but `udt_name` reads `varchar`; we prefer the shorter `udt_name` and
 * append a length when present.
 */
export function formatNativeType(params: {
  dataType: string;
  udtName: string | null;
  charMaxLength: number | null;
}): string {
  const base = params.udtName ?? params.dataType;
  if (params.charMaxLength && /^(var)?char|bpchar|character/i.test(base)) {
    return `${base}(${params.charMaxLength})`;
  }
  return base;
}

function rowToColumn(row: ColumnRow): RawColumn {
  const nativeType = formatNativeType({
    dataType: row.data_type,
    udtName: row.udt_name,
    charMaxLength: row.char_max_length,
  });
  const column: RawColumn = {
    name: row.name,
    nativeType,
    type: mapPostgresType(nativeType),
    nullable: row.is_nullable === "YES",
  };
  if (row.column_default !== null) column.default = row.column_default;
  if (row.description !== null) column.description = row.description;
  return column;
}

export class PostgresIntrospector extends CatalogIntrospector<ColumnRow> {
  constructor(private readonly client: PgQueryClient) {
    super(client);
  }

  protected async query<T extends PgQueryResultRow>({ key, values }: CatalogQuery): Promise<T[]> {
    const result = await this.client.query<T>(POSTGRES_QUERIES[key], values);
    return result.rows;
  }

  protected toColumn(row: ColumnRow): RawColumn {
    return rowToColumn(row);
  }
}
