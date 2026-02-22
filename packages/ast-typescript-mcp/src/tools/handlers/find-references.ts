import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";

const FindReferencesSchema = z.object({
  file_path: z.string().describe("Absolute path to the TypeScript file containing the symbol definition"),
  line: z.number().describe("Line number of the symbol (1-based)"),
  column: z.number().describe("Column number of the symbol (1-based)"),
});

type FindReferencesArgs = z.infer<typeof FindReferencesSchema>;

export class FindReferencesHandler extends BaseToolHandler<FindReferencesArgs> {
  readonly name = "find_references";
  readonly description = "Find all references to a symbol. Uses git grep for fast file search, then parses candidates to verify actual references. Returns file paths, lines, and context of each reference.";
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
    },
    required: ["file_path", "line", "column"],
  };

  protected async doExecute(args: FindReferencesArgs): Promise<ToolResponse> {
    const { file_path, line, column } = args;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(`Unsupported file type. Supported: ${extensions.join(", ")}`);
    }

    const result = await handler.findReferences(file_path, line, column);
    return jsonResponse(result);
  }
}
