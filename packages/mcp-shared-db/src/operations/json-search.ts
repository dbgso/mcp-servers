import { z } from "zod";
import { jsonResponse } from "mcp-shared";
import { redactPiiMany } from "mcp-shared-db-core";
import { resolveColumn, withUnindexedWarning } from "./column-guard.js";
import { DEFAULT_LIMIT, MAX_LIMIT } from "./find-by-eq.js";
import type { DatabaseOperation } from "./types.js";

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

export class JsonSearchOp implements DatabaseOperation<z.infer<typeof argsSchema>> {
  readonly id = "json_search";
  readonly summary = "Search rows by exact match on a JSON path";
  readonly detail = `Filters rows where the JSON value at \`<path>\` in \`<column>\` equals \`<value>\`.
Column must be selectable AND declared as \`type: "json"\` in Layer 1 metadata.
PII fields are redacted as \`"[REDACTED]"\`.`;
  readonly category = "Read";
  readonly argsSchema = argsSchema;
  async execute({ args, ctx }: Parameters<DatabaseOperation<z.infer<typeof argsSchema>>["execute"]>[0]) {
    const resolved = resolveColumn({
      ctx,
      table: args.table,
      column: args.column,
      requiredType: "json",
    });
    if ("refusal" in resolved) return resolved.refusal;
    const { config, meta } = resolved;

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
    // GIN/expression indexes on JSON columns can't be detected from
    // `indexes[].fields[0]` alone, so this only flags the truly bare case
    // where the JSON column has no index at all.
    return jsonResponse(
      withUnindexedWarning({
        response: {
          table: args.table,
          column: args.column,
          path,
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
}

export const jsonSearchOp = new JsonSearchOp();
