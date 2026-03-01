import { z } from "zod";
import type { FileResult } from "mcp-shared";
import { formatMultiFileResponse, getErrorMessage } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";
import type { TsQueryType, TsQueryResult, DeclarationKind } from "../../types/index.js";

const ReadSchema = z.object({
  file_path: z.union([z.string(), z.array(z.string())]).describe("Absolute path(s) to the TypeScript file(s) to read. Can be a single path or array of paths."),
  query: z.enum(["full", "summary", "imports", "exports"]).optional().default("full").describe("Query type: full (default), summary, imports, exports"),
  name: z.string().optional().describe("Get specific declaration by name"),
  kind: z.enum(["class", "function", "interface", "type", "variable", "enum"]).optional().describe("Filter by declaration kind (for summary query)"),
});

type ReadArgs = z.infer<typeof ReadSchema>;

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
    // If query is not full, or if name/kind filters are specified, use query method
    if (query !== "full" || options.name || options.kind) {
      const result = await handler.query({ filePath: filePath, queryType: query as TsQueryType, options: options });
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
    return { filePath, error: getErrorMessage(error) };
  }
}

export class TsStructureReadHandler extends BaseToolHandler<ReadArgs> {
  readonly name = "ts_structure_read";
  readonly schema = ReadSchema;

  get description(): string {
    const extensions = getSupportedExtensions();
    return `Read TypeScript file(s) and return Structure or query specific elements. Supports multiple files. Supported extensions: ${extensions.join(", ")}. Query options: full (entire structure), summary (list of declarations), imports (list of imports), exports (list of exports). Use 'name' to get a specific declaration. Use 'kind' to filter summary by type.`;
  }

  readonly inputSchema = {
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
  };

  protected async doExecute(args: ReadArgs): Promise<ToolResponse> {
    const { file_path, query, name: declName, kind } = args;
    const filePaths = Array.isArray(file_path) ? file_path : [file_path];

    const results = await Promise.all(
      filePaths.map((fp) => processFile(fp, query, { name: declName, kind: kind as DeclarationKind | undefined }))
    );

    return formatMultiFileResponse(results);
  }
}
