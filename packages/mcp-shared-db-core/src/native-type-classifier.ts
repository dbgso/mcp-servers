/**
 * The one table of DB-native type names, and the two views read from it.
 *
 * - `mapNativeType({ nativeType, engine })` gives the engine-agnostic
 *   `GenericFieldType` codegen writes into metadata.
 * - `classifyNativeType(nativeType)` gives the coarse class the validator
 *   uses to flag `pii: true` on columns whose `nativeType` structurally
 *   cannot represent PII on its own (e.g. `timestamp`, `enum`, boolean
 *   flags, numeric foreign keys). False positives are accepted on the caller
 *   side via warn-only severity — see `validate.ts`.
 *
 * Both used to keep their own type lists, which disagreed (codegen read
 * `tinyint(1) unsigned` as boolean, the validator as numeric). Now both go
 * through one normalisation and one table, so they cannot drift.
 *
 * No I/O. No DB driver dependency.
 */
import type { GenericFieldType } from "./metadata.js";

/** Relational engines whose native type names are known here. */
export type NativeTypeEngine = "mysql" | "postgres";

/**
 * What a native type holds. Finer than `GenericFieldType`: the validator
 * needs to tell an integer (a possible surrogate id) from a decimal, and an
 * enum from free text, which both map to the same generic type.
 */
type NativeTypeKind =
  | "integer"
  | "decimal"
  | "text"
  | "enum"
  | "temporal"
  | "boolean"
  | "json"
  | "binary";

/**
 * Native type names per engine, after {@link nativeTypeBase} normalisation.
 * `tinyint(1)` keeps its length because it is boolean by MySQL convention
 * (what Drizzle / Knex / TypeORM do); any other `tinyint(N)` is an integer.
 */
const NATIVE_TYPES: Record<NativeTypeEngine, Record<NativeTypeKind, readonly string[]>> = {
  mysql: {
    integer: ["tinyint", "smallint", "mediumint", "int", "integer", "bigint", "bit"],
    decimal: ["decimal", "numeric", "fixed", "float", "double", "real"],
    text: ["char", "varchar", "text", "tinytext", "mediumtext", "longtext", "set", "uuid"],
    enum: ["enum"],
    temporal: ["date", "datetime", "timestamp", "time", "year"],
    boolean: ["bool", "boolean", "tinyint(1)"],
    json: ["json"],
    binary: ["binary", "varbinary", "blob", "tinyblob", "mediumblob", "longblob"],
  },
  postgres: {
    integer: [
      "smallint",
      "integer",
      "int",
      "int2",
      "int4",
      "int8",
      "bigint",
      "smallserial",
      "serial",
      "bigserial",
      "serial2",
      "serial4",
      "serial8",
    ],
    decimal: ["numeric", "decimal", "real", "double precision", "float4", "float8", "money"],
    text: [
      "text",
      "varchar",
      "character varying",
      "char",
      "character",
      "bpchar",
      "uuid",
      "name",
      "citext",
    ],
    enum: [],
    temporal: [
      "timestamp",
      "timestamptz",
      "timestamp without time zone",
      "timestamp with time zone",
      "date",
      "time",
      "timetz",
      "time without time zone",
      "time with time zone",
    ],
    boolean: ["boolean", "bool"],
    json: ["json", "jsonb"],
    binary: ["bytea"],
  },
};

/** The same table, indexed by name for lookup. */
const KIND_BY_NAME: Record<NativeTypeEngine, ReadonlyMap<string, NativeTypeKind>> = {
  mysql: indexByName(NATIVE_TYPES.mysql),
  postgres: indexByName(NATIVE_TYPES.postgres),
};

function indexByName(
  table: Record<NativeTypeKind, readonly string[]>,
): ReadonlyMap<string, NativeTypeKind> {
  const byName = new Map<string, NativeTypeKind>();
  for (const [kind, names] of Object.entries(table) as [NativeTypeKind, readonly string[]][]) {
    for (const name of names) byName.set(name, kind);
  }
  return byName;
}

const GENERIC_BY_KIND: Record<NativeTypeKind, GenericFieldType> = {
  integer: "number",
  decimal: "number",
  text: "string",
  enum: "string",
  temporal: "datetime",
  boolean: "boolean",
  json: "json",
  binary: "binary",
};

export type NativeTypeClass =
  | "temporal"
  | "boolean"
  | "enum"
  | "numeric"
  | "text"
  | "other";

// `numeric` means "could be a surrogate id", so decimals are not numeric
// here; binary carries no signal either way.
const CLASS_BY_KIND: Record<NativeTypeKind, NativeTypeClass> = {
  integer: "numeric",
  decimal: "other",
  text: "text",
  enum: "enum",
  temporal: "temporal",
  boolean: "boolean",
  json: "text",
  binary: "other",
};

/**
 * Reduce a native type string to the name the table is keyed by: lower
 * case, without the `(length / precision / values)` suffix and the MySQL
 * `unsigned` / `signed` / `zerofill` modifiers — `int(10) unsigned` → `int`,
 * `enum('a','b')` → `enum`, `timestamp(3) with time zone` →
 * `timestamp with time zone`. `tinyint(1)` keeps its length (see
 * {@link NATIVE_TYPES}).
 */
export function nativeTypeBase(nativeType: string): string {
  const lowered = nativeType.toLowerCase().trim();
  if (/^tinyint\s*\(\s*1\s*\)/.test(lowered)) return "tinyint(1)";
  return lowered
    .replace(/\(.*\)/, "")
    .replace(/\s+(unsigned|signed|zerofill)\b.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function kindOf(params: {
  nativeType: string;
  engines: readonly NativeTypeEngine[];
}): NativeTypeKind | undefined {
  const { nativeType, engines } = params;
  const base = nativeTypeBase(nativeType);
  for (const engine of engines) {
    const kind = KIND_BY_NAME[engine].get(base);
    if (kind) return kind;
  }
  return undefined;
}

/**
 * Map a native type of `engine` to a `GenericFieldType`, or `undefined`
 * when the type is not in the table (the caller picks the fallback).
 */
export function mapNativeType(params: {
  nativeType: string;
  engine: NativeTypeEngine;
}): GenericFieldType | undefined {
  const kind = kindOf({ nativeType: params.nativeType, engines: [params.engine] });
  return kind && GENERIC_BY_KIND[kind];
}

/**
 * Map a DB-native type string to a coarse class. The engine is not known
 * here (metadata does not record it), so both engines' names are accepted.
 * Returns `"other"` for unknown / missing inputs so the caller treats them
 * as "no signal" rather than misclassifying.
 */
export function classifyNativeType(nativeType: string | undefined): NativeTypeClass {
  if (!nativeType) return "other";
  const kind = kindOf({ nativeType, engines: ["mysql", "postgres"] });
  return kind ? CLASS_BY_KIND[kind] : "other";
}

/**
 * Heuristic: a column name that looks like a foreign-key / primary-key
 * reference. Used together with `classifyNativeType(...) === "numeric"` to
 * flag `pii: true` on plain surrogate ids (`user_id`, `id`) which by
 * themselves do not identify a person.
 */
export function looksLikeForeignKeyName(columnName: string): boolean {
  return columnName === "id" || /_id$/.test(columnName);
}
