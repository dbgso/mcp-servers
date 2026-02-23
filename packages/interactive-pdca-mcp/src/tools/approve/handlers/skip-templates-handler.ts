import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  ToolResult,
  ApproveActionHandler,
  ApproveActionParams,
  ApproveActionContext,
} from "../../../types/index.js";
import { getErrorMessage } from "mcp-shared";

const PLAN_DIR_NAME = "_mcp-interactive-instruction/plan";

export class SkipTemplatesHandler implements ApproveActionHandler {
  async execute(params: {
    actionParams: ApproveActionParams;
    context: ApproveActionContext;
  }): Promise<ToolResult> {
    const { markdownDir } = params.context;
    const planDirPath = path.join(markdownDir, PLAN_DIR_NAME);

    try {
      await fs.mkdir(planDirPath, { recursive: true });

      return {
        content: [
          {
            type: "text" as const,
            text: `Created empty plan directory at: ${planDirPath}\n\nTemplate setup skipped. You can run \`approve(target: "setup_templates")\` later if you want to add templates.`,
          },
        ],
      };
    } catch (error) {
      const message = getErrorMessage(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error creating directory: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
}
