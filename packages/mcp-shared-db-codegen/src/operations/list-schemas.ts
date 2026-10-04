import { z } from "zod";
import { jsonResponse } from "mcp-shared";
import type { CodegenOperation } from "./types.js";

export class ListSchemasOp implements CodegenOperation<Record<string, never>> {
  readonly id = "list_schemas";
  readonly summary = "List user-visible schemas in the connected database";
  readonly detail = `Returns every non-system schema (postgres: excludes \`pg_*\` and
\`information_schema\`). Use this first to discover where the application
tables live, then call \`list_tables\` against a specific schema.`;
  readonly category = "Discovery";
  readonly argsSchema = z.object({});
  async execute({ ctx }: Parameters<CodegenOperation<Record<string, never>>["execute"]>[0]) {
    const schemas = await ctx.introspector.listSchemas();
    return jsonResponse({ count: schemas.length, schemas });
  }
}

export const listSchemasOp = new ListSchemasOp();
