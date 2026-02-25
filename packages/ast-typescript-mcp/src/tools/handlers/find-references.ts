import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";

const FindReferencesSchema = z.object({
  file_path: z.string().describe("Absolute path to the TypeScript file containing the symbol definition"),
  line: z.number().describe("Line number of the symbol (1-based)"),
  column: z.number().describe("Column number of the symbol (1-based)"),
  scope_to_dependents: z
    .boolean()
    .optional()
    .default(false)
    .describe("Only search in packages that depend on the target package (monorepo optimization)"),
});

type FindReferencesArgs = z.infer<typeof FindReferencesSchema>;

export class FindReferencesHandler extends BaseToolHandler<FindReferencesArgs> {
  readonly name = "find_references";
  readonly description = `Find all references to a symbol across project.

## Can Do
- Find all usages of function/class/variable
- Returns file, line, column for each reference
- Works with imports/exports
- Monorepo optimization: scope_to_dependents

## Cannot Do
- Find string occurrences (use grep)
- Find in comments (use grep)

## Use Case: Batch Call Site Transform
1. \`ts_ast(action: "references", file_path: "src/foo.ts", line: 10, column: 5)\`
2. Use returned locations with \`batch\` + \`transform_call_site\`

## Example
\`\`\`json
ts_ast(action: "references", file_path: "src/handlers/base.ts", line: 15, column: 10)
\`\`\`
Returns: [{ file, line, column, context }, ...]`;
  readonly schema = FindReferencesSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the TypeScript file containing the symbol",
      },
      line: {
        type: "number",
        description: "Line number of the symbol (1-based)",
      },
      column: {
        type: "number",
        description: "Column number of the symbol (1-based)",
      },
      scope_to_dependents: {
        type: "boolean",
        description: "Only search in packages that depend on the target package (monorepo optimization)",
      },
    },
    required: ["file_path", "line", "column"],
  };

  protected async doExecute(args: FindReferencesArgs): Promise<ToolResponse> {
    const { file_path, line, column, scope_to_dependents } = args;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(`Unsupported file type. Supported: ${extensions.join(", ")}`);
    }

    const result = await handler.findReferences({ filePath: file_path, line: line, column: column, options: {
      scopeToDependents: scope_to_dependents,
    } });
    return jsonResponse(result);
  }
}
