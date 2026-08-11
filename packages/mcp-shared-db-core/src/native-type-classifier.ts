/**
 * Pure classifier for DB-native type strings.
 *
 * Used by the validator to flag `pii: true` on columns whose `nativeType`
 * structurally cannot represent PII on its own (e.g. `timestamp`, `enum`,
 * boolean flags, numeric foreign keys). False positives are accepted on the
 * caller side via warn-only severity — see `validate.ts`.
 *
 * No I/O. No DB engine dependency. Both relational engines (Postgres / MySQL)
 * feed normalised native-type strings into the same regexes.
 */

export type NativeTypeClass =
  | "temporal"
  | "boolean"
  | "enum"
  | "numeric"
  | "text"
  | "other";

/**
 * Map a DB-native type string to a coarse class. Returns `"other"` for
 * unknown / missing inputs so the caller treats them as "no signal" rather
 * than misclassifying.
 *
 * Patterns are ordered by specificity: `tinyint(1)` matches boolean before
 * the bare `tinyint` would match numeric.
 */
export function classifyNativeType(nativeType: string | undefined): NativeTypeClass {
  if (!nativeType) return "other";
  const t = nativeType.toLowerCase().trim();
  if (/^(timestamp|timestamptz|datetime|date|time)\b/.test(t)) return "temporal";
  if (/^(boolean|bool|tinyint\(1\))$/.test(t)) return "boolean";
  if (/^enum\(/.test(t)) return "enum";
  if (/^(int|bigint|smallint|int[248]|tinyint|mediumint|serial)\b/.test(t)) return "numeric";
  if (/^(text|longtext|mediumtext|tinytext|json|jsonb|varchar|char)\b/.test(t)) return "text";
  return "other";
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
