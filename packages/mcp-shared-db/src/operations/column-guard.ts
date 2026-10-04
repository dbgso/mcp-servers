/**
 * The guards and the response tail the column-scoped read operations share.
 *
 * Every op that filters by a column asks the same questions in the same
 * order -- is the table selectable, is the column whitelisted, and for the
 * typed ops, does Layer 1 metadata declare the column with the right type --
 * and every one of them flags a filter column without a leading index the
 * same way. Written once here so the ops cannot drift apart.
 */
import { jsonResponse } from "mcp-shared";
import {
  getQueryableFieldNames,
  hasLeadingIndex,
  isColumnAllowed,
  resolveTable,
  unindexedColumnWarning,
  type Refusal,
  type ResolvedTable,
} from "mcp-shared-db-core";
import type { TableMetadata } from "../metadata.js";
import type { DatabaseOperationContext } from "./types.js";

/** Column types an op can require. */
export type RequiredColumnType = "datetime" | "json";

const TYPE_LABEL: Record<RequiredColumnType, string> = {
  datetime: "datetime",
  json: "JSON",
};

function refuse(body: Record<string, unknown>): Refusal {
  return { refusal: jsonResponse(body) };
}

/**
 * Resolve `table` and check that `column` is whitelisted on it; with
 * `requiredType`, also that its metadata declares that type.
 */
export function resolveColumn(params: {
  ctx: DatabaseOperationContext;
  table: string;
  column: string;
  requiredType?: RequiredColumnType;
}): ResolvedTable<TableMetadata> | Refusal {
  const { ctx, table, column, requiredType } = params;
  const resolved = resolveTable({ ctx, table });
  if ("refusal" in resolved) return resolved;
  // Column must be in the whitelist and not `select: "exclude"` -- an
  // excluded column must not be filtered on either, or the result tells the
  // caller whether a row with that hidden value exists.
  if (!isColumnAllowed({ selectableFields: ctx.selectableFields, tableName: table, column })) {
    return refuse({
      error: `Column '${column}' is not selectable on '${table}'.`,
      allowedColumns: getQueryableFieldNames(resolved.config),
    });
  }
  if (requiredType === undefined) return resolved;
  return checkColumnType({ resolved, table, column, requiredType }) ?? resolved;
}

function checkColumnType(params: {
  resolved: ResolvedTable<TableMetadata>;
  table: string;
  column: string;
  requiredType: RequiredColumnType;
}): Refusal | undefined {
  const { resolved, table, column, requiredType } = params;
  const fieldMeta = resolved.meta.fields[column];
  // Need Layer-1 metadata to know the column type.
  if (!fieldMeta) {
    return refuse({ error: `Column '${column}' has no metadata on '${table}'.` });
  }
  if (fieldMeta.type !== requiredType) {
    return refuse({
      error: `Column '${column}' on '${table}' is not a ${TYPE_LABEL[requiredType]} column (type: ${fieldMeta.type}).`,
    });
  }
  return undefined;
}

/**
 * Add the "no leading index" warning to `response` when `column` cannot be
 * narrowed by an index on `meta`. Returns `response` for chaining.
 */
export function withUnindexedWarning(params: {
  response: Record<string, unknown>;
  meta: TableMetadata;
  table: string;
  column: string;
}): Record<string, unknown> {
  const { response, meta, table, column } = params;
  if (!hasLeadingIndex({ meta, column })) {
    response.warning = unindexedColumnWarning({ table, column });
  }
  return response;
}
