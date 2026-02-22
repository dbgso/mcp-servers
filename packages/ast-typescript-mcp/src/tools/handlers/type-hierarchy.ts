import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";

const TypeHierarchySchema = z.object({
  file_path: z.string().describe("Absolute path to the TypeScript file"),
  line: z.number().describe("Line number of the class/interface (1-based)"),
  column: z.number().describe("Column number (1-based)"),
  direction: z.enum(["ancestors", "descendants", "both"]).optional().default("both").describe("Direction to traverse: ancestors (base types), descendants (derived types), both (default)"),
  max_depth: z.number().optional().default(10).describe("Maximum depth to traverse (default: 10)"),
  include_external: z.boolean().optional().default(false).describe("Include types from node_modules (default: false)"),
});

type TypeHierarchyArgs = z.infer<typeof TypeHierarchySchema>;

export class TypeHierarchyHandler extends BaseToolHandler<TypeHierarchyArgs> {
  readonly name = "type_hierarchy";
  readonly description = "Get the type hierarchy for a class or interface. Traces inheritance relationships (extends, implements) in the specified direction.";
  readonly schema = TypeHierarchySchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the TypeScript file",
      },
      line: {
        type: "number",
        description: "Line number of the class/interface (1-based)",
      },
      column: {
        type: "number",
        description: "Column number (1-based)",
      },
      direction: {
        type: "string",
        enum: ["ancestors", "descendants", "both"],
        description: "Direction to traverse: ancestors (base types), descendants (derived types), both (default)",
      },
      max_depth: {
        type: "number",
        description: "Maximum depth to traverse (default: 10)",
      },
      include_external: {
        type: "boolean",
        description: "Include types from node_modules (default: false)",
      },
    },
    required: ["file_path", "line", "column"],
  };

  protected async doExecute(args: TypeHierarchyArgs): Promise<ToolResponse> {
    const { file_path, line, column, direction, max_depth, include_external } = args;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(`Unsupported file type. Supported: ${extensions.join(", ")}`);
    }

    const result = await handler.getTypeHierarchy({
      filePath: file_path,
      line,
      column,
      direction,
      maxDepth: max_depth,
      includeExternal: include_external,
    });
    return jsonResponse(result);
  }
}
