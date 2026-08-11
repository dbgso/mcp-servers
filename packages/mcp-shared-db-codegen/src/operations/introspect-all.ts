import { z } from "zod";
import { jsonResponse } from "mcp-shared";
import type { CodegenOperation } from "./types.js";
import { introspectAllTables } from "./introspect-all-helper.js";

const argsSchema = z.object({
  schema: z.string().min(1).describe("Schema name"),
  tableFilter: z
    .string()
    .min(1)
    .optional()
    .describe("Case-insensitive substring filter applied to table names"),
});

export const introspectAllOp: CodegenOperation<z.infer<typeof argsSchema>> = {
  id: "introspect_all",
  summary: "Introspect every table in a schema (optionally filtered by name)",
  detail: `Calls \`introspect_table\` for each table returned by \`list_tables\`.
Use \`tableFilter\` to scope to a subset (e.g. \`"user"\`). Output is an array of
\`RawTableMetadata\`. For very large schemas, prefer running \`list_tables\` first.`,
  category: "Read",
  argsSchema,
  execute: async ({ args, ctx }) => {
    const tables = await introspectAllTables({
      introspector: ctx.introspector,
      schema: args.schema,
      ...(args.tableFilter !== undefined && { tableFilter: args.tableFilter }),
    });
    return jsonResponse({ schema: args.schema, count: tables.length, tables });
  },
};
