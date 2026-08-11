import { z } from "zod";
import { jsonResponse } from "mcp-shared";
import {
  hasLeadingIndex,
  listAvailableTables,
  redactPiiMany,
  unindexedColumnWarning,
} from "mcp-shared-db-core";
import type { DatabaseOperation } from "./types.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

/**
 * Default upper bound on the planner's row-count estimate. Anything above
 * this is refused by the auto-EXPLAIN guard. Override with the
 * `DBREAD_MAX_ESTIMATED_ROWS` env var (positive integer; empty / non-numeric
 * / non-positive values fall back to this default).
 */
export const DEFAULT_MAX_ESTIMATED_ROWS = 100_000;

const argsSchema = z.object({
  table: z.string(),
  column: z.string().describe("Datetime column to filter by (e.g. 'createdAt')"),
  from: z.string().describe("Lower bound (inclusive). ISO 8601 string."),
  to: z.string().describe("Upper bound (inclusive). ISO 8601 string."),
  limit: z.number().int().positive().max(MAX_LIMIT).optional(),
  confirmExpensive: z
    .boolean()
    .optional()
    .describe(
      "Bypass the EXPLAIN-based row-estimate guard. Set only after you've verified the range is bounded.",
    ),
});

function resolveThreshold(): number {
  const raw = process.env.DBREAD_MAX_ESTIMATED_ROWS;
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_ESTIMATED_ROWS;
}

export const getByDateRangeOp: DatabaseOperation<z.infer<typeof argsSchema>> = {
  id: "get_by_date_range",
  summary: "Fetch rows whose datetime column falls within [from, to] (auto-EXPLAIN guarded)",
  detail: `Inclusive range filter on a datetime column. Both bounds are required.
Column must be selectable AND declared as \`type: "datetime"\` in Layer 1 metadata.

Runs \`EXPLAIN\` first. When the planner's row-count estimate exceeds the
configured threshold (default 100,000; override with
\`DBREAD_MAX_ESTIMATED_ROWS\`) the actual fetch is refused and the response
carries the estimate so the caller can narrow the range. Pass
\`confirmExpensive: true\` to bypass the guard once the range has been
size-checked. Engines that cannot surface a row estimate (e.g. SQLite
without ANALYZE) skip the guard transparently.

PII fields are redacted as \`"[REDACTED]"\`.`,
  category: "Read",
  argsSchema,
  execute: async ({ args, ctx }) => {
    const config = ctx.selectableFields[args.table];
    const meta = ctx.tableMetadata[args.table];
    // Unknown / non-whitelisted table.
    if (!config || !meta) {
      return jsonResponse({
        error: `Table '${args.table}' is not selectable.`,
        availableTables: listAvailableTables(ctx.selectableFields),
      });
    }
    // Column must be in the whitelist.
    if (!config.fields[args.column]) {
      return jsonResponse({
        error: `Column '${args.column}' is not selectable on '${args.table}'.`,
        allowedColumns: Object.keys(config.fields),
      });
    }
    const fieldMeta = meta.fields[args.column];
    // Need Layer-1 metadata to know the column type.
    if (!fieldMeta) {
      return jsonResponse({
        error: `Column '${args.column}' has no metadata on '${args.table}'.`,
      });
    }
    // Type guard: this op is only meaningful on datetime columns.
    if (fieldMeta.type !== "datetime") {
      return jsonResponse({
        error: `Column '${args.column}' on '${args.table}' is not a datetime column (type: ${fieldMeta.type}).`,
      });
    }

    const from = new Date(args.from);
    const to = new Date(args.to);
    // Reject inputs that don't parse as Date.
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return jsonResponse({ error: "Invalid 'from' or 'to' (must parse as Date)." });
    }
    // Range must be non-empty.
    if (from.getTime() > to.getTime()) {
      return jsonResponse({ error: "'from' must be <= 'to'." });
    }

    const limit = args.limit ?? DEFAULT_LIMIT;
    const columns = Object.keys(config.fields);

    // Auto-EXPLAIN guard. Bypassed when caller confirms or engine returns null.
    const explain = await ctx.dataSource.explainFindByRange({
      table: args.table,
      field: args.column,
      from,
      to,
      columns,
      limit,
    });
    const threshold = resolveThreshold();
    if (
      args.confirmExpensive !== true &&
      explain.estimatedRows !== null &&
      explain.estimatedRows > threshold
    ) {
      const blocked: Record<string, unknown> = {
        error: `Estimated ${explain.estimatedRows} rows exceeds the safety threshold ${threshold}. Narrow the date range, or set confirmExpensive: true to bypass.`,
        estimatedRows: explain.estimatedRows,
        totalCost: explain.totalCost,
        planSummary: explain.planSummary,
        threshold,
      };
      // Surface the un-indexed warning on the blocked path too — when the
      // estimate balloons, the cause is almost always "no leading index on
      // the date column", so the LLM gets a concrete next step (pick a
      // different column / ask for an index) rather than just retrying.
      if (!hasLeadingIndex({ meta, column: args.column })) {
        blocked.warning = unindexedColumnWarning({ table: args.table, column: args.column });
      }
      return jsonResponse(blocked);
    }

    const rows = await ctx.dataSource.findByRange({
      table: args.table,
      field: args.column,
      from,
      to,
      columns,
      limit,
    });

    const redacted = redactPiiMany({ rows, table: config });
    const response: Record<string, unknown> = {
      table: args.table,
      column: args.column,
      from: args.from,
      to: args.to,
      count: redacted.length,
      rows: redacted,
      estimatedRows: explain.estimatedRows,
      planSummary: explain.planSummary,
    };
    if (!hasLeadingIndex({ meta, column: args.column })) {
      response.warning = unindexedColumnWarning({ table: args.table, column: args.column });
    }
    return jsonResponse(response);
  },
};
