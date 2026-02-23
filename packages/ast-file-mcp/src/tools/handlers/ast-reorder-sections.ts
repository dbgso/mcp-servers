import { z } from "zod";
import { BaseToolHandler } from "../base-handler.js";
import type { ToolResponse } from "../types.js";
import { getHandler, getSupportedExtensions } from "../../handlers/index.js";
import { getErrorMessage } from "mcp-shared";

const ReorderSectionsSchema = z.object({
  file_path: z.string().describe("Absolute path to the source file"),
  target_path: z.string().optional().describe("Output path (defaults to source file)"),
  order: z.array(z.string()).describe("Section titles in desired order"),
  level: z.number().optional().describe("Section level (default: 1 for AsciiDoc ==, 2 for Markdown ##)"),
});

type ReorderSectionsArgs = z.infer<typeof ReorderSectionsSchema>;

export class AstReorderSectionsHandler extends BaseToolHandler<ReorderSectionsArgs> {
  readonly name = "ast_reorder_sections";
  readonly schema = ReorderSectionsSchema;

  get description(): string {
    const extensions = getSupportedExtensions();
    return `Reorder sections in a document. Supported extensions: ${extensions.join(", ")}. Sections not in the order list are appended at the end.`;
  }

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the source file",
      },
      target_path: {
        type: "string",
        description: "Output path (defaults to source file, i.e. in-place edit)",
      },
      order: {
        type: "array",
        items: { type: "string" },
        description: "Section titles in desired order",
      },
      level: {
        type: "number",
        description: "Section level (default: 1 for AsciiDoc ==, 2 for Markdown ##)",
      },
    },
    required: ["file_path", "order"],
  };

  protected async doExecute(args: ReorderSectionsArgs): Promise<ToolResponse> {
    const { file_path, target_path, order, level } = args;

    const handler = getHandler(file_path);
    if (!handler) {
      return {
        content: [{ type: "text", text: `Error: Unsupported file type` }],
        isError: true,
      };
    }

    try {
      // Default level: 1 for AsciiDoc (==), 2 for Markdown (##)
      const defaultLevel = handler.fileType === "asciidoc" ? 1 : 2;
      const sectionLevel = level ?? defaultLevel;

      await handler.reorderSections({
        filePath: file_path,
        targetPath: target_path,
        order,
        level: sectionLevel,
      });

      const outputPath = target_path ?? file_path;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            filePath: outputPath,
            order,
            message: `Sections reordered successfully`,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error: ${getErrorMessage(error)}`,
        }],
        isError: true,
      };
    }
  }
}
