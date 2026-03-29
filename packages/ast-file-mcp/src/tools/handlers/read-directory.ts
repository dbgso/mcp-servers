import { z } from "zod";
import { jsonResponse, errorResponse, paginate } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "mcp-shared";
import { MarkdownHandler, AsciidocHandler } from "../../handlers/index.js";

const ReadDirectorySchema = z.object({
  directory: z.string().describe("Directory path to search"),
  pattern: z
    .string()
    .optional()
    .describe(
      "File pattern (e.g., '*.md', '*.adoc'). If not specified, finds all supported files."
    ),
  detail: z
    .enum(["files", "outline", "full"])
    .optional()
    .default("full")
    .describe(
      "Detail level: 'files' = paths only, 'outline' = paths + headings, 'full' = paths + headings + links (default)"
    ),
  maxHeadingDepth: z
    .number()
    .optional()
    .describe(
      "Maximum heading depth to include (e.g., 2 = only h1 and h2). If not specified, includes all depths."
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

type ReadDirectoryArgs = z.infer<typeof ReadDirectorySchema>;

export class ReadDirectoryHandler extends BaseToolHandler<ReadDirectoryArgs> {
  readonly name = "read_directory";
  readonly schema = ReadDirectorySchema;
  readonly description =
    "Find and read all matching files in a directory. Returns headings and links for each file. Useful for getting an overview of all documentation in a folder. Supports pagination with cursor/limit.";

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      directory: {
        type: "string",
        description: "Directory path to search",
      },
      pattern: {
        type: "string",
        description:
          "File pattern (e.g., '*.md', '*.adoc'). If not specified, finds all supported files.",
      },
      detail: {
        type: "string",
        enum: ["files", "outline", "full"],
        description:
          "Detail level: 'files' = paths only, 'outline' = paths + headings, 'full' = paths + headings + links (default)",
      },
      maxHeadingDepth: {
        type: "number",
        description:
          "Maximum heading depth to include (e.g., 2 = only h1 and h2). If not specified, includes all depths.",
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
    required: ["directory"],
  };

  protected async doExecute(args: ReadDirectoryArgs): Promise<ToolResponse> {
    const { directory, pattern, detail = "full", maxHeadingDepth, cursor, limit } = args;

    // Determine which handler(s) to use based on pattern
    const mdHandler = new MarkdownHandler();
    const adocHandler = new AsciidocHandler();

    let files;
    let errors: Array<{ filePath: string; error: string }> = [];

    if (pattern) {
      // If pattern specified, use the appropriate handler
      const ext = pattern.replace("*.", "").toLowerCase();
      if (mdHandler.extensions.includes(ext)) {
        const result = await mdHandler.readDirectory({ directory, pattern });
        files = result.files;
        errors = result.errors;
      } else if (adocHandler.extensions.includes(ext)) {
        const result = await adocHandler.readDirectory({ directory, pattern });
        files = result.files;
        errors = result.errors;
      } else {
        return errorResponse(`Unsupported file pattern: ${pattern}`);
      }
    } else {
      // No pattern - read both markdown and asciidoc files
      const [mdResult, adocResult] = await Promise.all([
        mdHandler.readDirectory({ directory }),
        adocHandler.readDirectory({ directory }),
      ]);

       
      files = [...mdResult.files, ...adocResult.files].sort((a, b) =>
        a.filePath.localeCompare(b.filePath)
      );
      errors = [...mdResult.errors, ...adocResult.errors];
    }

    // Transform based on detail level
    const transformedFiles = files.map((file) => {
      // Filter headings by maxHeadingDepth if specified
      const filteredHeadings = maxHeadingDepth
        ? file.headings.filter((h) => h.depth <= maxHeadingDepth)
        : file.headings;

      switch (detail) {
        case "files":
          return {
            filePath: file.filePath,
            fileType: file.fileType,
          };
        case "outline":
          return {
            filePath: file.filePath,
            fileType: file.fileType,
            headings: filteredHeadings,
          };
        case "full":
        default:
          return {
            filePath: file.filePath,
            fileType: file.fileType,
            headings: filteredHeadings,
            links: file.links,
          };
      }
    });

    // Apply pagination
    const paginatedFiles = paginate({
      items: transformedFiles,
      pagination: { cursor, limit },
    });

    return jsonResponse({
      files: paginatedFiles.data,
      total: paginatedFiles.total,
      nextCursor: paginatedFiles.nextCursor,
      hasMore: paginatedFiles.hasMore,
      errors,
    });
  }
}
