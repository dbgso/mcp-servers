import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";

const HoverSchema = z.object({
  file_path: z.string().describe("Absolute path to the TypeScript file"),
  line: z.number().describe("Line number (1-based)"),
  column: z.number().describe("Column number (1-based)"),
});

type HoverArgs = z.infer<typeof HoverSchema>;

export class HoverHandler extends BaseToolHandler<HoverArgs> {
  readonly name = "hover";
  readonly description = `Get type information and documentation for a symbol at a given position.

## Can Do
- Show type of variable/parameter/property at cursor
- Show function/method signature with parameter types and return type
- Show JSDoc documentation if available
- Show JSDoc tags (@param, @returns, @example, etc.)

## Cannot Do
- Show completion suggestions (use IDE)
- Show signature help during call (use IDE)
- Modify code

## Example
\`\`\`
ts_ast(action: "hover", file_path: "src/index.ts", line: 10, column: 15)
\`\`\`

Returns type info and docs for the symbol at line 10, column 15.`;

  readonly schema = HoverSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the TypeScript file",
      },
      line: {
        type: "number",
        description: "Line number (1-based)",
      },
      column: {
        type: "number",
        description: "Column number (1-based)",
      },
    },
    required: ["file_path", "line", "column"],
  };

  protected async doExecute(args: HoverArgs): Promise<ToolResponse> {
    const { file_path, line, column } = args;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(`Unsupported file type. Supported: ${extensions.join(", ")}`);
    }

    const result = await handler.hover({ filePath: file_path, line, column });
    return jsonResponse(result);
  }
}
