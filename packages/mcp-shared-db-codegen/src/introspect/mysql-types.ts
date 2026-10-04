/**
 * Map MySQL native types to the engine-agnostic `GenericFieldType`.
 *
 * `mysqlNativeType` is the value of `information_schema.columns.column_type`
 * (e.g. `varchar(255)`, `tinyint(1)`, `int(10) unsigned`, `enum('a','b')`)
 * — that form preserves the precision suffix needed to distinguish
 * `tinyint(1)` (boolean by convention) from `tinyint(4)` (small int).
 *
 * The type table lives in `mcp-shared-db-core`, shared with the validator's
 * native-type classifier.
 */
import { mapNativeType, type GenericFieldType } from "mcp-shared-db-core";

/**
 * Map a MySQL native type to a `GenericFieldType`.
 *
 * Fallback: unknown types are treated as string. The caller keeps the
 * native type around so a human can review and fix it later.
 */
export function mapMysqlType(nativeType: string): GenericFieldType {
  return mapNativeType({ nativeType, engine: "mysql" }) ?? "string";
}
