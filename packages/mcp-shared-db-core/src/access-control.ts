import {
  getEffectivePolicy,
  type SelectableFieldsMap,
} from "./selectable-fields.js";

/** Sorted list of selectable table names (for error messages). */
export function listAvailableTables(selectableFields: SelectableFieldsMap): string[] {
  return Object.keys(selectableFields).sort((a, b) => a.localeCompare(b));
}

/**
 * Check whether `tableName` is in the whitelist. Returns true/false; no error
 * formatting (callers decide how to surface the rejection).
 */
export function isTableAllowed(params: {
  selectableFields: SelectableFieldsMap;
  tableName: string;
}): boolean {
  return Boolean(params.selectableFields[params.tableName]);
}

/**
 * Check whether `column` is selectable on `tableName`. Returns true when:
 *   1. the table is whitelisted, AND
 *   2. the column appears in its `fields` map, AND
 *   3. its effective policy is not `"exclude"`.
 *
 * The `"exclude"` rejection is the explicit "this column must not be
 * SELECTable at all" signal — operationally identical to omitting the
 * field from the whitelist, but reads as intent rather than oversight
 * when the column is listed elsewhere in the config.
 */
export function isColumnAllowed(params: {
  selectableFields: SelectableFieldsMap;
  tableName: string;
  column: string;
}): boolean {
  const config = params.selectableFields[params.tableName];
  if (!config) return false;
  const info = config.fields[params.column];
  if (!info) return false;
  return getEffectivePolicy(info) !== "exclude";
}
