/**
 * Pure mapping from Postgres native types to the engine-agnostic
 * `GenericFieldType`. Split out so it can be unit-tested without a DB.
 */
import type { GenericFieldType } from "mcp-shared-db-core";

const STRING_TYPES = new Set([
  "text",
  "varchar",
  "character varying",
  "char",
  "character",
  "uuid",
  "name",
  "citext",
  "bpchar",
]);

const NUMBER_TYPES = new Set([
  "smallint",
  "integer",
  "int",
  "int2",
  "int4",
  "int8",
  "bigint",
  "numeric",
  "decimal",
  "real",
  "double precision",
  "float4",
  "float8",
  "money",
  "smallserial",
  "serial",
  "bigserial",
  "serial2",
  "serial4",
  "serial8",
]);

const BOOLEAN_TYPES = new Set(["boolean", "bool"]);

const DATETIME_TYPES = new Set([
  "timestamp",
  "timestamptz",
  "timestamp without time zone",
  "timestamp with time zone",
  "date",
  "time",
  "timetz",
  "time without time zone",
  "time with time zone",
]);

const JSON_TYPES = new Set(["json", "jsonb"]);

const BINARY_TYPES = new Set(["bytea"]);

/**
 * Map a Postgres native type to a `GenericFieldType`.
 *
 * Accepts both `data_type` (e.g. `character varying`) and the simpler
 * `udt_name` (e.g. `varchar`) forms.
 */
export function mapPostgresType(nativeType: string): GenericFieldType {
  // Strip a parenthesised length/precision (e.g. `varchar(255)` -> `varchar`).
  const base = nativeType.toLowerCase().replace(/\(.*\)/, "").trim();
  if (STRING_TYPES.has(base)) return "string";
  if (NUMBER_TYPES.has(base)) return "number";
  if (BOOLEAN_TYPES.has(base)) return "boolean";
  if (DATETIME_TYPES.has(base)) return "datetime";
  if (JSON_TYPES.has(base)) return "json";
  if (BINARY_TYPES.has(base)) return "binary";
  // Fallback: anything we don't recognise is treated as string. The caller
  // keeps the native type around so a human can review and fix it later.
  return "string";
}
