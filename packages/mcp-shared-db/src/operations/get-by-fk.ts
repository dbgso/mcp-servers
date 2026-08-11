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
  table: z.string().describe("Logical table name"),
  column: z.string().describe("Foreign-key column name in JS form (e.g. 'productId')"),
  value: z.union([z.string(), z.number()]).describe("Foreign-key value to filter by"),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .optional()
    .describe(`Max rows (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`),
});

export const getByFkOp: DatabaseOperation<z.infer<typeof argsSchema>> = {
  id: "get_by_fk",
  summary: "Fetch rows referencing a related record (foreign-key lookup)",
  detail: `Filters rows by a foreign-key column. Use this when you have an ID of a parent
record and want every child row that points at it.
Returns up to \`limit\` rows. PII fields are redacted as \`"[REDACTED]"\`.`,
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
    // Column must be in the whitelist; PII redaction depends on the field config.
    if (!config.fields[args.column]) {
      return jsonResponse({
        error: `Column '${args.column}' is not selectable on '${args.table}'.`,
        allowedColumns: Object.keys(config.fields),
      });
    }

    const limit = args.limit ?? DEFAULT_LIMIT;
    const columns = Object.keys(config.fields);
    const rows = await ctx.dataSource.findByEq({
      table: args.table,
      field: args.column,
      value: args.value,
      columns,
      limit,
    });

    const redacted = redactPiiMany({ rows, table: config });
    const response: Record<string, unknown> = {
      table: args.table,
      column: args.column,
      value: args.value,
      count: redacted.length,
      rows: redacted,
    };
    // PostgreSQL does NOT auto-index FK columns (MySQL does), so an FK
    // lookup against an un-indexed column scans the full child table just
    // like get_by_index would.
    if (!hasLeadingIndex({ meta, column: args.column })) {
      response.warning = unindexedColumnWarning({ table: args.table, column: args.column });
    }
    return jsonResponse(response);
  },
};
