import { z } from "zod";
import { DEFAULT_LIMIT, MAX_LIMIT, executeFindByEq } from "./find-by-eq.js";
import type { DatabaseOperation } from "./types.js";

const argsSchema = z.object({
  table: z.string().describe("Logical table name"),
  column: z.string().describe("Foreign-key column name in JS form (e.g. 'productId')"),
  value: z.union([z.string(), z.number()]).describe("Foreign-key value to filter by"),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .optional()
    .describe(`Max rows (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`),
});

export class GetByFkOp implements DatabaseOperation<z.infer<typeof argsSchema>> {
  readonly id = "get_by_fk";
  readonly summary = "Fetch rows referencing a related record (foreign-key lookup)";
  readonly detail = `Filters rows by a foreign-key column. Use this when you have an ID of a parent
record and want every child row that points at it.
Returns up to \`limit\` rows. PII fields are redacted as \`"[REDACTED]"\`.`;
  readonly category = "Read";
  readonly argsSchema = argsSchema;
  async execute({ args, ctx }: Parameters<DatabaseOperation<z.infer<typeof argsSchema>>["execute"]>[0]) {
    return executeFindByEq({ args, ctx });
  }
}

export const getByFkOp = new GetByFkOp();
