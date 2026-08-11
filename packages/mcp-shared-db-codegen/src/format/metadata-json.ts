/**
 * Format `RawTableMetadata[]` into a pretty-printed JSON string consumable by
 * `db-read-mcp` as a `metadata.json` file.
 *
 * Why JSON instead of a TS module:
 *   - Distributed binaries are launched with plain `node`, which can't load
 *     `.ts` files. JSON is universal.
 *   - The native DB type (e.g. `varchar(255)`) is preserved on every field via
 *     `nativeType` so a reviewer can sanity-check the GenericFieldType mapping
 *     without re-querying the catalog.
 *
 * Pure function — no I/O, no judgement. The shape mirrors `RdbTableMetadataMap`
 * with `nativeType` added on every field.
 */
import type { RawTableMetadata, RawColumn } from "../introspect/types.js";

interface JsonField {
  type: RawColumn["type"];
  nullable: boolean;
  /** Native DB type kept alongside the generic mapping for human review. */
  nativeType: string;
  description?: string;
}

interface JsonIndex {
  name: string;
  fields: string[];
  isUnique: boolean;
}

interface JsonForeignKey {
  fieldName: string;
  referencedTable: string;
  referencedField: string;
}

interface JsonTable {
  tableName: string;
  description?: string;
  primaryKey: string[];
  fields: Record<string, JsonField>;
  indexes?: JsonIndex[];
  foreignKeys?: JsonForeignKey[];
}

function toJsonField(column: RawColumn): JsonField {
  const out: JsonField = {
    type: column.type,
    nullable: column.nullable,
    nativeType: column.nativeType,
  };
  if (column.description) out.description = column.description;
  return out;
}

function toJsonTable(table: RawTableMetadata): JsonTable {
  const fields: Record<string, JsonField> = {};
  for (const c of table.columns) fields[c.name] = toJsonField(c);
  const out: JsonTable = {
    tableName: table.name,
    primaryKey: table.primaryKey,
    fields,
  };
  if (table.description) out.description = table.description;
  if (table.indexes.length > 0) {
    out.indexes = table.indexes.map((i) => ({
      name: i.name,
      fields: i.fields,
      isUnique: i.isUnique,
    }));
  }
  if (table.foreignKeys.length > 0) {
    out.foreignKeys = table.foreignKeys.map((fk) => ({
      fieldName: fk.field,
      referencedTable: fk.referencedTable,
      referencedField: fk.referencedField,
    }));
  }
  return out;
}

/**
 * Build a pretty-printed JSON document keyed by table name.
 *
 * Trailing newline is included so the file ends cleanly when written to disk.
 */
export function formatMetadataJson(tables: RawTableMetadata[]): string {
  const out: Record<string, JsonTable> = {};
  for (const t of tables) out[t.name] = toJsonTable(t);
  return `${JSON.stringify(out, null, 2)}\n`;
}
