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

const argsSchema = z.object({
  table: z.string(),
  column: z.string().describe("JSON column name (JS field name)"),
  path: z
    .string()
    // Op-layer path-injection guard. Allowed: word chars, `.`, `$`, `[`, `]`.
    // Rejects whitespace, quotes, semicolons, comments, SQL operators —
    // anything that could break out of an identifier in a dialect that
    // (in violation of contract) interpolates the path instead of binding
    // it. The dialect bind is the load-bearing defence (PG: text[]
    // segments, MySQL: `JSON_EXTRACT(col, ?)`); this regex is defense-in-
    // depth so a single-line dialect mistake doesn't open injection.
    .regex(
      /^[\w.[\]$]+$/,
      "JSON path may only contain word chars, '.', '$', '[' and ']' (no quotes, spaces, or SQL meta-characters)",
    )
    .describe(
      "JSON path. Either dot notation ('foo.bar', auto-prefixed to '$.foo.bar') or full path '$.foo.bar'. Limited to word chars, '.', '$', '[' and ']'.",
    ),
  value: z
    .union([z.string(), z.number(), z.boolean()])
    .describe("Value to match at the JSON path (exact match)"),
  limit: z.number().int().positive().max(MAX_LIMIT).optional(),
});

// Normalize bare paths ("foo.bar") to full JSON-path syntax ("$.foo.bar").
// Pre-prefixed paths are passed through as-is.
function normalizeJsonPath(input: string): string {
  return input.startsWith("$") ? input : `$.${input}`;
}

export const jsonSearchOp: DatabaseOperation<z.infer<typeof argsSchema>> = {
  id: "json_search",
  summary: "Search rows by exact match on a JSON path",
  detail: `Filters rows where the JSON value at \`<path>\` in \`<column>\` equals \`<value>\`.
Column must be selectable AND declared as \`type: "json"\` in Layer 1 metadata.
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
    // Type guard: this op is only meaningful on JSON columns.
    if (fieldMeta.type !== "json") {
      return jsonResponse({
        error: `Column '${args.column}' on '${args.table}' is not a JSON column (type: ${fieldMeta.type}).`,
      });
    }

    const path = normalizeJsonPath(args.path);
    const limit = args.limit ?? DEFAULT_LIMIT;
    const columns = Object.keys(config.fields);
    const rows = await ctx.dataSource.findByJsonPath({
      table: args.table,
      field: args.column,
      path,
      value: args.value,
      columns,
      limit,
    });

    const redacted = redactPiiMany({ rows, table: config });
    const response: Record<string, unknown> = {
      table: args.table,
      column: args.column,
      path,
      value: args.value,
      count: redacted.length,
      rows: redacted,
    };
    // GIN/expression indexes on JSON columns can't be detected from
    // `indexes[].fields[0]` alone, so this only flags the truly bare case
    // where the JSON column has no index at all.
    if (!hasLeadingIndex({ meta, column: args.column })) {
      response.warning = unindexedColumnWarning({ table: args.table, column: args.column });
    }
    return jsonResponse(response);
  },
};
