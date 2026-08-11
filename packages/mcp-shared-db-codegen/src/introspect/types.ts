/**
 * Engine-agnostic introspector types.
 *
 * `RawTableMetadata` is the shape returned by an `Introspector` after reading
 * a DB's catalog tables. It lines up with `RdbTableMetadata` from
 * `mcp-shared-db-core` but keeps a few extras that codegen needs:
 *
 * - `RawColumn` carries `nativeType` (e.g. `varchar(255)`, `jsonb`) so the
 *   output `metadata.ts` can preserve it as a comment for human review, and
 *   still maps to the engine-agnostic `GenericFieldType`.
 * - `RawTableMetadata` always includes `indexes` / `foreignKeys` arrays
 *   (possibly empty) so format functions don't need to guard for `undefined`.
 */
import type { GenericFieldType } from "mcp-shared-db-core";

export interface TableInfo {
  schema: string;
  name: string;
  description?: string;
  /** Approximate row count (Postgres: `pg_class.reltuples`). */
  rowCount?: number;
}

export interface RawColumn {
  name: string;
  /** Native DB type (e.g. `varchar(255)`, `jsonb`). */
  nativeType: string;
  /** Mapped to GenericFieldType. */
  type: GenericFieldType;
  nullable: boolean;
  default?: unknown;
  description?: string;
}

export interface RawIndex {
  name: string;
  fields: string[];
  isUnique: boolean;
}

export interface RawForeignKey {
  field: string;
  referencedSchema: string;
  referencedTable: string;
  referencedField: string;
}

export interface RawTableMetadata {
  schema: string;
  name: string;
  description?: string;
  primaryKey: string[];
  columns: RawColumn[];
  indexes: RawIndex[];
  foreignKeys: RawForeignKey[];
}

export interface IntrospectTableInput {
  schema: string;
  table: string;
}

export interface Introspector {
  listSchemas(): Promise<string[]>;
  listTables(schema: string): Promise<TableInfo[]>;
  introspectTable(input: IntrospectTableInput): Promise<RawTableMetadata>;
  close(): Promise<void>;
}
