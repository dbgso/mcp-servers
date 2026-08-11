/**
 * Layer 1 — generic structural metadata about a table/collection.
 *
 * Auto-generatable. Pairs with Layer 2 (selectable-fields) which is the
 * hand-edited PII whitelist.
 *
 * RDB and DynamoDB extend this with their own structural details (e.g.
 * indexes, GSIs) but share the field-type contract and PK declaration.
 */

export type GenericFieldType = "string" | "number" | "boolean" | "datetime" | "json" | "binary";

export interface GenericFieldMetadata {
  type: GenericFieldType;
  nullable: boolean;
  default?: unknown;
  description?: string;
  /**
   * DB-native type string (e.g. `varchar(255)`, `enum('A','B')`, `tinyint(1)`).
   * Optional — preserved when loaded from `metadata.json` so the validator
   * can apply native-type-aware heuristics (e.g. flag `pii: true` on a
   * `timestamp` column as a likely over-application).
   */
  nativeType?: string;
}

export interface GenericTableMetadata<TFieldName extends string = string> {
  /** Logical (JS) table name. */
  tableName: string;
  /** Physical DB-side name when it differs from the logical name. */
  dbTableName?: string;
  description?: string;
  /** Primary-key field names (single or composite). */
  primaryKey: TFieldName[];
  fields: { [K in TFieldName]: GenericFieldMetadata };
}

export type GenericTableMetadataMap = Record<string, GenericTableMetadata>;
