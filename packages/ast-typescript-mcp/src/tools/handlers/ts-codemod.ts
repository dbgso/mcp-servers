import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import { transformFiles } from "../../codemod/index.js";

const TsCodemodSchema = z.object({
  source: z
    .string()
    .describe("Source pattern to match (e.g., 'query(:[file], :[type])')"),
  target: z
    .string()
    .describe(
      "Target pattern for replacement (e.g., 'query({ filePath: :[file], queryType: :[type] })')"
    ),
  path: z
    .string()
    .describe("File or directory path to transform"),
  pattern: z
    .string()
    .optional()
    .describe("Glob pattern for files (e.g., '**/*.ts'). Default: **/*.{ts,tsx}"),
  dry_run: z
    .boolean()
    .optional()
    .default(true)
    .describe("Preview changes without modifying files (default: true)"),
});

type TsCodemodArgs = z.infer<typeof TsCodemodSchema>;

export class TsCodemodHandler extends BaseToolHandler<TsCodemodArgs> {
  readonly name = "ts_codemod";
  readonly description =
    "Transform TypeScript code using comby-style patterns. Use :[name] as placeholders that match balanced content (respecting brackets). By default runs in dry-run mode.";
  readonly schema = TsCodemodSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      source: {
        type: "string",
        description: "Source pattern to match (e.g., 'query(:[file], :[type])')",
      },
      target: {
        type: "string",
        description:
          "Target pattern for replacement (e.g., 'query({ filePath: :[file], queryType: :[type] })')",
      },
      path: {
        type: "string",
        description: "File or directory path to transform",
      },
      pattern: {
        type: "string",
        description: "Glob pattern for files (e.g., '**/*.ts')",
      },
      dry_run: {
        type: "boolean",
        description: "Preview changes without modifying files (default: true)",
      },
    },
    required: ["source", "target", "path"],
  };

  protected async doExecute(args: TsCodemodArgs): Promise<ToolResponse> {
    const { source, target, path, pattern, dry_run } = args;

    try {
      const result = await transformFiles({
        sourcePattern: source,
        targetPattern: target,
        path,
        filePattern: pattern,
        dryRun: dry_run,
      });

      return jsonResponse({
        success: true,
        dryRun: result.dryRun,
        totalMatches: result.totalMatches,
        filesModified: result.filesModified,
        changes: result.changes.map((c) => ({
          file: c.file,
          line: c.line,
          column: c.column,
          before: c.before,
          after: c.after,
        })),
      });
    } catch (error) {
      return errorResponse(
        `Codemod failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
