/**
 * RDB-flavoured structural metadata. Extends the generic shape from
 * `metadata.ts` with relational extras (indexes, foreign keys).
 *
 * Lives in `mcp-shared-db-core` (not in adapter packages) because these types
 * are pure structural descriptions and have no engine dependency.
 */
import type {
  GenericFieldType,
  GenericFieldMetadata,
  GenericTableMetadata,
} from "./metadata.js";

export type RelationalFieldType = GenericFieldType;
export type FieldMetadata = GenericFieldMetadata;

export interface IndexMetadata {
  name: string;
  fields: string[];
  isUnique: boolean;
}

export interface ForeignKeyMetadata {
  fieldName: string;
  referencedTable: string;
  referencedField: string;
}

export interface RdbTableMetadata<TFieldName extends string = string>
  extends GenericTableMetadata<TFieldName> {
  indexes?: IndexMetadata[];
  foreignKeys?: ForeignKeyMetadata[];
}

export type RdbTableMetadataMap = Record<string, RdbTableMetadata>;
