import { z } from "zod";
import { jsonResponse } from "mcp-shared";
import { listAvailableTables, redactPii } from "mcp-shared-db-core";
import type { DatabaseOperation } from "./types.js";

const argsSchema = z.object({
  table: z.string().describe("Logical table name"),
  pk: z
    .union([z.string(), z.number()])
    .describe("Primary key value. Use string for char/varchar PKs, number for int PKs."),
});

export const getByPkOp: DatabaseOperation<z.infer<typeof argsSchema>> = {
  id: "get_by_pk",
  summary: "Fetch a single row by primary key",
  detail: `Looks up at most one row by the table's primary key column.
The PK is read from Layer 1 metadata. Composite primary keys are not supported by this op
(use \`get_by_fk\` or \`get_by_index\` to filter by a non-PK column).
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

    const pkFields = meta.primaryKey;
    // Tables with no declared PK can't be looked up by PK.
    if (pkFields.length === 0) {
      return jsonResponse({ error: `Table '${args.table}' has no primary key declared.` });
    }
    // Composite PKs are out of scope for this op.
    if (pkFields.length > 1) {
      return jsonResponse({
        error: `Table '${args.table}' has a composite primary key (${pkFields.length} columns). get_by_pk supports single-column PKs only.`,
      });
    }

    const columns = Object.keys(config.fields);
    const row = await ctx.dataSource.findByPk({ table: args.table, pk: args.pk, columns });

    if (!row) {
      return jsonResponse({ table: args.table, pk: args.pk, found: false });
    }
    const redacted = redactPii({ row, table: config });
    return jsonResponse({ table: args.table, pk: args.pk, found: true, row: redacted });
  },
};
