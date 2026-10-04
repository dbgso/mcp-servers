/**
 * `column = value` lookup shared by `get_by_fk` and `get_by_index`.
 *
 * The two ops differ in what they tell the caller (a foreign key to a
 * parent record vs any indexed attribute) and in which value types their
 * schemas accept; what they run is the same.
 */
import { jsonResponse } from "mcp-shared";
import { getQueryableFieldNames, redactPiiMany } from "mcp-shared-db-core";
import { resolveColumn, withUnindexedWarning } from "./column-guard.js";
import type { DatabaseOperationContext } from "./types.js";

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 1000;

export interface FindByEqArgs {
  table: string;
  column: string;
  value: string | number | boolean;
  limit?: number;
}

export async function executeFindByEq(params: {
  args: FindByEqArgs;
  ctx: DatabaseOperationContext;
}) {
  const { args, ctx } = params;
  const resolved = resolveColumn({ ctx, table: args.table, column: args.column });
  if ("refusal" in resolved) return resolved.refusal;
  const { config, meta } = resolved;

  const rows = await ctx.dataSource.findByEq({
    table: args.table,
    field: args.column,
    value: args.value,
    columns: getQueryableFieldNames(config),
    limit: args.limit ?? DEFAULT_LIMIT,
  });

  const redacted = redactPiiMany({ rows, table: config });
  // PostgreSQL does NOT auto-index FK columns (MySQL does), so an FK lookup
  // against an un-indexed column scans the full child table just like an
  // index lookup on an un-indexed attribute would.
  return jsonResponse(
    withUnindexedWarning({
      response: {
        table: args.table,
        column: args.column,
        value: args.value,
        count: redacted.length,
        rows: redacted,
      },
      meta,
      table: args.table,
      column: args.column,
    }),
  );
}
