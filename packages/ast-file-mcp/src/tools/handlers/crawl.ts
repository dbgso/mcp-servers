import { z } from "zod";
import { jsonResponse, errorResponse, paginate } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "mcp-shared";
import {
  getHandler,
  getSupportedExtensions,
} from "../../handlers/index.js";

const CrawlSchema = z.object({
  file_path: z.string().describe("Starting file path to crawl from"),
  max_depth: z
    .number()
    .optional()
    .default(10)
    .describe("Maximum depth to follow links (default: 10)"),
  max_files: z
    .number()
    .optional()
    .describe(
      "Maximum number of files to crawl. If not specified, crawls all reachable files."
    ),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor from previous response"),
  limit: z
    .number()
    .optional()
    .describe(
      "Maximum files to return per page. If not specified, returns all files."
    ),
});

type CrawlArgs = z.infer<typeof CrawlSchema>;

export class CrawlHandler extends BaseToolHandler<CrawlArgs> {
  readonly name = "crawl";
  readonly schema = CrawlSchema;
  readonly description =
    "Crawl from a starting file, following links recursively. Returns headings and links for each discovered file. Useful for building a documentation map from a README or index file. Supports pagination with cursor/limit.";

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Starting file path to crawl from",
      },
      max_depth: {
        type: "number",
        description: "Maximum depth to follow links (default: 10)",
      },
      max_files: {
        type: "number",
        description:
          "Maximum number of files to crawl. If not specified, crawls all reachable files.",
      },
      cursor: {
        type: "string",
        description: "Pagination cursor from previous response",
      },
      limit: {
        type: "number",
        description:
          "Maximum files to return per page. If not specified, returns all files.",
      },
    },
    required: ["file_path"],
  };

  protected async doExecute(args: CrawlArgs): Promise<ToolResponse> {
    const { file_path, max_depth, max_files, cursor, limit } = args;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(
        `Unsupported file type. Supported: ${extensions.join(", ")}`
      );
    }

    // Polymorphism: all handlers implement crawl
    const result = await handler.crawl({ startFile: file_path, maxDepth: max_depth });

    // Apply max_files limit if specified
    let files = result.files;
    if (max_files !== undefined && files.length > max_files) {
      files = files.slice(0, max_files);
    }

    // Apply pagination
    const paginatedFiles = paginate({
      items: files,
      pagination: { cursor, limit },
    });

    return jsonResponse({
      startFile: result.startFile,
      files: paginatedFiles.data,
      total: paginatedFiles.total,
      nextCursor: paginatedFiles.nextCursor,
      hasMore: paginatedFiles.hasMore,
      errors: result.errors,
    });
  }
}
