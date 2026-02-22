import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import { getHandler } from "../../handlers/index.js";

const QueryGraphSchema = z.object({
  source: z.enum(["dependency", "call_graph"]).describe("Data source to query"),
  directory: z.string().describe("Absolute path to the directory to analyze"),
  jq: z.string().optional().describe("jq query to run on the result (e.g., '.edges | group_by(.to) | sort_by(-length) | .[0:10]')"),
  preset: z.enum(["top_referenced", "top_importers", "orphans", "coupling", "modules"]).optional().describe("Preset query: top_referenced (most imported files), top_importers (files with most imports), orphans (files with no imports/exports), coupling (tightly coupled modules), modules (group by directory)"),
});

type QueryGraphArgs = z.infer<typeof QueryGraphSchema>;

export class QueryGraphHandler extends BaseToolHandler<QueryGraphArgs> {
  readonly name = "query_graph";
  readonly description = "Query dependency_graph or call_graph results with jq or preset queries. Use for analysis like finding most-referenced files, coupling metrics, or custom queries.";
  readonly schema = QueryGraphSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      source: {
        type: "string",
        enum: ["dependency", "call_graph"],
        description: "Data source to query",
      },
      directory: {
        type: "string",
        description: "Absolute path to the directory to analyze",
      },
      jq: {
        type: "string",
        description: "jq query to run on the result",
      },
      preset: {
        type: "string",
        enum: ["top_referenced", "top_importers", "orphans", "coupling", "modules"],
        description: "Preset query",
      },
    },
    required: ["source", "directory"],
  };

  protected async doExecute(args: QueryGraphArgs): Promise<ToolResponse> {
    const { source, directory, jq: jqQuery, preset } = args;
    const handler = getHandler(`${directory}/dummy.ts`);

    if (!handler) {
      return errorResponse("Failed to initialize TypeScript handler");
    }

    const result = await handler.queryGraph({
      source,
      directory,
      jq: jqQuery,
      preset,
    });
    return jsonResponse(result);
  }
}
