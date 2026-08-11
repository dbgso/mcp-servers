import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "../types.js";
import { getHandler } from "../../handlers/index.js";

const DependencyGraphSchema = z.object({
  directory: z.string().describe("Absolute path to the directory to analyze"),
  pattern: z.string().optional().default("**/*.{ts,tsx,mts,cts}").describe("Glob pattern to filter files (default: **/*.{ts,tsx,mts,cts})"),
  include_external: z.boolean().optional().default(false).describe("Include external dependencies from node_modules (default: false)"),
});

type DependencyGraphArgs = z.infer<typeof DependencyGraphSchema>;

export class DependencyGraphHandler extends BaseToolHandler<DependencyGraphArgs> {
  readonly name = "dependency_graph";
  readonly description = "Analyze module dependencies in a directory. Returns nodes (modules), edges (import relationships), and detected cycles using Tarjan's SCC algorithm.";
  readonly schema = DependencyGraphSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      directory: {
        type: "string",
        description: "Absolute path to the directory to analyze",
      },
      pattern: {
        type: "string",
        description: "Glob pattern to filter files (default: **/*.{ts,tsx,mts,cts})",
      },
      include_external: {
        type: "boolean",
        description: "Include external dependencies from node_modules (default: false)",
      },
    },
    required: ["directory"],
  };

  protected async doExecute(args: DependencyGraphArgs): Promise<ToolResponse> {
    const { directory, pattern, include_external } = args;
    // Get handler using a dummy TypeScript file path
    const handler = getHandler(`${directory}/dummy.ts`);

    if (!handler) {
      return errorResponse("Failed to initialize TypeScript handler");
    }

    const result = await handler.getDependencyGraph({
      directory,
      pattern,
      includeExternal: include_external,
    });
    return jsonResponse(result);
  }
}
