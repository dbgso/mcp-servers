import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import { getHandler } from "../../handlers/index.js";

const DeadCodeSchema = z.object({
  path: z.string().optional().describe("Single path to analyze (alternative to paths)"),
  paths: z.array(z.string()).optional().describe("Absolute path(s) to files or directories to analyze"),
  include_tests: z.boolean().optional().default(false).describe("Include test files in analysis (default: false)"),
  entry_points: z.array(z.string()).optional().default([]).describe("Glob patterns for entry points (exports from these files are considered used)"),
}).refine(data => data.path || (data.paths && data.paths.length > 0), {
  message: "Either 'path' or 'paths' must be provided",
});

type DeadCodeArgs = z.infer<typeof DeadCodeSchema>;

export class DeadCodeHandler extends BaseToolHandler<DeadCodeArgs> {
  readonly name = "dead_code";
  readonly description = "Find dead code (unused exports and private members) in the given paths. Returns unused symbols with file path, line number, and kind.";
  readonly schema = DeadCodeSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Single path to analyze (alternative to paths)",
      },
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Absolute path(s) to files or directories to analyze",
      },
      include_tests: {
        type: "boolean",
        description: "Include test files in analysis (default: false)",
      },
      entry_points: {
        type: "array",
        items: { type: "string" },
        description: "Glob patterns for entry points (exports from these files are considered used)",
      },
    },
    required: [],
  };

  protected async doExecute(args: DeadCodeArgs): Promise<ToolResponse> {
    const { path, paths: pathsArg, include_tests, entry_points } = args;

    // Normalize: support both path (single) and paths (array)
    const paths = path ? [path] : (pathsArg ?? []);

    // Get handler using the first path (or a dummy TypeScript file)
    const firstPath = paths[0];
    const handlerPath = firstPath.endsWith(".ts") ? firstPath : `${firstPath}/dummy.ts`;
    const handler = getHandler(handlerPath);

    if (!handler) {
      return errorResponse("Failed to initialize TypeScript handler");
    }

    const result = await handler.findDeadCode({
      paths,
      includeTests: include_tests,
      entryPoints: entry_points,
    });
    return jsonResponse(result);
  }
}
