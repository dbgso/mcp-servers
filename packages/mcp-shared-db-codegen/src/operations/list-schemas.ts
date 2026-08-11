import { z } from "zod";
import { jsonResponse } from "mcp-shared";
import type { CodegenOperation } from "./types.js";

export const listSchemasOp: CodegenOperation<Record<string, never>> = {
  id: "list_schemas",
  summary: "List user-visible schemas in the connected database",
  detail: `Returns every non-system schema (postgres: excludes \`pg_*\` and
\`information_schema\`). Use this first to discover where the application
tables live, then call \`list_tables\` against a specific schema.`,
  category: "Discovery",
  argsSchema: z.object({}),
  execute: async ({ ctx }) => {
    const schemas = await ctx.introspector.listSchemas();
    return jsonResponse({ count: schemas.length, schemas });
  },
};
