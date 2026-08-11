/**
 * Detect legacy `pii: true` / `piiReason` usage in a `selectable-fields`
 * map. Pure: data-in / data-out, so consumers (e.g. `db-read-mcp`'s
 * startup nudge) can format the warning however they like.
 *
 * Entries are reported one-per-occurrence with `table` + `field` + the
 * specific kind of legacy field detected, so a fix script (or human) can
 * locate each site without diffing the whole file.
 */

import type { SelectableFieldsMap } from "./selectable-fields.js";

export type LegacyUsageKind =
  /** Field has `pii: true` (replace with `select: "redact"`). */
  | "pii"
  /** Field has `piiReason: "..."` (replace with `note: "..."`). */
  | "piiReason";

export interface LegacyUsageEntry {
  table: string;
  field: string;
  kind: LegacyUsageKind;
}

export interface LegacyUsageReport {
  /** Every legacy site, in declaration order. Empty array if none. */
  entries: LegacyUsageEntry[];
  /** Convenience flag — `entries.length > 0`. */
  hasLegacyUsage: boolean;
}

/**
 * Scan `map` for legacy `pii` / `piiReason` field usage. Returns an
 * empty report when the map is already fully migrated.
 */
export function detectLegacySelectableFieldsUsage(
  map: SelectableFieldsMap,
): LegacyUsageReport {
  const entries: LegacyUsageEntry[] = [];
  for (const [table, config] of Object.entries(map)) {
    for (const [field, info] of Object.entries(config.fields)) {
      if (info.pii !== undefined) entries.push({ table, field, kind: "pii" });
      if (info.piiReason !== undefined) {
        entries.push({ table, field, kind: "piiReason" });
      }
    }
  }
  return { entries, hasLegacyUsage: entries.length > 0 };
}
