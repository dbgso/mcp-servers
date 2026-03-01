import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";

const InlineTypeSchema = z.object({
  file_path: z.string().describe("Absolute path to the TypeScript file"),
  line: z.number().describe("Line number (1-based)"),
  column: z.number().describe("Column number (1-based)"),
});

type InlineTypeArgs = z.infer<typeof InlineTypeSchema>;

export class InlineTypeHandler extends BaseToolHandler<InlineTypeArgs> {
  readonly name = "inline_type";
  readonly description =
    "Expand and inline the type at the given position. Returns both the original type alias name and the fully expanded type definition. Note: Primitive type aliases (e.g., type int = number) may not expand due to TypeScript compiler optimization.";
  readonly schema = InlineTypeSchema;

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

  protected async doExecute(args: InlineTypeArgs): Promise<ToolResponse> {
    const { file_path, line, column } = args;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(
        `Unsupported file type. Supported: ${extensions.join(", ")}`
      );
    }

    const result = await handler.inlineType({
      filePath: file_path,
      line,
      column,
    });
    return jsonResponse(result);
  }
}
