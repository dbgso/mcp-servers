import { z } from "zod";
import { jsonResponse, errorResponse, paginate } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import { MarkdownHandler, AsciidocHandler } from "../../handlers/index.js";

const TopicIndexSchema = z.object({
  directory: z.string().describe("Directory path to search"),
  pattern: z
    .string()
    .optional()
    .describe(
      "File pattern (e.g., '*.md', '*.adoc'). If not specified, finds all supported files."
    ),
  query: z
    .string()
    .optional()
    .describe(
      "Filter topics by keyword (case-insensitive substring match)"
    ),
  maxDepth: z
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
      "Maximum topics to return per page. If not specified, returns all topics."
    ),
});

type TopicIndexArgs = z.infer<typeof TopicIndexSchema>;

interface TopicEntry {
  text: string;
  filePath: string;
  anchor: string;
  depth: number;
  fileType: "markdown" | "asciidoc";
}

export class TopicIndexHandler extends BaseToolHandler<TopicIndexArgs> {
  readonly name = "topic_index";
  readonly schema = TopicIndexSchema;
  readonly description =
    "Build a searchable index of all topics (headings) across documentation files. Use this to find existing content before writing new documentation (DRY principle). Returns topic text, file path, and anchor for linking.";

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
      query: {
        type: "string",
        description:
          "Filter topics by keyword (case-insensitive substring match)",
      },
      maxDepth: {
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
          "Maximum topics to return per page. If not specified, returns all topics.",
      },
    },
    required: ["directory"],
  };

  protected async doExecute(args: TopicIndexArgs): Promise<ToolResponse> {
    const { directory, pattern, query, maxDepth, cursor, limit } = args;

    const mdHandler = new MarkdownHandler();
    const adocHandler = new AsciidocHandler();

    let files;
    let errors: Array<{ filePath: string; error: string }> = [];

    // Read files based on pattern
    if (pattern) {
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
      const [mdResult, adocResult] = await Promise.all([
        mdHandler.readDirectory({ directory }),
        adocHandler.readDirectory({ directory }),
      ]);
      files = [...mdResult.files, ...adocResult.files];
      errors = [...mdResult.errors, ...adocResult.errors];
    }

    // Build topic index
    const topics: TopicEntry[] = [];

    for (const file of files) {
      for (const heading of file.headings) {
        // Filter by maxDepth
        if (maxDepth && heading.depth > maxDepth) {
          continue;
        }

        // Generate anchor from heading text
        const anchor = this.generateAnchor(heading.text, file.fileType);

        topics.push({
          text: heading.text,
          filePath: file.filePath,
          anchor,
          depth: heading.depth,
          fileType: file.fileType,
        });
      }
    }

    // Filter by query if provided
    const filteredTopics = query
      ? topics.filter((t) =>
          t.text.toLowerCase().includes(query.toLowerCase())
        )
      : topics;

    // Sort alphabetically by text for easier searching
    // eslint-disable-next-line custom/single-params-object -- sort callback
    filteredTopics.sort((a, b) => a.text.localeCompare(b.text));

    // Apply pagination
    const paginatedTopics = paginate({
      items: filteredTopics,
      pagination: { cursor, limit },
    });

    return jsonResponse({
      topics: paginatedTopics.data,
      total: paginatedTopics.total,
      nextCursor: paginatedTopics.nextCursor,
      hasMore: paginatedTopics.hasMore,
      errors,
    });
  }

  private generateAnchor(text: string, fileType: "markdown" | "asciidoc"): string {
    if (fileType === "markdown") {
      // GitHub-flavored markdown anchor generation
      return text
        .toLowerCase()
        .replace(/[^\w\s\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf-]/g, "") // Keep alphanumeric, CJK, hyphens
        .replace(/\s+/g, "-") // Spaces to hyphens
        .replace(/-+/g, "-") // Collapse multiple hyphens
        .replace(/^-|-$/g, ""); // Trim hyphens
    } else {
      // AsciiDoc anchor: _text_with_underscores
      return "_" + text
        .toLowerCase()
        .replace(/[^\w\s\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/g, "")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
    }
  }
}
