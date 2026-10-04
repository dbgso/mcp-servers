import { z } from "zod";
import { jsonResponse, errorResponse, paginate } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "mcp-shared";
import { readDocuments } from "../../handlers/index.js";
import { headingAnchor } from "../../handlers/anchor.js";

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

    const read = await readDocuments({ directory, pattern });
    if ("error" in read) {
      return errorResponse(read.error);
    }
    const { files, errors } = read;

    // Build topic index
    const topics: TopicEntry[] = [];

    for (const file of files) {
      for (const heading of file.headings) {
        // Filter by maxDepth
        if (maxDepth && heading.depth > maxDepth) {
          continue;
        }

        // Generate anchor from heading text
        const anchor = headingAnchor({ text: heading.text, fileType: file.fileType });

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
}
