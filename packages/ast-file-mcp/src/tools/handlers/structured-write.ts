import { z } from "zod";
import { jsonResponse } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "mcp-shared";
import { MarkdownHandler, AsciidocHandler } from "../../handlers/index.js";

const StructuredWriteSchema = z.object({
  output_format: z
    .enum(["markdown", "asciidoc"])
    .describe("Output format: markdown or asciidoc"),
  format: z
    .enum(["table", "section", "list", "code"])
    .describe("Content format: table, section, list, or code"),
  data: z
    .unknown()
    .describe(
      "Data for the format. table: array of objects [{col1: val1, ...}]. section: {heading, depth?, content?}. list: {items: string[], ordered?: boolean}. code: {content, lang?}"
    ),
});

type StructuredWriteArgs = z.infer<typeof StructuredWriteSchema>;

export class StructuredWriteHandler extends BaseToolHandler<StructuredWriteArgs> {
  readonly name = "structured_write";
  readonly schema = StructuredWriteSchema;
  readonly description =
    "Convert structured JSON data to Markdown or AsciiDoc text. Supports: table (array of objects), section (heading with content), list (ordered/unordered), code (with language).";

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      output_format: {
        type: "string",
        enum: ["markdown", "asciidoc"],
        description: "Output format: markdown or asciidoc",
      },
      format: {
        type: "string",
        enum: ["table", "section", "list", "code"],
        description: "Content format: table, section, list, or code",
      },
      data: {
        type: "object",
        description:
          "Data for the format. table: array of objects [{col1: val1, ...}]. section: {heading, depth?, content?}. list: {items: string[], ordered?: boolean}. code: {content, lang?}",
      },
    },
    required: ["output_format", "format", "data"],
  };

  protected async doExecute(args: StructuredWriteArgs): Promise<ToolResponse> {
    const { output_format, format, data } = args;

    const handler =
      output_format === "markdown"
        ? new MarkdownHandler()
        : new AsciidocHandler();
    const result = handler.generate({ format, data });

    return jsonResponse({ output_format, format, content: result });
  }
}
