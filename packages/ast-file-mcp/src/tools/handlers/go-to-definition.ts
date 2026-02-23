import { z } from "zod";
import { jsonResponse, errorResponse, getErrorMessage } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import {
  getHandler,
  getSupportedExtensions,
} from "../../handlers/index.js";

const GoToDefinitionSchema = z.object({
  file_path: z.string().describe("Absolute path to the Markdown file"),
  line: z.number().describe("Line number (1-based)"),
  column: z.number().describe("Column number (1-based)"),
});

type GoToDefinitionArgs = z.infer<typeof GoToDefinitionSchema>;

export class GoToDefinitionHandler extends BaseToolHandler<GoToDefinitionArgs> {
  readonly name = "go_to_definition";
  readonly schema = GoToDefinitionSchema;
  readonly description =
    "Go to definition: find where a link at the given position points to. For Markdown, resolves links to files and headings. Returns file path and line of the target.";

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the Markdown file",
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

  protected async doExecute(args: GoToDefinitionArgs): Promise<ToolResponse> {
    const { file_path, line, column } = args;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(
        `Unsupported file type. Supported: ${extensions.join(", ")}`
      );
    }

    // Polymorphism: handler throws if not supported
    try {
      const result = await handler.goToDefinition({
        filePath: file_path,
        line,
        column,
      });
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(
        getErrorMessage(error)
      );
    }
  }
}
