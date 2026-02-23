import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import {
  getHandler,
  getSupportedExtensions,
} from "../../handlers/index.js";

const TocGenerateSchema = z.object({
  file_path: z
    .string()
    .describe("Absolute path to the Markdown or AsciiDoc file"),
  depth: z
    .number()
    .optional()
    .describe(
      "Maximum heading depth to include (e.g., 2 = h1 and h2 only)"
    ),
});

type TocGenerateArgs = z.infer<typeof TocGenerateSchema>;

export class TocGenerateHandler extends BaseToolHandler<TocGenerateArgs> {
  readonly name = "toc_generate";
  readonly schema = TocGenerateSchema;
  readonly description =
    "Generate a table of contents from a Markdown or AsciiDoc file. Returns a TOC string in the same format as the input file (Markdown links or AsciiDoc xrefs).";

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the Markdown or AsciiDoc file",
      },
      depth: {
        type: "number",
        description:
          "Maximum heading depth to include (e.g., 2 = h1 and h2 only)",
      },
    },
    required: ["file_path"],
  };

  protected async doExecute(args: TocGenerateArgs): Promise<ToolResponse> {
    const { file_path, depth } = args;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(
        `Unsupported file type. Supported: ${extensions.join(", ")}`
      );
    }

    // Polymorphism: all handlers implement generateToc
    const toc = await handler.generateToc({ filePath: file_path, maxDepth: depth });
    return jsonResponse({ filePath: file_path, toc });
  }
}
