import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { SourceFileStructure } from "ts-morph";
import {
  type FileResult,
  errorResponse,
  jsonResponse,
  formatMultiFileResponse,
} from "mcp-shared";
import { getHandler, getSupportedExtensions } from "./handlers/index.js";
import type { TsQueryType, DeclarationKind, TsQueryResult } from "./types/index.js";

const server = new Server(
  {
    name: "ast-typescript-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const ReadSchema = z.object({
  file_path: z.union([z.string(), z.array(z.string())]).describe("Absolute path(s) to the TypeScript file(s) to read. Can be a single path or array of paths."),
  query: z.enum(["full", "summary", "imports", "exports"]).optional().default("full").describe("Query type: full (default), summary, imports, exports"),
  name: z.string().optional().describe("Get specific declaration by name"),
  kind: z.enum(["class", "function", "interface", "type", "variable", "enum"]).optional().describe("Filter by declaration kind (for summary query)"),
});

const WriteSchema = z.object({
  file_path: z.string().describe("Absolute path to the TypeScript file to write"),
  structure: z.unknown().describe("SourceFileStructure object from ts-morph"),
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const extensions = getSupportedExtensions();
  return {
    tools: [
      {
        name: "ts_structure_read",
        description: `Read TypeScript file(s) and return Structure or query specific elements. Supports multiple files. Supported extensions: ${extensions.join(", ")}. Query options: full (entire structure), summary (list of declarations), imports (list of imports), exports (list of exports). Use 'name' to get a specific declaration. Use 'kind' to filter summary by type.`,
        inputSchema: {
          type: "object" as const,
          properties: {
            file_path: {
              oneOf: [
                { type: "string", description: "Single file path" },
                { type: "array", items: { type: "string" }, description: "Array of file paths" },
              ],
              description: "Absolute path(s) to the TypeScript file(s) to read",
            },
            query: {
              type: "string",
              enum: ["full", "summary", "imports", "exports"],
              description: "Query type: full (default), summary, imports, exports",
            },
            name: {
              type: "string",
              description: "Get specific declaration by name",
            },
            kind: {
              type: "string",
              enum: ["class", "function", "interface", "type", "variable", "enum"],
              description: "Filter by declaration kind (for summary query)",
            },
          },
          required: ["file_path"],
        },
      },
      {
        name: "ts_structure_write",
        description: "Write a ts-morph Structure back to a TypeScript file.",
        inputSchema: {
          type: "object" as const,
          properties: {
            file_path: {
              type: "string",
              description: "Absolute path to the TypeScript file to write",
            },
            structure: {
              type: "object",
              description: "SourceFileStructure object from ts-morph",
            },
          },
          required: ["file_path", "structure"],
        },
      },
    ],
  };
});

async function processFile(
  filePath: string,
  query: string,
  options: { name?: string; kind?: DeclarationKind }
): Promise<FileResult<TsQueryResult>> {
  const handler = getHandler(filePath);

  if (!handler) {
    return { filePath, error: `Unsupported file type` };
  }

  try {
    if (query !== "full" || options.name || options.kind) {
      const result = await handler.query(filePath, query as TsQueryType, options);
      return { filePath, result };
    }

    const readResult = await handler.read(filePath);
    return {
      filePath,
      result: {
        filePath: readResult.filePath,
        fileType: readResult.fileType,
        query: "full" as TsQueryType,
        data: readResult.structure,
      },
    };
  } catch (error) {
    return { filePath, error: error instanceof Error ? error.message : String(error) };
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "ts_structure_read") {
    const parsed = ReadSchema.safeParse(args);
    if (!parsed.success) {
      return errorResponse(`Invalid arguments: ${parsed.error.message}`);
    }

    const { file_path, query, name: declName, kind } = parsed.data;
    const filePaths = Array.isArray(file_path) ? file_path : [file_path];

    const results = await Promise.all(
      filePaths.map((fp) => processFile(fp, query, { name: declName, kind: kind as DeclarationKind | undefined }))
    );

    return formatMultiFileResponse(results);
  }

  if (name === "ts_structure_write") {
    const parsed = WriteSchema.safeParse(args);
    if (!parsed.success) {
      return errorResponse(`Invalid arguments: ${parsed.error.message}`);
    }

    const { file_path, structure } = parsed.data;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(`Unsupported file type. Supported: ${extensions.join(", ")}`);
    }

    try {
      await handler.write(file_path, structure as SourceFileStructure);
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
  console.error("ast-typescript-mcp server started");
}
