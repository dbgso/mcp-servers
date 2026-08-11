/**
 * Convert `RawTableMetadata[]` from the introspector into the
 * `RdbTableMetadataMap` shape consumed by `mcp-shared-db-core`'s validator
 * and `db-read-mcp` at runtime.
 *
 * Preserves `nativeType` so the runtime validator can apply native-type-aware
 * heuristics (`pii: true` on `timestamp`/`enum`/`bool`/numeric FK is flagged
 * as a likely over-application). Re-keys foreign-key entries from the
 * introspector's `field` to the runtime `fieldName`. Pure function — no I/O.
 */
import type {
  GenericFieldMetadata,
  RdbTableMetadata,
  RdbTableMetadataMap,
} from "mcp-shared-db-core";
import type { RawColumn, RawTableMetadata } from "../introspect/types.js";

function toFieldMetadata(column: RawColumn): GenericFieldMetadata {
  const out: GenericFieldMetadata = {
    type: column.type,
    nullable: column.nullable,
  };
  if (column.description) out.description = column.description;
  if (column.default !== undefined) out.default = column.default;
  if (column.nativeType) out.nativeType = column.nativeType;
  return out;
}

function toRdbTable(table: RawTableMetadata): RdbTableMetadata {
  const fields: Record<string, GenericFieldMetadata> = {};
  for (const c of table.columns) fields[c.name] = toFieldMetadata(c);
  const out: RdbTableMetadata = {
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

export function toRdbMetadataMap(tables: RawTableMetadata[]): RdbTableMetadataMap {
  const out: RdbTableMetadataMap = {};
  for (const t of tables) out[t.name] = toRdbTable(t);
  return out;
}
