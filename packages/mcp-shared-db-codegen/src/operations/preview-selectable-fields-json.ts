import { z } from "zod";
import type { CodegenOperation } from "./types.js";
import { introspectAllTables } from "./introspect-all-helper.js";
import { formatSelectableFieldsJson } from "../format/selectable-fields-json.js";

const argsSchema = z.object({
  schema: z.string().min(1).describe("Schema name"),
  tables: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe("Explicit list of table names. Omit to include every table in the schema."),
  tableFilter: z
    .string()
    .min(1)
    .optional()
    .describe("Case-insensitive substring filter (ignored when `tables` is provided)"),
});

export const previewSelectableFieldsJsonOp: CodegenOperation<z.infer<typeof argsSchema>> = {
  id: "preview_selectable_fields_json",
  summary: "Generate secure-by-default `selectable-fields.json` template",
  detail: `Returns a pretty-printed JSON string for \`selectable-fields.json\`.
Every field starts as \`{ "select": "redact" }\` — the value is masked
in tool output until an operator flips it to \`"expose"\` after audit.
Fields that should never appear in query results at all use
\`"exclude"\`. Add a free-form \`"note"\` to capture the why.

Read-only.`,
  category: "Read",
  argsSchema,
  execute: async ({ args, ctx }) => {
    const tables = await introspectAllTables({
      introspector: ctx.introspector,
      schema: args.schema,
      ...(args.tables !== undefined && { tables: args.tables }),
      ...(args.tableFilter !== undefined && { tableFilter: args.tableFilter }),
    });
    const source = formatSelectableFieldsJson(tables);
    return { content: [{ type: "text" as const, text: source }] };
  },
};
