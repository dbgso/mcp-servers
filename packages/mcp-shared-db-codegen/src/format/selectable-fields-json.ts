/**
 * Format `RawTableMetadata[]` into a pretty-printed JSON template for
 * `selectable-fields.json`.
 *
 * The output is intentionally **judgement-free**: every field starts with
 * `{ "select": "redact" }`, the secure-by-default state where the value
 * is masked. The reviewer (LLM or human) decides which fields to flip to
 * `"expose"` after auditing, and which to `"exclude"` outright.
 *
 * The explicit `select: "redact"` is emitted (rather than relying on the
 * runtime default for `{}`) so the on-disk file documents intent: a
 * future maintainer reading the JSON can tell "this field was generated
 * masked" from "this field was hand-edited" at a glance.
 *
 * Mechanical regex-based PII inference was deliberately removed: it gives
 * a false sense of safety on patterns it doesn't know (e.g.
 * `insurance_card_*`, `passport_*`, `kana_*`) and adds noise on patterns
 * it does (e.g. flagging `customer_id` when the actual sensitive field
 * is the FK target).
 *
 * Pure function — no IO.
 */
import type { RawTableMetadata } from "../introspect/types.js";

interface JsonFieldConfig {
  select: "redact";
}

interface JsonTableConfig {
  description?: string;
  fields: Record<string, JsonFieldConfig>;
}

function toJsonTableConfig(table: RawTableMetadata): JsonTableConfig {
  const fields: Record<string, JsonFieldConfig> = {};
  for (const c of table.columns) fields[c.name] = { select: "redact" };
  const out: JsonTableConfig = { fields };
  if (table.description) out.description = table.description;
  return out;
}

export function formatSelectableFieldsJson(tables: RawTableMetadata[]): string {
  const out: Record<string, JsonTableConfig> = {};
  for (const t of tables) out[t.name] = toJsonTableConfig(t);
  return `${JSON.stringify(out, null, 2)}\n`;
}
