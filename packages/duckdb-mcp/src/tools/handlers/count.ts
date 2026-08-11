import { z } from "zod";
import { BaseToolHandler, jsonResponse, errorResponse } from "mcp-shared";
import { sanitizeDuckDBError, queryFile } from "mcp-shared/duckdb";
import type { ToolResponse } from "mcp-shared";

const CountSchema = z.object({
  file_path: z.string().describe("Path to data file (CSV, TSV, JSON, JSONL, or Parquet)"),
  group_by: z.string().describe("Column name to group by"),
  top_n: z.number().int().min(1).max(1000).optional().describe("Number of top groups to return (default: 20)"),
  encoding: z.string().optional().describe("File encoding"),
});

type CountArgs = z.infer<typeof CountSchema>;

export class DuckdbCountHandler extends BaseToolHandler<CountArgs> {
  readonly name = "duckdb_count";
  readonly description =
    "Count records grouped by a column in a data file. Returns top N groups sorted by count descending.";
  readonly schema = CountSchema;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Path to data file (CSV, TSV, JSON, JSONL, or Parquet)",
      },
      group_by: {
        type: "string",
        description: "Column name to group by",
      },
      top_n: {
        type: "number",
        description: "Number of top groups to return (default: 20)",
      },
      encoding: {
        type: "string",
        description: "File encoding",
      },
    },
    required: ["file_path", "group_by"],
  };

  protected async doExecute(args: CountArgs): Promise<ToolResponse> {
    const topN = args.top_n ?? 20;

    try {
      const result = await queryFile({
        filePath: args.file_path,
        sql: `SELECT CAST("${args.group_by}" AS VARCHAR) AS value, COUNT(*) AS count FROM data GROUP BY "${args.group_by}" ORDER BY count DESC LIMIT ${topN}`,
        limit: topN,
        encoding: args.encoding,
      });

      return jsonResponse({
        group_by: args.group_by,
        groups: result.rows,
        total_groups: result.rowCount,
      });
    } catch (error) {
      return errorResponse(sanitizeDuckDBError(error));
    }
  }
}
