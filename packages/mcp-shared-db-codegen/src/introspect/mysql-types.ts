/**
 * Pure mapping from MySQL native types to the engine-agnostic
 * `GenericFieldType`. Split out so it can be unit-tested without a DB.
 *
 * `mysqlNativeType` is the value of `information_schema.columns.column_type`
 * (e.g. `varchar(255)`, `tinyint(1)`, `int(10) unsigned`, `enum('a','b')`)
 * — that form preserves the precision suffix needed to distinguish
 * `tinyint(1)` (boolean by convention) from `tinyint(4)` (small int).
 */
import type { GenericFieldType } from "mcp-shared-db-core";

const NUMBER_TYPES = new Set([
  "smallint",
  "mediumint",
  "int",
  "integer",
  "bigint",
  "tinyint",
  "decimal",
  "numeric",
  "float",
  "double",
  "real",
  "fixed",
  "bit",
]);

const STRING_TYPES = new Set([
  "char",
  "varchar",
  "text",
  "tinytext",
  "mediumtext",
  "longtext",
  "enum",
  "set",
  "uuid",
]);

const DATETIME_TYPES = new Set([
  "date",
  "datetime",
  "timestamp",
  "time",
  "year",
]);

const JSON_TYPES = new Set(["json"]);

const BINARY_TYPES = new Set([
  "binary",
  "varbinary",
  "blob",
  "tinyblob",
  "mediumblob",
  "longblob",
]);

const BOOLEAN_TYPES = new Set(["bool", "boolean"]);

/**
 * Map a MySQL native type to a `GenericFieldType`.
 *
 * Special case: `tinyint(1)` is treated as boolean (MySQL convention,
 * matches what frameworks like Drizzle / Knex / TypeORM do). `tinyint(N)`
 * for N != 1 stays as number.
 */
export function mapMysqlType(nativeType: string): GenericFieldType {
  const lowered = nativeType.toLowerCase().trim();
  // tinyint(1) — boolean by convention.
  if (/^tinyint\s*\(\s*1\s*\)/.test(lowered)) return "boolean";
  // Strip the (length / precision) and any trailing unsigned/zerofill modifiers
  // before the lookup: `int(10) unsigned` → `int`.
  const base = lowered
    .replace(/\(.*?\)/, "")
    .replace(/\s+(unsigned|signed|zerofill).*$/, "")
    .trim();
  if (BOOLEAN_TYPES.has(base)) return "boolean";
  if (NUMBER_TYPES.has(base)) return "number";
  if (STRING_TYPES.has(base)) return "string";
  if (DATETIME_TYPES.has(base)) return "datetime";
  if (JSON_TYPES.has(base)) return "json";
  if (BINARY_TYPES.has(base)) return "binary";
  // Fallback: unknown types are treated as string. The caller keeps the
  // native type around so a human can review and fix it later.
  return "string";
}
