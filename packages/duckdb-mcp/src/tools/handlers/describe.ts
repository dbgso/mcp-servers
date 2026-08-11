import { z } from "zod";
import { BaseToolHandler, jsonResponse, errorResponse, getErrorMessage } from "mcp-shared";
import { sanitizeDuckDBError, describeFile } from "mcp-shared/duckdb";
import type { ToolResponse } from "mcp-shared";

const DescribeSchema = z.object({
  file_path: z.string().describe("Path to data file (CSV, TSV, JSON, JSONL, or Parquet)"),
  encoding: z.string().optional().describe("File encoding (e.g., 'utf-8', 'shift_jis')"),
});

type DescribeArgs = z.infer<typeof DescribeSchema>;

export class DuckdbDescribeHandler extends BaseToolHandler<DescribeArgs> {
  readonly name = "duckdb_describe";
  readonly description =
    "Describe the schema of a data file (CSV, TSV, JSON, JSONL, Parquet). Returns column names, types, row count, and format.";
  readonly schema = DescribeSchema;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Path to data file (CSV, TSV, JSON, JSONL, or Parquet)",
      },
      encoding: {
        type: "string",
        description: "File encoding (e.g., 'utf-8', 'shift_jis')",
      },
    },
    required: ["file_path"],
  };

  protected async doExecute(args: DescribeArgs): Promise<ToolResponse> {
    try {
      const result = await describeFile({
        filePath: args.file_path,
        encoding: args.encoding,
      });
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(sanitizeDuckDBError(error));
    }
  }
}
