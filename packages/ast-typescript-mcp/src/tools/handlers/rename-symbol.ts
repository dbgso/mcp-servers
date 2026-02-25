import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";

const RenameSymbolSchema = z.object({
  file_path: z.string().describe("Absolute path to the TypeScript file containing the symbol"),
  line: z.number().describe("Line number of the symbol (1-based)"),
  column: z.number().describe("Column number of the symbol (1-based)"),
  new_name: z.string().describe("New name for the symbol"),
  dry_run: z.boolean().optional().default(true).describe("Preview changes without modifying files (default: true)"),
});

type RenameSymbolArgs = z.infer<typeof RenameSymbolSchema>;

export class RenameSymbolHandler extends BaseToolHandler<RenameSymbolArgs> {
  readonly name = "rename_symbol";
  readonly description = `Rename a symbol across all files in project.

## Can Do
- Rename variables, functions, classes, interfaces
- Updates all references automatically
- Works across multiple files
- Preserves types and imports

## Cannot Do
- Rename string literals (use grep/sed)
- Rename comments (use grep/sed)
- Cross-project renames

## Workflow
1. Preview: \`dry_run: true\` (default) - see all affected locations
2. Apply: \`dry_run: false\` - perform rename

## Example
\`\`\`json
ts_ast(action: "rename", file_path: "src/foo.ts", line: 5, column: 10, new_name: "newName", dry_run: false)
\`\`\``;
  readonly schema = RenameSymbolSchema;

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
      new_name: {
        type: "string",
        description: "New name for the symbol",
      },
      dry_run: {
        type: "boolean",
        description: "Preview changes without modifying files (default: true)",
      },
    },
    required: ["file_path", "line", "column", "new_name"],
  };

  protected async doExecute(args: RenameSymbolArgs): Promise<ToolResponse> {
    const { file_path, line, column, new_name, dry_run } = args;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(`Unsupported file type. Supported: ${extensions.join(", ")}`);
    }

    const result = await handler.renameSymbol({
      filePath: file_path,
      line,
      column,
      newName: new_name,
      dryRun: dry_run,
    });
    return jsonResponse(result);
  }
}
