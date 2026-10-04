/**
 * What the MySQL and Postgres introspectors share.
 *
 * Both read the same six catalog queries (keyed alike in `MYSQL_QUERIES` /
 * `POSTGRES_QUERIES`), get rows back under the same column aliases, and
 * assemble them into `TableInfo` / `RawTableMetadata` the same way. They
 * differ only in how a query is sent to the driver and in how a column row
 * becomes a `RawColumn` -- those are the two abstract members below.
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

/** Row as returned by the drivers: column alias -> value. */
export interface CatalogRow {
  [column: string]: unknown;
}

/** The catalog queries every engine provides, under these keys. */
export type CatalogQueryKey =
  | "schemas"
  | "tables"
  | "columns"
  | "primaryKey"
  | "indexes"
  | "foreignKeys";

/** One catalog query to run: which one, and its bind values. */
export interface CatalogQuery {
  key: CatalogQueryKey;
  values?: unknown[];
}

type SchemaRow = CatalogRow & { schema_name: string };

type TableRow = CatalogRow & {
  name: string;
  description: string | null;
  row_count: number | string | null;
};

type PrimaryKeyRow = CatalogRow & { column_name: string };

type IndexRow = CatalogRow & {
  index_name: string;
  column_name: string;
  // Postgres returns a boolean. MySQL's `(non_unique = 0)` returns 0/1, which
  // the driver may surface as a number or a boolean depending on its flags.
  is_unique: boolean | number;
};

type ForeignKeyRow = CatalogRow & {
  field: string;
  ref_schema: string;
  ref_table: string;
  ref_field: string;
};

/** The driver connection lifecycle the introspector manages. */
interface CatalogConnection {
  connect(): Promise<void>;
  end(): Promise<void>;
}

/**
 * Parse a catalog row-count estimate into a number. `null` and unparseable
 * values are unknown; so are negative ones (Postgres reports -1 for a table
 * that was never analysed).
 */
export function toRowCount(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return undefined;
  if (n < 0) return undefined;
  return n;
}

function toTableInfo(params: { schema: string; row: TableRow }): TableInfo {
  const { schema, row } = params;
  const info: TableInfo = { schema, name: row.name };
  // MySQL reports a table without a comment as "", Postgres as null.
  if (row.description) info.description = row.description;
  const rowCount = toRowCount(row.row_count);
  if (rowCount !== undefined) info.rowCount = rowCount;
  return info;
}

function groupIndexRows(rows: IndexRow[]): RawIndex[] {
  const byName = new Map<string, RawIndex>();
  for (const r of rows) {
    let idx = byName.get(r.index_name);
    if (!idx) {
      idx = { name: r.index_name, fields: [], isUnique: Boolean(r.is_unique) };
      byName.set(r.index_name, idx);
    }
    idx.fields.push(r.column_name);
  }
  return [...byName.values()];
}

function toForeignKey(row: ForeignKeyRow): RawForeignKey {
  return {
    field: row.field,
    referencedSchema: row.ref_schema,
    referencedTable: row.ref_table,
    referencedField: row.ref_field,
  };
}

export abstract class CatalogIntrospector<ColumnRow extends CatalogRow>
  implements Introspector
{
  private connected = false;

  constructor(private readonly connection: CatalogConnection) {}

  /** Run the engine's catalog query `key` and return its rows. */
  protected abstract query<T extends CatalogRow>(params: CatalogQuery): Promise<T[]>;

  /** Turn one row of the `columns` query into a `RawColumn`. */
  protected abstract toColumn(row: ColumnRow): RawColumn;

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    await this.connection.connect();
    this.connected = true;
  }

  async listSchemas(): Promise<string[]> {
    await this.ensureConnected();
    const rows = await this.query<SchemaRow>({ key: "schemas" });
    return rows.map((r) => r.schema_name);
  }

  async listTables(schema: string): Promise<TableInfo[]> {
    await this.ensureConnected();
    const rows = await this.query<TableRow>({ key: "tables", values: [schema] });
    return rows.map((row) => toTableInfo({ schema, row }));
  }

  async introspectTable(input: IntrospectTableInput): Promise<RawTableMetadata> {
    const { schema, table } = input;
    await this.ensureConnected();
    // Sequential round-trips: a single connection (pg.Client or mysql2) cannot
    // serve concurrent queries (pg@9 rejects it outright), and the round-trip
    // cost is dominated by the SSH tunnel anyway. Callers that want
    // concurrency across *tables* should construct a pool-backed
    // introspector — out of scope for now.
    const values = [schema, table];
    const tableRows = await this.query<TableRow>({ key: "tables", values: [schema] });
    const columnRows = await this.query<ColumnRow>({ key: "columns", values });
    const pkRows = await this.query<PrimaryKeyRow>({ key: "primaryKey", values });
    const indexRows = await this.query<IndexRow>({ key: "indexes", values });
    const fkRows = await this.query<ForeignKeyRow>({ key: "foreignKeys", values });

    const meta: RawTableMetadata = {
      schema,
      name: table,
      primaryKey: pkRows.map((r) => r.column_name),
      columns: columnRows.map((r) => this.toColumn(r)),
      indexes: groupIndexRows(indexRows),
      foreignKeys: fkRows.map(toForeignKey),
    };
    const description = tableRows.find((r) => r.name === table)?.description;
    if (description) meta.description = description;
    return meta;
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await this.connection.end();
    this.connected = false;
  }
}
