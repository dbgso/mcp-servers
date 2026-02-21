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

const GoToDefinitionSchema = z.object({
  file_path: z.string().describe("Absolute path to the TypeScript file"),
  line: z.number().describe("Line number (1-based)"),
  column: z.number().describe("Column number (1-based)"),
});

const FindReferencesSchema = z.object({
  file_path: z.string().describe("Absolute path to the TypeScript file containing the symbol definition"),
  line: z.number().describe("Line number of the symbol (1-based)"),
  column: z.number().describe("Column number of the symbol (1-based)"),
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
      {
        name: "go_to_definition",
        description: "Go to definition: find where a symbol at the given position is defined. Returns file path, line, and column of the definition(s).",
        inputSchema: {
          type: "object" as const,
          properties: {
            file_path: {
              type: "string",
              description: "Absolute path to the TypeScript file",
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
        name: "find_references",
        description: "Find all references to a symbol. Uses git grep for fast file search, then parses candidates to verify actual references. Returns file paths, lines, and context of each reference.",
        inputSchema: {
          type: "object" as const,
          properties: {
            file_path: {
              type: "string",
              description: "Absolute path to the TypeScript file containing the symbol",
            },
            line: {
              type: "number",
              description: "Line number of the symbol (1-based)",
            },
            column: {
              type: "number",
              description: "Column number of the symbol (1-based)",
            },
          },
          required: ["file_path", "line", "column"],
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

    try {
      const result = await handler.goToDefinition(file_path, line, column);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to get definition: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (name === "find_references") {
    const parsed = FindReferencesSchema.safeParse(args);
    if (!parsed.success) {
      return errorResponse(`Invalid arguments: ${parsed.error.message}`);
    }

    const { file_path, line, column } = parsed.data;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(`Unsupported file type. Supported: ${extensions.join(", ")}`);
    }

    try {
      const result = await handler.findReferences(file_path, line, column);
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(`Failed to find references: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return errorResponse(`Unknown tool: ${name}`);
});

export async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ast-typescript-mcp server started");
}
