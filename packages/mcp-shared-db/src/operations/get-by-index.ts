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
  column: z.string().describe("Indexed column name (JS field name)"),
  value: z.union([z.string(), z.number(), z.boolean()]).describe("Filter value"),
  limit: z.number().int().positive().max(MAX_LIMIT).optional(),
});

export const getByIndexOp: DatabaseOperation<z.infer<typeof argsSchema>> = {
  id: "get_by_index",
  summary: "Fetch rows by an indexed non-PK / non-FK column",
  detail: `Filter rows by a column that is neither the primary key nor a foreign key —
useful for status enums, idempotency keys, lookup attributes etc.
Caller is responsible for picking a column that actually has an index.
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
    if (!hasLeadingIndex({ meta, column: args.column })) {
      response.warning = unindexedColumnWarning({ table: args.table, column: args.column });
    }
    return jsonResponse(response);
  },
};
