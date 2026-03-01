import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";

const DiffStructureSchema = z.object({
  file_path_a: z.string().describe("Absolute path to the first TypeScript file"),
  file_path_b: z.string().describe("Absolute path to the second TypeScript file"),
  level: z.enum(["summary", "detailed"]).optional().default("summary").describe("Comparison level: summary (name+kind) or detailed (includes properties)"),
});

type DiffStructureArgs = z.infer<typeof DiffStructureSchema>;

export class DiffStructureHandler extends BaseToolHandler<DiffStructureArgs> {
  readonly name = "diff_structure";
  readonly description = "Compare structure of two TypeScript files. Returns added, removed, and modified declarations. Level: summary (name+kind) or detailed (includes exported status, member count).";
  readonly schema = DiffStructureSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path_a: {
        type: "string",
        description: "Absolute path to the first TypeScript file",
      },
      file_path_b: {
        type: "string",
        description: "Absolute path to the second TypeScript file",
      },
      level: {
        type: "string",
        enum: ["summary", "detailed"],
        description: "Comparison level: summary (name+kind) or detailed (includes properties)",
      },
    },
    required: ["file_path_a", "file_path_b"],
  };

  protected async doExecute(args: DiffStructureArgs): Promise<ToolResponse> {
    const { file_path_a, file_path_b, level } = args;
    const handlerA = getHandler(file_path_a);
    const handlerB = getHandler(file_path_b);

    if (!handlerA || !handlerB) {
      const extensions = getSupportedExtensions();
      return errorResponse(`Unsupported file type. Supported: ${extensions.join(", ")}`);
    }

    const result = await handlerA.diffStructure({
      filePathA: file_path_a,
      filePathB: file_path_b,
      level,
    });
    return jsonResponse(result);
  }
}
