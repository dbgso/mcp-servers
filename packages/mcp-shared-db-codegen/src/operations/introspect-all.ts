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

export class IntrospectAllOp implements CodegenOperation<z.infer<typeof argsSchema>> {
  readonly id = "introspect_all";
  readonly summary = "Introspect every table in a schema (optionally filtered by name)";
  readonly detail = `Calls \`introspect_table\` for each table returned by \`list_tables\`.
Use \`tableFilter\` to scope to a subset (e.g. \`"user"\`). Output is an array of
\`RawTableMetadata\`. For very large schemas, prefer running \`list_tables\` first.`;
  readonly category = "Read";
  readonly argsSchema = argsSchema;
  execute: CodegenOperation<z.infer<typeof argsSchema>>["execute"] = async ({ args, ctx }) => {
    const tables = await introspectAllTables({
      introspector: ctx.introspector,
      schema: args.schema,
      ...(args.tableFilter !== undefined && { tableFilter: args.tableFilter }),
    });
    return jsonResponse({ schema: args.schema, count: tables.length, tables });
  };
}

export const introspectAllOp = new IntrospectAllOp();
