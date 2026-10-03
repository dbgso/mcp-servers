import { z } from "zod";
import { jsonResponse } from "mcp-shared";
import type { CodegenOperation } from "./types.js";

const argsSchema = z.object({
  schema: z.string().min(1).describe("Schema name (e.g. 'public')"),
});

export class ListTablesOp implements CodegenOperation<z.infer<typeof argsSchema>> {
  readonly id = "list_tables";
  readonly summary = "List BASE TABLEs in the given schema";
  readonly detail = `Returns each table's name, optional description, and approximate row count
(when the catalog has stats). Views and other relkinds are excluded.`;
  readonly category = "Discovery";
  readonly argsSchema = argsSchema;
  execute: CodegenOperation<z.infer<typeof argsSchema>>["execute"] = async ({ args, ctx }) => {
    const tables = await ctx.introspector.listTables(args.schema);
    return jsonResponse({ schema: args.schema, count: tables.length, tables });
  };
}

export const listTablesOp = new ListTablesOp();
