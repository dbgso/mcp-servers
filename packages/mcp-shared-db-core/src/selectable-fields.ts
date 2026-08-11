/**
 * Layer 2 — hand-edited PII / access-control whitelist.
 *
 * DB-agnostic. Both relational (Postgres/MySQL/SQLite) and NoSQL (DynamoDB)
 * tools share this whitelist shape.
 *
 * # Field visibility (`select`)
 *
 * Each whitelisted field carries a `select` policy:
 *
 *   - `"expose"` — value returned as-is
 *   - `"redact"` — value replaced with `[REDACTED]` in tool output
 *   - `"exclude"` — column rejected from queries entirely (callers asking
 *     for the field get an error)
 *
 * **Default when `select` is unspecified: `"redact"`.** This is the
 * secure-by-default model: an auto-generated `selectable-fields.json`
 * template starts with every field masked, and an operator opts each
 * field into `expose` only after an explicit audit.
 *
 * # Legacy `pii: true` compatibility
 *
 * Older configs use `{ pii: true, piiReason: "..." }`. They are read as
 * `{ select: "redact", note: "..." }` for back-compat; the startup nudge
 * in `db-read-mcp` surfaces a warning so operators migrate at their own
 * pace. If both forms are set on the same field, `select` wins (explicit
 * override beats legacy alias).
 */

const REDACTED = "[REDACTED]";

export type FieldVisibility = "exclude" | "redact" | "expose";

export interface SelectableFieldInfo {
  /**
   * Visibility policy for this field. Default `"redact"` when unset —
   * see module doc for the secure-by-default rationale.
   */
  select?: FieldVisibility;
  /** Free-form note (replaces `piiReason`; not restricted to PII justifications). */
  note?: string;

  // --- legacy aliases (read-compat only; new code should use `select` / `note`) ---
  /** @deprecated Use `select: "redact"`. Read as `select: "redact"` when present. */
  pii?: boolean;
  /** @deprecated Use `note`. */
  piiReason?: string;
}

export interface TableConfig<TFieldName extends string = string> {
  /** Optional human-readable description shown by `describe_table`. */
  description?: string;
  /**
   * Whitelisted fields keyed by name. Missing field names (not present in
   * this map) are treated as if `select: "exclude"` — callers asking for
   * them get an error.
   */
  fields: { [K in TFieldName]: SelectableFieldInfo };
}

export type SelectableFieldsMap = Record<string, TableConfig>;

/**
 * Resolve the effective visibility policy for a field, honoring the
 * default (`"redact"`) and the legacy `pii: true` alias. `select` wins
 * over `pii` when both are set.
 */
export function getEffectivePolicy(info: SelectableFieldInfo): FieldVisibility {
  if (info.select !== undefined) return info.select;
  if (info.pii === true) return "redact";
  return "redact";
}

/**
 * Resolve the effective free-form note, preferring `note` over the legacy
 * `piiReason` alias. Trims whitespace; empty string becomes `undefined`.
 */
export function getEffectiveNote(info: SelectableFieldInfo): string | undefined {
  const raw = info.note ?? info.piiReason;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Names of every whitelisted field on a table (regardless of visibility
 * policy). Use {@link getQueryableFieldNames} for the subset that callers
 * are actually permitted to SELECT.
 */
export function getAllFieldNames(table: TableConfig): string[] {
  return Object.keys(table.fields);
}

/**
 * Names of whitelisted fields whose effective policy is NOT `"exclude"` —
 * the set a query is permitted to ask for. Order preserved from the source
 * config so callers can rely on it for stable column ordering.
 */
export function getQueryableFieldNames(table: TableConfig): string[] {
  return Object.entries(table.fields)
    .filter(([, info]) => getEffectivePolicy(info) !== "exclude")
    .map(([name]) => name);
}

/**
 * Apply each field's visibility policy to a row:
 *
 *   - `"expose"` — pass through
 *   - `"redact"` — replace value with `[REDACTED]` (null/undefined stay
 *     as-is so existence checks still work without leaking the value)
 *   - `"exclude"` — delete the property entirely (defence-in-depth: the
 *     access-control layer should have rejected the query before it ever
 *     loaded the column, but if a custom op bypasses the check the value
 *     still won't escape)
 */
export function redactPii<T extends Record<string, unknown>>(params: {
  row: T;
  table: TableConfig;
}): T {
  const { row, table } = params;
  const out: Record<string, unknown> = { ...row };
  for (const [name, info] of Object.entries(table.fields)) {
    const policy = getEffectivePolicy(info);
    if (policy === "expose") continue;
    if (policy === "exclude") {
      delete out[name];
      continue;
    }
    // policy === "redact"
    if (!(name in out)) continue;
    if (out[name] === null || out[name] === undefined) continue;
    out[name] = REDACTED;
  }
  return out as T;
}

export function redactPiiMany<T extends Record<string, unknown>>(params: {
  rows: T[];
  table: TableConfig;
}): T[] {
  const { rows, table } = params;
  return rows.map((row) => redactPii({ row, table }));
}
