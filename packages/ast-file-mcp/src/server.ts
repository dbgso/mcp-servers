import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Root as MdastRoot } from "mdast";
import {
  type FileResult,
  errorResponse,
  jsonResponse,
  formatMultiFileResponse,
  paginate,
} from "mcp-shared";
import { getHandler, getSupportedExtensions, MarkdownHandler, AsciidocHandler } from "./handlers/index.js";
import type { QueryType, QueryResult } from "./types/index.js";

const server = new Server(
  {
    name: "ast-file-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const ReadSchema = z.object({
  file_path: z.union([z.string(), z.array(z.string())]).describe("Absolute path(s) to the file(s) to read. Can be a single path or array of paths."),
  query: z.enum(["full", "headings", "code_blocks", "lists", "links"]).optional().default("full").describe("Query type: full (default), headings, code_blocks, lists, links"),
  heading: z.string().optional().describe("Get content under specific heading (Markdown only)"),
  depth: z.number().optional().describe("Max heading depth for headings query"),
});

const WriteSchema = z.object({
  file_path: z.string().describe("Absolute path to the file to write"),
  ast: z.unknown().describe("AST object to write"),
});

const GoToDefinitionSchema = z.object({
  file_path: z.string().describe("Absolute path to the Markdown file"),
  line: z.number().describe("Line number (1-based)"),
  column: z.number().describe("Column number (1-based)"),
});

const CrawlSchema = z.object({
  file_path: z.string().describe("Starting file path to crawl from"),
  max_depth: z.number().optional().default(10).describe("Maximum depth to follow links (default: 10)"),
  max_files: z.number().optional().describe("Maximum number of files to crawl. If not specified, crawls all reachable files."),
  cursor: z.string().optional().describe("Pagination cursor from previous response"),
  limit: z.number().optional().describe("Maximum files to return per page. If not specified, returns all files."),
});

const ReadDirectorySchema = z.object({
  directory: z.string().describe("Directory path to search"),
  pattern: z.string().optional().describe("File pattern (e.g., '*.md', '*.adoc'). If not specified, finds all supported files."),
  cursor: z.string().optional().describe("Pagination cursor from previous response"),
  limit: z.number().optional().describe("Maximum files to return per page. If not specified, returns all files."),
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const extensions = getSupportedExtensions();
  return {
    tools: [
      {
        name: "ast_read",
        description: `Read file(s) and return AST or query specific elements. Supports multiple files. Supported extensions: ${extensions.join(", ")}. Query options: full (entire AST), headings (list of headings), code_blocks (list of code blocks), lists (list of lists), links (list of links). Use 'heading' parameter to get content under a specific heading.`,
        inputSchema: {
          type: "object" as const,
          properties: {
            file_path: {
              oneOf: [
                { type: "string", description: "Single file path" },
                { type: "array", items: { type: "string" }, description: "Array of file paths" },
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
              description: "Get content under specific heading (Markdown only)",
            },
            depth: {
              type: "number",
              description: "Max heading depth for headings query",
            },
          },
          required: ["file_path"],
        },
      },
      {
        name: "ast_write",
        description: "Write an AST back to a file. Only supported for Markdown files.",
        inputSchema: {
          type: "object" as const,
          properties: {
            file_path: {
              type: "string",
              description: "Absolute path to the file to write",
            },
            ast: {
              type: "object",
              description: "AST object to write",
            },
          },
          required: ["file_path", "ast"],
        },
      },
      {
        name: "go_to_definition",
        description: "Go to definition: find where a link at the given position points to. For Markdown, resolves links to files and headings. Returns file path and line of the target.",
        inputSchema: {
          type: "object" as const,
          properties: {
            file_path: {
              type: "string",
              description: "Absolute path to the Markdown file",
            },
            line: {
              type: "number",
              description: "Line number (1-based)",
            },
            column: {
              type: "number",
              description: "Column number (1-based)",
            },
          },
          required: ["file_path", "line", "column"],
        },
      },
      {
        name: "crawl",
        description: "Crawl from a starting file, following links recursively. Returns headings and links for each discovered file. Useful for building a documentation map from a README or index file. Supports pagination with cursor/limit.",
        inputSchema: {
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
              description: "Maximum number of files to crawl. If not specified, crawls all reachable files.",
            },
            cursor: {
              type: "string",
              description: "Pagination cursor from previous response",
            },
            limit: {
              type: "number",
              description: "Maximum files to return per page. If not specified, returns all files.",
            },
          },
          required: ["file_path"],
        },
      },
      {
        name: "read_directory",
        description: "Find and read all matching files in a directory. Returns headings and links for each file. Useful for getting an overview of all documentation in a folder. Supports pagination with cursor/limit.",
        inputSchema: {
          type: "object" as const,
          properties: {
            directory: {
              type: "string",
              description: "Directory path to search",
            },
            pattern: {
              type: "string",
              description: "File pattern (e.g., '*.md', '*.adoc'). If not specified, finds all supported files.",
            },
            cursor: {
              type: "string",
              description: "Pagination cursor from previous response",
            },
            limit: {
              type: "number",
              description: "Maximum files to return per page. If not specified, returns all files.",
            },
          },
          required: ["directory"],
        },
      },
    ],
  };
});

