import { z } from "zod";
import { jsonResponse } from "mcp-shared";
import { getQueryableFieldNames, redactPiiMany } from "mcp-shared-db-core";
import { resolveColumn, withUnindexedWarning } from "./column-guard.js";
import { DEFAULT_LIMIT, MAX_LIMIT } from "./find-by-eq.js";
import type { DatabaseOperation } from "./types.js";

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

export class GetByDateRangeOp implements DatabaseOperation<z.infer<typeof argsSchema>> {
  readonly id = "get_by_date_range";
  readonly summary = "Fetch rows whose datetime column falls within [from, to] (auto-EXPLAIN guarded)";
  readonly detail = `Inclusive range filter on a datetime column. Both bounds are required.
Column must be selectable AND declared as \`type: "datetime"\` in Layer 1 metadata.

Runs \`EXPLAIN\` first. When the planner's row-count estimate exceeds the
configured threshold (default 100,000; override with
\`DBREAD_MAX_ESTIMATED_ROWS\`) the actual fetch is refused and the response
carries the estimate so the caller can narrow the range. Pass
\`confirmExpensive: true\` to bypass the guard once the range has been
size-checked. Engines that cannot surface a row estimate (e.g. SQLite
without ANALYZE) skip the guard transparently.

PII fields are redacted as \`"[REDACTED]"\`.`;
  readonly category = "Read";
  readonly argsSchema = argsSchema;
  async execute({ args, ctx }: Parameters<DatabaseOperation<z.infer<typeof argsSchema>>["execute"]>[0]) {
    const resolved = resolveColumn({
      ctx,
      table: args.table,
      column: args.column,
      requiredType: "datetime",
    });
    if ("refusal" in resolved) return resolved.refusal;
    const { config, meta } = resolved;
    const indexCheck = { meta, table: args.table, column: args.column };

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
    const columns = getQueryableFieldNames(config);

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
      // Surface the un-indexed warning on the blocked path too — when the
      // estimate balloons, the cause is almost always "no leading index on
      // the date column", so the LLM gets a concrete next step (pick a
      // different column / ask for an index) rather than just retrying.
      return jsonResponse(
        withUnindexedWarning({
          response: {
            error: `Estimated ${explain.estimatedRows} rows exceeds the safety threshold ${threshold}. Narrow the date range, or set confirmExpensive: true to bypass.`,
            estimatedRows: explain.estimatedRows,
            totalCost: explain.totalCost,
            planSummary: explain.planSummary,
            threshold,
          },
          ...indexCheck,
        }),
      );
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
    return jsonResponse(
      withUnindexedWarning({
        response: {
          table: args.table,
          column: args.column,
          from: args.from,
          to: args.to,
          count: redacted.length,
          rows: redacted,
          estimatedRows: explain.estimatedRows,
          planSummary: explain.planSummary,
        },
        ...indexCheck,
      }),
    );
  }
}

export const getByDateRangeOp = new GetByDateRangeOp();
