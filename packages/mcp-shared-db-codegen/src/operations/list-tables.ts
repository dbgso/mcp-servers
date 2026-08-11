import { z } from "zod";
import { jsonResponse } from "mcp-shared";
import type { CodegenOperation } from "./types.js";

const argsSchema = z.object({
  schema: z.string().min(1).describe("Schema name (e.g. 'public')"),
});

export const listTablesOp: CodegenOperation<z.infer<typeof argsSchema>> = {
  id: "list_tables",
  summary: "List BASE TABLEs in the given schema",
  detail: `Returns each table's name, optional description, and approximate row count
(when the catalog has stats). Views and other relkinds are excluded.`,
  category: "Discovery",
  argsSchema,
  execute: async ({ args, ctx }) => {
    const tables = await ctx.introspector.listTables(args.schema);
    return jsonResponse({ schema: args.schema, count: tables.length, tables });
  },
};
