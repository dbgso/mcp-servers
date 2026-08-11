import { z } from "zod";
import { jsonResponse } from "mcp-shared";
import type { CodegenOperation } from "./types.js";

const argsSchema = z.object({
  schema: z.string().min(1).describe("Schema name (e.g. 'public')"),
  table: z.string().min(1).describe("Table name within the schema"),
});

export const introspectTableOp: CodegenOperation<z.infer<typeof argsSchema>> = {
  id: "introspect_table",
  summary: "Read columns / PK / indexes / foreign keys for a single table",
  detail: `Returns a \`RawTableMetadata\` object with columns (native + mapped types,
nullability, defaults, descriptions), primary key, indexes, and foreign keys.
Use \`introspect_all\` to fetch every table in a schema at once.`,
  category: "Read",
  argsSchema,
  execute: async ({ args, ctx }) => {
    const metadata = await ctx.introspector.introspectTable({
      schema: args.schema,
      table: args.table,
    });
    return jsonResponse(metadata);
  },
};
