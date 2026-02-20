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
} from "mcp-shared";
import { getHandler, getSupportedExtensions, MarkdownHandler } from "./handlers/index.js";
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

  return errorResponse(`Unknown tool: ${name}`);
});

export async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ast-file-mcp server started");
}
