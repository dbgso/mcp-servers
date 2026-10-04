import { z } from "zod";
import { DEFAULT_LIMIT, MAX_LIMIT, executeFindByEq } from "./find-by-eq.js";
import type { DatabaseOperation } from "./types.js";

const argsSchema = z.object({
  table: z.string().describe("Logical table name"),
  column: z.string().describe("Indexed column name (JS field name)"),
  value: z.union([z.string(), z.number(), z.boolean()]).describe("Filter value"),
  limit: z.number().int().positive().max(MAX_LIMIT).optional(),
});

export class GetByIndexOp implements DatabaseOperation<z.infer<typeof argsSchema>> {
  readonly id = "get_by_index";
  readonly summary = "Fetch rows by an indexed non-PK / non-FK column";
  readonly detail = `Filter rows by a column that is neither the primary key nor a foreign key —
useful for status enums, idempotency keys, lookup attributes etc.
Caller is responsible for picking a column that actually has an index.
PII fields are redacted as \`"[REDACTED]"\`.`;
  readonly category = "Read";
  readonly argsSchema = argsSchema;
  async execute({ args, ctx }: Parameters<DatabaseOperation<z.infer<typeof argsSchema>>["execute"]>[0]) {
    return executeFindByEq({ args, ctx });
  }
}

export const getByIndexOp = new GetByIndexOp();
