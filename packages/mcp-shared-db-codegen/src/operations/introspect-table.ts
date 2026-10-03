import { z } from "zod";
import { jsonResponse } from "mcp-shared";
import type { CodegenOperation } from "./types.js";

const argsSchema = z.object({
  schema: z.string().min(1).describe("Schema name (e.g. 'public')"),
  table: z.string().min(1).describe("Table name within the schema"),
});

export class IntrospectTableOp implements CodegenOperation<z.infer<typeof argsSchema>> {
  readonly id = "introspect_table";
  readonly summary = "Read columns / PK / indexes / foreign keys for a single table";
  readonly detail = `Returns a \`RawTableMetadata\` object with columns (native + mapped types,
nullability, defaults, descriptions), primary key, indexes, and foreign keys.
Use \`introspect_all\` to fetch every table in a schema at once.`;
  readonly category = "Read";
  readonly argsSchema = argsSchema;
  execute: CodegenOperation<z.infer<typeof argsSchema>>["execute"] = async ({ args, ctx }) => {
    const metadata = await ctx.introspector.introspectTable({
      schema: args.schema,
      table: args.table,
    });
    return jsonResponse(metadata);
  };
}

export const introspectTableOp = new IntrospectTableOp();
