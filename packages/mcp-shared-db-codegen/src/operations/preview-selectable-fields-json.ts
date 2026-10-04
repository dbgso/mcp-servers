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

export class PreviewSelectableFieldsJsonOp implements CodegenOperation<z.infer<typeof argsSchema>> {
  readonly id = "preview_selectable_fields_json";
  readonly summary = "Generate secure-by-default `selectable-fields.json` template";
  readonly detail = `Returns a pretty-printed JSON string for \`selectable-fields.json\`.
Every field starts as \`{ "select": "redact" }\` — the value is masked
in tool output until an operator flips it to \`"expose"\` after audit.
Fields that should never appear in query results at all use
\`"exclude"\`. Add a free-form \`"note"\` to capture the why.

Read-only.`;
  readonly category = "Read";
  readonly argsSchema = argsSchema;
  async execute({ args, ctx }: Parameters<CodegenOperation<z.infer<typeof argsSchema>>["execute"]>[0]) {
    const tables = await introspectAllTables({
      introspector: ctx.introspector,
      schema: args.schema,
      ...(args.tables !== undefined && { tables: args.tables }),
      ...(args.tableFilter !== undefined && { tableFilter: args.tableFilter }),
    });
    const source = formatSelectableFieldsJson(tables);
    return { content: [{ type: "text" as const, text: source }] };
  }
}

export const previewSelectableFieldsJsonOp = new PreviewSelectableFieldsJsonOp();
