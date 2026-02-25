import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";

const GoToTypeDefinitionSchema = z.object({
  file_path: z.string().describe("Absolute path to the TypeScript file"),
  line: z.number().describe("Line number (1-based)"),
  column: z.number().describe("Column number (1-based)"),
});

type GoToTypeDefinitionArgs = z.infer<typeof GoToTypeDefinitionSchema>;

export class GoToTypeDefinitionHandler extends BaseToolHandler<GoToTypeDefinitionArgs> {
  readonly name = "go_to_type_definition";
  readonly description = `Navigate to the type definition of a symbol.

## Can Do
- Find interface/type/class definition for a variable's type
- Navigate to type alias definitions
- Find enum definitions

## Cannot Do
- Find value definitions (use go_to_definition)
- Find implementations (use go_to_implementation)

## Example
\`\`\`json
ts_ast(action: "type_definition", file_path: "src/handler.ts", line: 10, column: 5)
\`\`\`
Input: cursor on \`const user: User = ...\`
Returns: location of \`interface User { ... }\``;
  readonly schema = GoToTypeDefinitionSchema;

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

  protected async doExecute(args: GoToTypeDefinitionArgs): Promise<ToolResponse> {
    const { file_path, line, column } = args;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(`Unsupported file type. Supported: ${extensions.join(", ")}`);
    }

    const result = await handler.goToTypeDefinition({ filePath: file_path, line, column });
    return jsonResponse(result);
  }
}
