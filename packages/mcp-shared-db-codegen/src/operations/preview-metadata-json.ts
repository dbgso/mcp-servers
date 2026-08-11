import { z } from "zod";
import type { CodegenOperation } from "./types.js";
import { introspectAllTables } from "./introspect-all-helper.js";
import { formatMetadataJson } from "../format/metadata-json.js";

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

export const previewMetadataJsonOp: CodegenOperation<z.infer<typeof argsSchema>> = {
  id: "preview_metadata_json",
  summary: "Generate `metadata.json` for the requested tables (no file write)",
  detail: `Returns a pretty-printed JSON string the caller can save as
\`metadata.json\`. Each field carries \`type\` (GenericFieldType),
\`nullable\`, and \`nativeType\` (the original DB type so reviewers can
sanity-check the mapping).

Read-only — does not write to disk.`,
  category: "Read",
  argsSchema,
  execute: async ({ args, ctx }) => {
    const tables = await introspectAllTables({
      introspector: ctx.introspector,
      schema: args.schema,
      ...(args.tables !== undefined && { tables: args.tables }),
      ...(args.tableFilter !== undefined && { tableFilter: args.tableFilter }),
    });
    const source = formatMetadataJson(tables);
    // The op response is a single text block; the body is the raw JSON
    // string ready to be written to disk. We do NOT wrap it in jsonResponse
    // because that would double-encode.
    return { content: [{ type: "text" as const, text: source }] };
  },
};
