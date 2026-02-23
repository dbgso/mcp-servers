import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import {
  getHandler,
  getSupportedExtensions,
} from "../../handlers/index.js";

const DiffStructureSchema = z.object({
  file_path_a: z.string().describe("Absolute path to the first file"),
  file_path_b: z.string().describe("Absolute path to the second file"),
  level: z
    .enum(["summary", "detailed"])
    .optional()
    .default("summary")
    .describe(
      "Comparison level: summary (depth+text) or detailed (includes line numbers)"
    ),
});

type DiffStructureArgs = z.infer<typeof DiffStructureSchema>;

export class DiffStructureHandler extends BaseToolHandler<DiffStructureArgs> {
  readonly name = "diff_structure";
  readonly schema = DiffStructureSchema;
  readonly description =
    "Compare structure of two Markdown or AsciiDoc files. Returns added, removed, and modified headings. Level: summary (depth+text) or detailed (includes line numbers).";

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path_a: {
        type: "string",
        description: "Absolute path to the first file",
      },
      file_path_b: {
        type: "string",
        description: "Absolute path to the second file",
      },
      level: {
        type: "string",
        enum: ["summary", "detailed"],
        description:
          "Comparison level: summary (depth+text) or detailed (includes line numbers)",
      },
    },
    required: ["file_path_a", "file_path_b"],
  };

  protected async doExecute(args: DiffStructureArgs): Promise<ToolResponse> {
    const { file_path_a, file_path_b, level } = args;

    const handlerA = getHandler(file_path_a);

    if (!handlerA) {
      const extensions = getSupportedExtensions();
      return errorResponse(
        `Unsupported file type. Supported: ${extensions.join(", ")}`
      );
    }

    // Polymorphism: all handlers implement diffStructure
    const result = await handlerA.diffStructure({
      filePathA: file_path_a,
      filePathB: file_path_b,
      level,
    });

    return jsonResponse(result);
  }
}
