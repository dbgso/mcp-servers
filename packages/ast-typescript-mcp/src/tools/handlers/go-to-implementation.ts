import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";

const GoToImplementationSchema = z.object({
  file_path: z.string().describe("Absolute path to the TypeScript file"),
  line: z.number().describe("Line number (1-based)"),
  column: z.number().describe("Column number (1-based)"),
});

type GoToImplementationArgs = z.infer<typeof GoToImplementationSchema>;

export class GoToImplementationHandler extends BaseToolHandler<GoToImplementationArgs> {
  readonly name = "go_to_implementation";
  readonly description = `Find implementations of interfaces, abstract classes, or abstract methods.

## Can Do
- Find classes implementing an interface
- Find classes extending an abstract class
- Find methods overriding an abstract method

## Cannot Do
- Find usages (use find_references)
- Find type definitions (use go_to_type_definition)

## Example
\`\`\`json
ts_ast(action: "implementation", file_path: "src/types.ts", line: 5, column: 10)
\`\`\`
Returns: [{ filePath, line, column, name, kind, preview }, ...]`;
  readonly schema = GoToImplementationSchema;

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

  protected async doExecute(args: GoToImplementationArgs): Promise<ToolResponse> {
    const { file_path, line, column } = args;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(`Unsupported file type. Supported: ${extensions.join(", ")}`);
    }

    const result = await handler.goToImplementation({ filePath: file_path, line, column });
    return jsonResponse(result);
  }
}
