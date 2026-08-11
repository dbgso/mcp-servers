import { z } from "zod";
import { jsonResponse } from "mcp-shared";
import type { DatabaseOperation } from "./types.js";

const argsSchema = z.object({
  sql: z
    .string()
    .min(1, "sql must be a non-empty string")
    .describe(
      "Arbitrary SQL to explain. Will be wrapped with the engine's EXPLAIN prefix and never executed for real (no ANALYZE).",
    ),
  params: z
    .array(z.unknown())
    .optional()
    .describe(
      "Optional bind values for parameterised SQL ($1 / ? placeholders, driver-specific).",
    ),
  verbose: z
    .boolean()
    .optional()
    .describe(
      "Include the raw plan tree. Off by default to avoid leaking index / partition / column-stat details.",
    ),
});

export const explainSqlOp: DatabaseOperation<z.infer<typeof argsSchema>> = {
  id: "explain_sql",
  summary: "EXPLAIN an arbitrary SQL string without executing it",
  detail: `Wraps the input SQL with the engine's \`EXPLAIN\` prefix (no ANALYZE)
so the query is parsed + planned but **never executed**. SELECT / DML
(\`INSERT\` / \`UPDATE\` / \`DELETE\`) and \`CREATE TABLE AS\` come back as
plan only. Pure DDL (\`DROP TABLE\`, \`ALTER\`, \`TRUNCATE\`) errors at parse
— it isn't executed either way. Useful for sizing a query before
calling \`get_by_*\` ops, or for ad-hoc cost analysis.

**Whitelist boundary**: this op intentionally bypasses the
\`selectableFields\` whitelist. \`selectableFields\` is a *row-data*
ACL, not a *schema-discovery* ACL — table / column / index names visible
to the DB role can be revealed through plan output. The DB role is the
real boundary: any table the role can SELECT, this op can EXPLAIN.
Operators must restrict the role to tables that may be revealed.

\`params\` are bound via the driver's parameterised path, so multi-statement
injection (\`SELECT 1; DROP TABLE x\`) is rejected at the wire.

Defaults to a compact response (\`estimatedRows\` / \`totalCost\` /
\`planSummary\`); pass \`verbose: true\` to also receive the raw plan tree.`,
  category: "Discovery",
  argsSchema,
  execute: async ({ args, ctx }) => {
    const result = await ctx.dataSource.explainSql({ sql: args.sql, params: args.params ?? [] });
    const response: Record<string, unknown> = {
      estimatedRows: result.estimatedRows,
      totalCost: result.totalCost,
      planSummary: result.planSummary,
    };
    if (args.verbose === true) {
      response.raw = result.raw;
    }
    return jsonResponse(response);
  },
};
