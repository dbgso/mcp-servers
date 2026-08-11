/**
 * PostgreSQL introspector backed by `pg_catalog` / `information_schema`.
 *
 * The class is constructed with a duck-typed `PgQueryClient` so tests can
 * inject a fake. The default factory `createPgClient(url)` lazy-imports
 * `pg` and wires up a real `pg.Client` — keeping `pg` out of the import
 * graph for callers that only use the format / heuristics modules.
 */
import type {
  IntrospectTableInput,
  Introspector,
  RawColumn,
  RawForeignKey,
  RawIndex,
  RawTableMetadata,
  TableInfo,
} from "./types.js";
import { mapPostgresType } from "./postgres-types.js";

export interface PgQueryResultRow {
  [column: string]: unknown;
}

export interface PgQueryResult<T extends PgQueryResultRow = PgQueryResultRow> {
  rows: T[];
}

/** Minimal subset of `pg.Client` we depend on. Easy to mock in tests. */
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

type SchemaRow = PgQueryResultRow & {
  schema_name: string;
};

type TableRow = PgQueryResultRow & {
  name: string;
  description: string | null;
  row_count: string | number | null;
};

type ColumnRow = PgQueryResultRow & {
  name: string;
  data_type: string;
  udt_name: string | null;
  char_max_length: number | null;
  is_nullable: string;
  column_default: string | null;
  description: string | null;
};

type PrimaryKeyRow = PgQueryResultRow & {
  column_name: string;
};

type IndexRow = PgQueryResultRow & {
  index_name: string;
  column_name: string;
  is_unique: boolean;
};

type ForeignKeyRow = PgQueryResultRow & {
  field: string;
  ref_schema: string;
  ref_table: string;
  ref_field: string;
};

/**
 * Parse `pg_class.reltuples` into a number, treating null/undefined as
 * "unknown row count" and returning `undefined`.
 */
function toRowCount(value: string | number | null): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return undefined;
  // Postgres returns -1 for never-analysed tables; treat that as unknown.
  if (n < 0) return undefined;
  return n;
}

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

function groupIndexRows(rows: IndexRow[]): RawIndex[] {
  const byName = new Map<string, RawIndex>();
  for (const r of rows) {
    let idx = byName.get(r.index_name);
    if (!idx) {
      idx = { name: r.index_name, fields: [], isUnique: r.is_unique };
      byName.set(r.index_name, idx);
    }
    idx.fields.push(r.column_name);
  }
  return [...byName.values()];
}

export class PostgresIntrospector implements Introspector {
  private connected = false;

  constructor(private readonly client: PgQueryClient) {}

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    await this.client.connect();
    this.connected = true;
  }

  async listSchemas(): Promise<string[]> {
    await this.ensureConnected();
    const result = await this.client.query<SchemaRow>(POSTGRES_QUERIES.schemas);
    return result.rows.map((r) => r.schema_name);
  }

  async listTables(schema: string): Promise<TableInfo[]> {
    await this.ensureConnected();
    const result = await this.client.query<TableRow>(POSTGRES_QUERIES.tables, [schema]);
    return result.rows.map((r) => {
      const info: TableInfo = { schema, name: r.name };
      if (r.description !== null && r.description !== undefined) {
        info.description = r.description;
      }
      const rowCount = toRowCount(r.row_count);
      if (rowCount !== undefined) info.rowCount = rowCount;
      return info;
    });
  }

  async introspectTable(input: IntrospectTableInput): Promise<RawTableMetadata> {
    const { schema, table } = input;
    await this.ensureConnected();
    // Run the per-table queries sequentially. A single `pg.Client` cannot
    // serve concurrent queries (pg@9 will reject this outright), and the
    // round-trip cost is dominated by the SSH tunnel anyway. Callers that
    // want concurrency across *tables* should construct a Pool-backed
    // introspector — out of scope for now.
    const tablesResult = await this.client.query<TableRow>(POSTGRES_QUERIES.tables, [schema]);
    const columnsResult = await this.client.query<ColumnRow>(POSTGRES_QUERIES.columns, [schema, table]);
    const pkResult = await this.client.query<PrimaryKeyRow>(POSTGRES_QUERIES.primaryKey, [schema, table]);
    const indexResult = await this.client.query<IndexRow>(POSTGRES_QUERIES.indexes, [schema, table]);
    const fkResult = await this.client.query<ForeignKeyRow>(POSTGRES_QUERIES.foreignKeys, [schema, table]);

    const tableInfo = tablesResult.rows.find((r) => r.name === table);
    const columns = columnsResult.rows.map(rowToColumn);
    const primaryKey = pkResult.rows.map((r) => r.column_name);
    const indexes = groupIndexRows(indexResult.rows);
    const foreignKeys: RawForeignKey[] = fkResult.rows.map((r) => ({
      field: r.field,
      referencedSchema: r.ref_schema,
      referencedTable: r.ref_table,
      referencedField: r.ref_field,
    }));

    const meta: RawTableMetadata = {
      schema,
      name: table,
      primaryKey,
      columns,
      indexes,
      foreignKeys,
    };
    if (tableInfo?.description) meta.description = tableInfo.description;
    return meta;
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await this.client.end();
    this.connected = false;
  }
}

interface PgClientCtor {
  new (cfg: { connectionString: string }): PgQueryClient;
}

interface PgModule {
  Client?: PgClientCtor;
  default?: { Client?: PgClientCtor };
}

/**
 * Lazy factory that builds a real `pg.Client` from a connection URL.
 *
 * We import `pg` dynamically so packages that only consume formatting /
 * heuristics utilities don't pay for the `pg` import. ESM interop quirk:
 * `pg` exposes its constructors via the default export, hence the
 * `(mod.default ?? mod)` shape.
 */
export async function createPgClient(url: string): Promise<PgQueryClient> {
  // Cast through unknown — pg ships without bundled types and we don't want
  // to force callers to install @types/pg just to use the introspector.
  const mod = (await import("pg" as string)) as unknown as PgModule;
  const ctor = mod.default?.Client ?? mod.Client;
  if (!ctor) {
    throw new Error("pg.Client is not available — is the 'pg' package installed?");
  }
  return new ctor({ connectionString: url });
}
