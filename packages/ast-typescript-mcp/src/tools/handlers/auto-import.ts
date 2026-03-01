import { z } from "zod";
import { jsonResponse, errorResponse } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";

const AutoImportSchema = z.object({
  file_path: z
    .string()
    .describe("Absolute path to the TypeScript file to fix missing imports"),
  dry_run: z
    .boolean()
    .optional()
    .default(true)
    .describe("Preview changes without modifying files (default: true)"),
});

type AutoImportArgs = z.infer<typeof AutoImportSchema>;

export class AutoImportHandler extends BaseToolHandler<AutoImportArgs> {
  readonly name = "auto_import";
  readonly description =
    "Automatically add missing import statements. By default runs in dry-run mode (no files modified). Set dry_run=false to actually add imports.";
  readonly schema = AutoImportSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description:
          "Absolute path to the TypeScript file to fix missing imports",
      },
      dry_run: {
        type: "boolean",
        description: "Preview changes without modifying files (default: true)",
      },
    },
    required: ["file_path"],
  };

  protected async doExecute(args: AutoImportArgs): Promise<ToolResponse> {
    const { file_path, dry_run } = args;
    const handler = getHandler(file_path);

    if (!handler) {
      const extensions = getSupportedExtensions();
      return errorResponse(
        `Unsupported file type. Supported: ${extensions.join(", ")}`
      );
    }

    const result = await handler.autoImport({
      filePath: file_path,
      dryRun: dry_run,
    });
    return jsonResponse(result);
  }
}
