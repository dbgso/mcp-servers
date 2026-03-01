import { z } from "zod";
import { formatMultiFileResponse, getErrorMessage } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "mcp-shared";
import { getHandler } from "../../handlers/index.js";

const LinkCheckSchema = z.object({
  file_path: z
    .union([z.string(), z.array(z.string())])
    .describe(
      "Absolute path(s) to the file(s) to check. Can be a single path or array of paths."
    ),
  check_external: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether to check external URLs (default: false)"),
  timeout: z
    .number()
    .optional()
    .default(5000)
    .describe(
      "Timeout for external URL checks in milliseconds (default: 5000)"
    ),
});

type LinkCheckArgs = z.infer<typeof LinkCheckSchema>;

export class LinkCheckHandler extends BaseToolHandler<LinkCheckArgs> {
  readonly name = "link_check";
  readonly schema = LinkCheckSchema;
  readonly description =
    "Check links in Markdown or AsciiDoc files. Returns valid, broken, and skipped links. Internal links are checked for file existence and heading anchors. External URLs are optionally checked via HTTP HEAD requests.";

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        oneOf: [
          { type: "string", description: "Single file path" },
          {
            type: "array",
            items: { type: "string" },
            description: "Array of file paths",
          },
        ],
        description: "Absolute path(s) to the file(s) to check",
      },
      check_external: {
        type: "boolean",
        description: "Whether to check external URLs (default: false)",
      },
      timeout: {
        type: "number",
        description:
          "Timeout for external URL checks in milliseconds (default: 5000)",
      },
    },
    required: ["file_path"],
  };

  protected async doExecute(args: LinkCheckArgs): Promise<ToolResponse> {
    const { file_path, check_external, timeout } = args;
    const filePaths = Array.isArray(file_path) ? file_path : [file_path];

    const results = await Promise.all(
      filePaths.map(async (fp) => {
        const handler = getHandler(fp);

        if (!handler) {
          return { filePath: fp, error: "Unsupported file type" };
        }

        // Polymorphism: all handlers implement checkLinks
        try {
          const result = await handler.checkLinks({
            filePath: fp,
            checkExternal: check_external,
            timeout,
          });
          return { filePath: fp, result };
        } catch (error) {
          return {
            filePath: fp,
            error: getErrorMessage(error),
          };
        }
      })
    );

    return formatMultiFileResponse(results);
  }
}
