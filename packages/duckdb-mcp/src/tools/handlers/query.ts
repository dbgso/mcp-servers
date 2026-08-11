import { z } from "zod";
import { BaseToolHandler, jsonResponse, errorResponse } from "mcp-shared";
import { sanitizeDuckDBError, queryFile } from "mcp-shared/duckdb";
import type { ToolResponse } from "mcp-shared";

const fileAliasSchema = z.object({
  path: z.string().describe("File path"),
  alias: z.string().describe("Table alias to use in SQL"),
  encoding: z.string().optional().describe("File encoding"),
});

const QuerySchema = z.object({
  sql: z.string().describe("SQL query. Use 'data' as the table name for single file, or aliases for multiple files"),
  file_path: z.string().optional().describe("Path to a single data file (creates a 'data' view)"),
  files: z.array(fileAliasSchema).optional().describe("Multiple files with aliases for JOIN queries"),
  limit: z.number().int().min(1).max(10000).optional().describe("Maximum rows to return (default: 100)"),
  encoding: z.string().optional().describe("Default file encoding"),
  output_path: z.string().optional().describe("Write results to file instead of returning (CSV, TSV, JSON, Parquet)"),
});

type QueryArgs = z.infer<typeof QuerySchema>;

export class DuckdbQueryHandler extends BaseToolHandler<QueryArgs> {
  readonly name = "duckdb_query";
  readonly description =
    "Run SQL queries on data files (CSV, TSV, JSON, JSONL, Parquet) using DuckDB. Supports single file, multi-file JOINs, and output to file.";
  readonly schema = QuerySchema;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      sql: {
        type: "string",
        description: "SQL query. Use 'data' as the table name for single file, or aliases for multiple files",
      },
      file_path: {
        type: "string",
        description: "Path to a single data file (creates a 'data' view)",
      },
      files: {
        type: "array",
        description: "Multiple files with aliases for JOIN queries",
        items: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path" },
            alias: { type: "string", description: "Table alias to use in SQL" },
            encoding: { type: "string", description: "File encoding" },
          },
          required: ["path", "alias"],
        },
      },
      limit: {
        type: "number",
        description: "Maximum rows to return (default: 100)",
      },
      encoding: {
        type: "string",
        description: "Default file encoding",
      },
      output_path: {
        type: "string",
        description: "Write results to file instead of returning (CSV, TSV, JSON, Parquet)",
      },
    },
    required: ["sql"],
  };

  protected async doExecute(args: QueryArgs): Promise<ToolResponse> {
    // Require at least one data source
    if (!args.file_path && (!args.files || args.files.length === 0)) {
      return errorResponse("Either file_path or files must be provided");
    }

    try {
      const result = await queryFile({
        filePath: args.file_path,
        files: args.files,
        sql: args.sql,
        limit: args.limit,
        encoding: args.encoding,
        outputPath: args.output_path,
      });

      if (result.outputPath) {
        return jsonResponse({
          message: `Results written to ${result.outputPath}`,
          row_count: result.rowCount,
          output_path: result.outputPath,
        });
      }

      return jsonResponse({
        rows: result.rows,
        row_count: result.rowCount,
      });
    } catch (error) {
      return errorResponse(sanitizeDuckDBError(error));
    }
  }
}
