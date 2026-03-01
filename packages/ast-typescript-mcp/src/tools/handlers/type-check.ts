import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";

const TypeCheckSchema = z.object({
  file_path: z
    .string()
    .describe("Absolute path to the TypeScript file to type check"),
  include_suggestions: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include suggestion diagnostics (default: false)"),
});

type TypeCheckArgs = z.infer<typeof TypeCheckSchema>;

export class TypeCheckHandler extends BaseToolHandler<TypeCheckArgs> {
  readonly name = "type_check";
  readonly description =
    "Type check a TypeScript file and return diagnostics (errors, warnings, suggestions). Useful for checking type errors before building.";
  readonly schema = TypeCheckSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the TypeScript file to type check",
      },
      include_suggestions: {
        type: "boolean",
        description: "Include suggestion diagnostics (default: false)",
      },
    },
    required: ["file_path"],
  };

  protected async doExecute(args: TypeCheckArgs): Promise<ToolResponse> {
    const { file_path, include_suggestions } = args;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(
        `Unsupported file type. Supported: ${extensions.join(", ")}`
      );
    }

    const result = await handler.typeCheck({
      filePath: file_path,
      includeSuggestions: include_suggestions,
    });
    return jsonResponse(result);
  }
}
