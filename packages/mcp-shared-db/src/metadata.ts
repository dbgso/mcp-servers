/**
 * RDB-specific structural metadata.
 *
 * The RDB metadata types live in `mcp-shared-db-core` (pure structural
 * shapes, no engine dependency). This module is a thin re-export shim so
 * existing imports keep working and the operation layer's `TableMetadata`
 * type stays stable.
 */
export type {
  RelationalFieldType,
  FieldMetadata,
  IndexMetadata,
  ForeignKeyMetadata,
  RdbTableMetadata as TableMetadata,
  RdbTableMetadataMap as TableMetadataMap,
} from "mcp-shared-db-core";
