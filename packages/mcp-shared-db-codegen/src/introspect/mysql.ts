/**
 * MySQL introspector backed by `information_schema`.
 *
 * The class is constructed with a duck-typed `MysqlQueryClient` so tests can
 * inject a fake. The default factory `createMysqlClient(url)` lazy-imports
 * `mysql2/promise` and wires up a real connection — keeping `mysql2` out of
 * the import graph for callers that only use the format / heuristics
 * modules.
 *
 * NOTE: `information_schema.tables.table_rows` is a **statistics-sampled
 * approximation**, not an exact count. InnoDB can return values off by 30%+
 * for million-row tables. Use it for descriptive output only, not for
 * runtime cost-control decisions.
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
import { mapMysqlType } from "./mysql-types.js";

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
 * Minimal subset of mysql2's `Connection` we depend on. Easy to mock in
 * tests. Args-object `query({ text, values })` matches the runtime shape
 * in `mcp-shared-db-mysql` and keeps the implementation single-param.
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

type SchemaRow = MysqlQueryResultRow & { schema_name: string };

type TableRow = MysqlQueryResultRow & {
  name: string;
  description: string | null;
  row_count: number | string | null;
};

type ColumnRow = MysqlQueryResultRow & {
  name: string;
  data_type: string;
  column_type: string;
  char_max_length: number | null;
  is_nullable: string;
  column_default: string | null;
  description: string | null;
};

type PrimaryKeyRow = MysqlQueryResultRow & {
  column_name: string;
};

type IndexRow = MysqlQueryResultRow & {
  index_name: string;
  column_name: string;
  // `(non_unique = 0)` returns 0/1 from MySQL; the driver may surface that as
  // a number or boolean depending on driver flags.
  is_unique: boolean | number;
};

type ForeignKeyRow = MysqlQueryResultRow & {
  field: string;
  ref_schema: string;
  ref_table: string;
  ref_field: string;
};

function toRowCount(value: number | string | null): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return undefined;
  if (n < 0) return undefined;
  return n;
}

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
  if (row.description !== null && row.description !== "") {
    column.description = row.description;
  }
  return column;
}

function groupIndexRows(rows: IndexRow[]): RawIndex[] {
  const byName = new Map<string, RawIndex>();
  for (const r of rows) {
    let idx = byName.get(r.index_name);
    if (!idx) {
      idx = {
        name: r.index_name,
        fields: [],
        // MySQL returns `non_unique` as 0/1; boolean coercion handles either
        // a Number or a Boolean coming from the driver.
        isUnique: Boolean(r.is_unique),
      };
      byName.set(r.index_name, idx);
    }
    idx.fields.push(r.column_name);
  }
  return [...byName.values()];
}

export class MysqlIntrospector implements Introspector {
  private connected = false;

  constructor(private readonly client: MysqlQueryClient) {}

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    await this.client.connect();
    this.connected = true;
  }

  async listSchemas(): Promise<string[]> {
    await this.ensureConnected();
    const result = await this.client.query<SchemaRow>({
      text: MYSQL_QUERIES.schemas,
    });
    return result.rows.map((r) => r.schema_name);
  }

  async listTables(schema: string): Promise<TableInfo[]> {
    await this.ensureConnected();
    const result = await this.client.query<TableRow>({
      text: MYSQL_QUERIES.tables,
      values: [schema],
    });
    return result.rows.map((r) => {
      const info: TableInfo = { schema, name: r.name };
      if (r.description !== null && r.description !== "") {
        info.description = r.description;
      }
      const rowCount = toRowCount(r.row_count);
      if (rowCount !== undefined) info.rowCount = rowCount;
      return info;
    });
  }

  async introspectTable(
    input: IntrospectTableInput,
  ): Promise<RawTableMetadata> {
    const { schema, table } = input;
    await this.ensureConnected();
    // Sequential round-trips — same rationale as the PG introspector: a
    // single mysql2 connection cannot serve concurrent queries, and
    // round-trip cost is dominated by the SSH tunnel anyway.
    const tablesResult = await this.client.query<TableRow>({
      text: MYSQL_QUERIES.tables,
      values: [schema],
    });
    const columnsResult = await this.client.query<ColumnRow>({
      text: MYSQL_QUERIES.columns,
      values: [schema, table],
    });
    const pkResult = await this.client.query<PrimaryKeyRow>({
      text: MYSQL_QUERIES.primaryKey,
      values: [schema, table],
    });
    const indexResult = await this.client.query<IndexRow>({
      text: MYSQL_QUERIES.indexes,
      values: [schema, table],
    });
    const fkResult = await this.client.query<ForeignKeyRow>({
      text: MYSQL_QUERIES.foreignKeys,
      values: [schema, table],
    });

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

/**
 * Decode a URL component, falling back to the raw value on invalid
 * percent-encoding so credentials with raw `%` / `&` / etc. don't break
 * connection setup.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

interface Mysql2Connection {
  query(text: string, values?: unknown[]): Promise<[unknown, unknown]>;
  end(): Promise<void>;
  // `on` is supported by the driver but the introspector never subscribes;
  // the runtime adapter (db-read-mcp) is the one that wires error handling.
}

interface Mysql2Module {
  createConnection?: (options: object) => Promise<Mysql2Connection>;
  default?: { createConnection?: (options: object) => Promise<Mysql2Connection> };
}

/**
 * Lazy factory that builds a real mysql2 connection from a URL.
 *
 * Forces `multipleStatements: false` regardless of URL hints — the codegen
 * path doesn't need multi-statement SQL and disabling it removes one source
 * of footgun if a future "convenience" PR adds raw-SQL emission.
 */
export async function createMysqlClient(url: string): Promise<MysqlQueryClient> {
  const parsed = new URL(url);
  const opts: Record<string, unknown> = { multipleStatements: false };
  if (parsed.hostname) opts.host = parsed.hostname;
  if (parsed.port) opts.port = Number(parsed.port);
  if (parsed.username) opts.user = safeDecode(parsed.username);
  if (parsed.password) opts.password = safeDecode(parsed.password);
  const pathDb = parsed.pathname.replace(/^\//, "");
  if (pathDb) opts.database = safeDecode(pathDb);
  if (parsed.searchParams.get("ssl") === "true") opts.ssl = {};

  const mod = (await import("mysql2/promise" as string)) as unknown as Mysql2Module;
  const create = mod.createConnection ?? mod.default?.createConnection;
  if (!create) {
    throw new Error(
      "mysql2/promise.createConnection is not available — is the 'mysql2' package installed?",
    );
  }
  const conn = await create(opts);
  return wrapConnectionForIntrospect(conn);
}

/**
 * Adapter: mysql2's `query()` returns `[rows, fields]`; this introspector's
 * `MysqlQueryClient` returns `{ rows }` so the fake-client fixture pattern
 * in tests stays uniform.
 */
export function wrapConnectionForIntrospect(
  conn: Mysql2Connection,
): MysqlQueryClient {
  return {
    async connect(): Promise<void> {
      // No-op — mysql2's createConnection already negotiated the handshake.
    },
    async query<T extends MysqlQueryResultRow = MysqlQueryResultRow>(
      args: MysqlQueryArgs,
    ): Promise<MysqlQueryResult<T>> {
      const [rows] = await conn.query(args.text, args.values ?? []);
      return { rows: Array.isArray(rows) ? (rows as T[]) : [] };
    },
    async end(): Promise<void> {
      await conn.end();
    },
  };
}