async function processFile(
  filePath: string,
  query: string,
  options: { heading?: string; depth?: number }
): Promise<FileResult<QueryResult>> {
  const handler = getHandler(filePath);

  if (!handler) {
    return { filePath, error: `Unsupported file type` };
  }

  try {
    if (handler instanceof MarkdownHandler && (query !== "full" || options.heading)) {
      const result = await handler.query(filePath, query as QueryType, options);
      return { filePath, result };
    }

    const readResult = await handler.read(filePath);
    return {
      filePath,
      result: {
        filePath: readResult.filePath,
        fileType: readResult.fileType,
        query: "full" as QueryType,
        data: readResult.ast,
      },
    };
  } catch (error) {
    return { filePath, error: error instanceof Error ? error.message : String(error) };
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "ast_read") {
    const parsed = ReadSchema.safeParse(args);
    if (!parsed.success) {
      return errorResponse(`Invalid arguments: ${parsed.error.message}`);
    }

    const { file_path, query, heading, depth } = parsed.data;
    const filePaths = Array.isArray(file_path) ? file_path : [file_path];

    const results = await Promise.all(
      filePaths.map((fp) => processFile(fp, query, { heading, depth }))
    );

    return formatMultiFileResponse(results);
  }

  if (name === "ast_write") {
    const parsed = WriteSchema.safeParse(args);
    if (!parsed.success) {
      return errorResponse(`Invalid arguments: ${parsed.error.message}`);
    }

    const { file_path, ast } = parsed.data;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(`Unsupported file type. Supported: ${extensions.join(", ")}`);
    }

    if (!handler.write) {
      return errorResponse(`Write not supported for ${handler.fileType} files`);
    }

    try {
      await handler.write(file_path, ast as MdastRoot);
      return jsonResponse({ success: true, filePath: file_path });
    } catch (error) {
      return errorResponse(`Failed to write file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (name === "go_to_definition") {
    const parsed = GoToDefinitionSchema.safeParse(args);
    if (!parsed.success) {
      return errorResponse(`Invalid arguments: ${parsed.error.message}`);
    }

    const { file_path, line, column } = parsed.data;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(`Unsupported file type. Supported: ${extensions.join(", ")}`);
    }

    if (!(handler instanceof MarkdownHandler)) {
      return errorResponse(`go_to_definition is only supported for Markdown files`);
    }

    try {
      const result = await handler.goToDefinition(file_path, line, column);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to get definition: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (name === "crawl") {
    const parsed = CrawlSchema.safeParse(args);
    if (!parsed.success) {
      return errorResponse(`Invalid arguments: ${parsed.error.message}`);
    }

    const { file_path, max_depth, max_files, cursor, limit } = parsed.data;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(`Unsupported file type. Supported: ${extensions.join(", ")}`);
    }

    if (!(handler instanceof MarkdownHandler) && !(handler instanceof AsciidocHandler)) {
      return errorResponse(`crawl is only supported for Markdown and AsciiDoc files`);
    }

    try {
      const result = await handler.crawl(file_path, max_depth);

      // Apply max_files limit if specified
      let files = result.files;
      if (max_files !== undefined && files.length > max_files) {
        files = files.slice(0, max_files);
      }

      // Apply pagination
      const paginatedFiles = paginate({ items: files, pagination: { cursor, limit } });

      return jsonResponse({
        startFile: result.startFile,
        files: paginatedFiles.data,
        total: paginatedFiles.total,
        nextCursor: paginatedFiles.nextCursor,
        hasMore: paginatedFiles.hasMore,
        errors: result.errors,
      });
    } catch (error) {
      return errorResponse(`Failed to crawl: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (name === "read_directory") {
    const parsed = ReadDirectorySchema.safeParse(args);
    if (!parsed.success) {
      return errorResponse(`Invalid arguments: ${parsed.error.message}`);
    }

    const { directory, pattern, cursor, limit } = parsed.data;

    try {
      // Determine which handler(s) to use based on pattern
      const mdHandler = new MarkdownHandler();
      const adocHandler = new AsciidocHandler();

      let files;
      let errors: Array<{ filePath: string; error: string }> = [];

      if (pattern) {
        // If pattern specified, use the appropriate handler
        const ext = pattern.replace("*.", "").toLowerCase();
        if (mdHandler.extensions.includes(ext)) {
          const result = await mdHandler.readDirectory(directory, pattern);
          files = result.files;
          errors = result.errors;
        } else if (adocHandler.extensions.includes(ext)) {
          const result = await adocHandler.readDirectory(directory, pattern);
          files = result.files;
          errors = result.errors;
        } else {
          return errorResponse(`Unsupported file pattern: ${pattern}`);
        }
      } else {
        // No pattern - read both markdown and asciidoc files
        const [mdResult, adocResult] = await Promise.all([
          mdHandler.readDirectory(directory),
          adocHandler.readDirectory(directory),
        ]);

        files = [...mdResult.files, ...adocResult.files].sort((a, b) =>
          a.filePath.localeCompare(b.filePath)
        );
        errors = [...mdResult.errors, ...adocResult.errors];
      }

      // Apply pagination
      const paginatedFiles = paginate({ items: files, pagination: { cursor, limit } });

      return jsonResponse({
        files: paginatedFiles.data,
        total: paginatedFiles.total,
        nextCursor: paginatedFiles.nextCursor,
        hasMore: paginatedFiles.hasMore,
        errors,
      });
    } catch (error) {
      return errorResponse(`Failed to read directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return errorResponse(`Unknown tool: ${name}`);
});

export async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ast-file-mcp server started");
}
