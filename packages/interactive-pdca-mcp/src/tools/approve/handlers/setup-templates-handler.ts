import type {
  ToolResult,
  ApproveActionHandler,
  ApproveActionParams,
  ApproveActionContext,
} from "../../../types/index.js";
import { setupSelfReviewTemplates } from "../../../services/template-setup.js";

export class SetupTemplatesHandler implements ApproveActionHandler {
  async execute(params: {
    actionParams: ApproveActionParams;
    context: ApproveActionContext;
  }): Promise<ToolResult> {
    const { markdownDir } = params.context;

    try {
      const result = await setupSelfReviewTemplates(markdownDir);

      // Templates already exist
      if (result.action === "already_exists") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Self-review templates already exist at: ${result.path}`,
            },
          ],
        };
      }

      // Templates copied successfully
      if (result.action === "copied_templates") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Self-review templates have been set up at: ${result.path}\n\nYou can now customize these templates to match your project's review workflow.`,
            },
          ],
        };
      }

      // created_empty - this shouldn't happen when user explicitly calls setup_templates
      // but handle it gracefully
      return {
        content: [
          {
            type: "text" as const,
            text: `Created plan directory at: ${result.path}\n\nNote: Template files were not found in the package. Directory structure has been created.`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error setting up templates: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
}
