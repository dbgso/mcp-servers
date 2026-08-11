import { z } from "zod";
import { jsonResponse } from "mcp-shared";
import type { CoreOperation } from "../types.js";
import { listAvailableTables } from "../access-control.js";

interface DescribedField {
  name: string;
  type: string;
  nullable: boolean;
  default?: unknown;
  description?: string;
  pii?: boolean;
  piiReason?: string;
}

const argsSchema = z.object({
  table: z.string().describe("Logical table name (see list_tables)"),
});

export const describeTableOp: CoreOperation<z.infer<typeof argsSchema>> = {
  id: "describe_table",
  summary: "Show columns + types + PII flags for a table",
  detail: `Merges Layer 1 (structural metadata: type/nullable/default/PK)
with Layer 2 (selectable-fields: PII flags) for a single table. Fields with
\`pii: true\` are returned as \`"[REDACTED]"\` in query results (null stays null).

Note: DB-specific structural details (indexes, foreign keys, GSIs) are not
shown here — DB-specific tool factories may extend this op or expose them
via additional ops.`,
  category: "Discovery",
  argsSchema,
  execute: async ({ args, ctx }) => {
    const config = ctx.selectableFields[args.table];
    const metadata = ctx.tableMetadata[args.table];
    if (!config || !metadata) {
      return jsonResponse({
        error: `Table '${args.table}' is not selectable.`,
        availableTables: listAvailableTables(ctx.selectableFields),
      });
    }

    const fields: DescribedField[] = Object.entries(config.fields).map(([name, sel]) => {
      const meta = metadata.fields[name];
      const out: DescribedField = {
        name,
        type: meta?.type ?? "string",
        nullable: meta?.nullable ?? true,
      };
      if (meta?.default !== undefined) out.default = meta.default;
      if (meta?.description !== undefined) out.description = meta.description;
      if (sel.pii) out.pii = true;
      if (sel.piiReason !== undefined) out.piiReason = sel.piiReason;
      return out;
    });

    return jsonResponse({
      table: args.table,
      dbTableName: metadata.dbTableName,
      description: metadata.description ?? config.description,
      primaryKey: metadata.primaryKey,
      fields,
    });
  },
};
