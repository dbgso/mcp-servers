import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "mcp-shared";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";

const WriteSchema = z.object({
  file_path: z.string().describe("Absolute path to the file to write"),
  ast: z.unknown().describe("AST object to write"),
});

type WriteArgs = z.infer<typeof WriteSchema>;

export class AstWriteHandler extends BaseToolHandler<WriteArgs> {
  readonly name = "ast_write";
  readonly schema = WriteSchema;
  readonly description = "Write an AST back to a file. Supports Markdown and AsciiDoc files.";

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the file to write",
      },
      ast: {
        type: "object",
        description: "AST object to write",
      },
    },
    required: ["file_path", "ast"],
  };

  protected async doExecute(args: WriteArgs): Promise<ToolResponse> {
    const { file_path, ast } = args;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(
        `Unsupported file type. Supported: ${extensions.join(", ")}`
      );
    }

    if (!handler.write) {
      return errorResponse(`Write not supported for ${handler.fileType} files`);
    }

    await handler.write({ filePath: file_path, ast });
    return jsonResponse({ success: true, filePath: file_path });
  }
}
