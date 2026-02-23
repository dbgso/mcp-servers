import { z } from "zod";
import type { FileResult } from "mcp-shared";
import { formatMultiFileResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import {
  getHandler,
  getSupportedExtensions,
} from "../../handlers/index.js";
import type { QueryType, QueryResult } from "../../types/index.js";

const ReadSchema = z.object({
  file_path: z
    .union([z.string(), z.array(z.string())])
    .describe(
      "Absolute path(s) to the file(s) to read. Can be a single path or array of paths."
    ),
  query: z
    .enum(["full", "headings", "code_blocks", "lists", "links"])
    .optional()
    .default("full")
    .describe(
      "Query type: full (default), headings, code_blocks, lists, links"
    ),
  heading: z
    .string()
    .optional()
    .describe("Get plain text content under specific section heading (works with Markdown and AsciiDoc)"),
  depth: z.number().optional().describe("Max heading depth for headings query"),
});

type ReadArgs = z.infer<typeof ReadSchema>;

interface SectionResult {
  filePath: string;
  fileType: "markdown" | "asciidoc";
  heading: string;
  content: string;
}

async function processFile(params: {
  filePath: string;
  query: string;
  options: { heading?: string; depth?: number };
}): Promise<FileResult<QueryResult | SectionResult>> {
  const { filePath, query, options } = params;
  const handler = getHandler(filePath);

  if (!handler) {
    return { filePath, error: `Unsupported file type` };
  }

  try {
    // Section query: return plain text content under the heading
    // Polymorphism: all handlers implement getSectionText
    if (options.heading) {
      const content = await handler.getSectionText({
        filePath,
        headingText: options.heading,
      });
      if (!content) {
        return { filePath, error: `Heading "${options.heading}" not found` };
      }
      return {
        filePath,
        result: {
          filePath,
          fileType: handler.fileType as "markdown" | "asciidoc",
          heading: options.heading,
          content,
        },
      };
    }

    // Query by type: all handlers implement getHeadingsFromFile and getLinksFromFile
    if (query === "headings") {
      const headings = await handler.getHeadingsFromFile({
        filePath,
        maxDepth: options.depth,
      });
      return {
        filePath,
        result: {
          filePath,
          fileType: handler.fileType as "markdown" | "asciidoc",
          query: "headings" as QueryType,
          data: headings,
        },
      };
    }

    if (query === "links") {
      const links = await handler.getLinksFromFile(filePath);
      return {
        filePath,
        result: {
          filePath,
          fileType: handler.fileType as "markdown" | "asciidoc",
          query: "links" as QueryType,
          data: links,
        },
      };
    }

    // Polymorphism: use handler.query() for all remaining query types
    // Each handler implements supported queries and throws for unsupported ones
    const result = await handler.query({
      filePath,
      queryType: query as QueryType,
      options,
    });
    return { filePath, result };
  } catch (error) {
    return {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export class AstReadHandler extends BaseToolHandler<ReadArgs> {
  readonly name = "ast_read";
  readonly schema = ReadSchema;

  get description(): string {
    const extensions = getSupportedExtensions();
    return `Read file(s) and return AST or query specific elements. Supports multiple files. Supported extensions: ${extensions.join(", ")}. Query options: full (entire AST), headings (list of headings), code_blocks (list of code blocks), lists (list of lists), links (list of links). Use 'heading' parameter to get plain text content under a specific section heading (works with both Markdown and AsciiDoc).`;
  }

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        oneOf: [
          { type: "string", description: "Single file path" },
          {
            type: "array",
            items: { type: "string" },
            description: "Array of file paths",
          },
        ],
        description: "Absolute path(s) to the file(s) to read",
      },
      query: {
        type: "string",
        enum: ["full", "headings", "code_blocks", "lists", "links"],
        description: "Query type: full (default), headings, code_blocks, lists, links",
      },
      heading: {
        type: "string",
        description: "Get plain text content under specific section heading (works with Markdown and AsciiDoc)",
      },
      depth: {
        type: "number",
        description: "Max heading depth for headings query",
      },
    },
    required: ["file_path"],
  };

  protected async doExecute(args: ReadArgs): Promise<ToolResponse> {
    const { file_path, query, heading, depth } = args;
    const filePaths = Array.isArray(file_path) ? file_path : [file_path];

    const results = await Promise.all(
      filePaths.map((fp) =>
        processFile({ filePath: fp, query, options: { heading, depth } })
      )
    );

    return formatMultiFileResponse(results);
  }
}
