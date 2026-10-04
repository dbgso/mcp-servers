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

/** `RdbTableMetadata` with a caller-chosen field shape. */
export type TableMetadataWithFields<F> = Omit<RdbTableMetadata, "fields"> & {
  fields: Record<string, F>;
};

/**
 * Build one table entry from introspected metadata. The table part is the
 * same for every output; `toField` decides what each field looks like
 * (`metadata.json` keeps `nativeType` on every field, the runtime map keeps
 * `default` too).
 */
export function buildTableMetadata<F>(params: {
  table: RawTableMetadata;
  toField: (column: RawColumn) => F;
}): TableMetadataWithFields<F> {
  const { table, toField } = params;
  const fields: Record<string, F> = {};
  for (const c of table.columns) fields[c.name] = toField(c);
  const out: TableMetadataWithFields<F> = {
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
  for (const t of tables) {
    out[t.name] = buildTableMetadata({ table: t, toField: toFieldMetadata });
  }
  return out;
}
