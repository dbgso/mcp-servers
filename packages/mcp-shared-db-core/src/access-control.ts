import { jsonResponse } from "mcp-shared";
import {
  getEffectivePolicy,
  type SelectableFieldsMap,
  type TableConfig,
} from "./selectable-fields.js";

/** Sorted list of selectable table names (for error messages). */
export function listAvailableTables(selectableFields: SelectableFieldsMap): string[] {
  return Object.keys(selectableFields).sort((a, b) => a.localeCompare(b));
}

/** A table an operation may read: its whitelist entry and its metadata. */
export interface ResolvedTable<TMeta> {
  config: TableConfig;
  meta: TMeta;
}

/** Why an operation refuses a request: the tool response to return. */
export interface Refusal {
  refusal: ReturnType<typeof jsonResponse>;
}

/**
 * Look up `table` in both layers. A table missing from either one is "not
 * selectable", answered with the list of tables that are. Every table-scoped
 * operation starts with this guard.
 */
export function resolveTable<TMeta>(params: {
  ctx: { selectableFields: SelectableFieldsMap; tableMetadata: Record<string, TMeta> };
  table: string;
}): ResolvedTable<TMeta> | Refusal {
  const { ctx, table } = params;
  const config = ctx.selectableFields[table];
  const meta = ctx.tableMetadata[table];
  if (!config || !meta) {
    return {
      refusal: jsonResponse({
        error: `Table '${table}' is not selectable.`,
        availableTables: listAvailableTables(ctx.selectableFields),
      }),
    };
  }
  return { config, meta };
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
