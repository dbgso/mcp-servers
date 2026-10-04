import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler, looseBoolean, looseNumber } from "mcp-shared";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";

const CallGraphSchema = z.object({
  file_path: z.string().describe("Absolute path to the TypeScript file"),
  line: looseNumber(z.number().describe("Line number of the function/method (1-based)")),
  column: looseNumber(z.number().describe("Column number (1-based)")),
  max_depth: looseNumber(z.number().optional().default(5).describe("Maximum depth to traverse (default: 5)")),
  include_external: looseBoolean(z.boolean().optional().default(false).describe("Include calls to node_modules (default: false)")),
});

type CallGraphArgs = z.infer<typeof CallGraphSchema>;

export class CallGraphHandler extends BaseToolHandler<CallGraphArgs> {
  readonly name = "call_graph";
  readonly description = "Generate a call graph starting from a function/method. Traces outgoing calls recursively and returns a graph structure with Mermaid visualization.";
  readonly schema = CallGraphSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the TypeScript file",
      },
      line: {
        type: "number",
        description: "Line number of the function/method (1-based)",
      },
      column: {
        type: "number",
        description: "Column number (1-based)",
      },
      max_depth: {
        type: "number",
        description: "Maximum depth to traverse (default: 5)",
      },
      include_external: {
        type: "boolean",
        description: "Include calls to node_modules (default: false)",
      },
    },
    required: ["file_path", "line", "column"],
  };

  protected async doExecute(args: CallGraphArgs): Promise<ToolResponse> {
    const { file_path, line, column, max_depth, include_external } = args;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(`Unsupported file type. Supported: ${extensions.join(", ")}`);
    }

    const result = await handler.getCallGraph({
      filePath: file_path,
      line,
      column,
      maxDepth: max_depth,
      includeExternal: include_external,
    });
    return jsonResponse(result);
  }
}
