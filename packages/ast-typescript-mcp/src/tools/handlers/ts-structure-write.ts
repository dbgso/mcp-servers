import { z } from "zod";
import type { SourceFileStructure } from "ts-morph";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";

const WriteSchema = z.object({
  file_path: z.string().describe("Absolute path to the TypeScript file to write"),
  structure: z.unknown().describe("SourceFileStructure object from ts-morph"),
});

type WriteArgs = z.infer<typeof WriteSchema>;

export class TsStructureWriteHandler extends BaseToolHandler<WriteArgs> {
  readonly name = "ts_structure_write";
  readonly description = "Write a ts-morph Structure back to a TypeScript file.";
  readonly schema = WriteSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the TypeScript file to write",
      },
      structure: {
        type: "object",
        description: "SourceFileStructure object from ts-morph",
      },
    },
    required: ["file_path", "structure"],
  };

  protected async doExecute(args: WriteArgs): Promise<ToolResponse> {
    const { file_path, structure } = args;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(`Unsupported file type. Supported: ${extensions.join(", ")}`);
    }

    await handler.write(file_path, structure as SourceFileStructure);
    return jsonResponse({ success: true, filePath: file_path });
  }
}
