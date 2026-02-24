import type { ToolResult, DraftActionHandler, DraftActionParams, DraftActionContext } from "../../../types/index.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import { draftWorkflowManager } from "../../../workflows/draft-workflow.js";
import { updateFrontmatter, stripFrontmatter } from "../../../utils/frontmatter-parser.js";

export class AddHandler implements DraftActionHandler {
  async execute(params: {
    actionParams: DraftActionParams;
    context: DraftActionContext;
  }): Promise<ToolResult> {
    const { id, content, description, whenToUse } = params.actionParams;
    const { reader } = params.context;

    if (!id || !content) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: id and content are required for add action",
          },
        ],
        isError: true,
      };
    }

    if (!description) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: description is required for add action",
          },
        ],
        isError: true,
      };
    }

    if (!whenToUse || whenToUse.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: whenToUse is required for add action (provide at least one usage scenario)",
          },
        ],
        isError: true,
      };
    }

    // Generate content with frontmatter
    const finalContent = this.generateContentWithFrontmatter({
      content,
      description,
      whenToUse,
    });

    const draftId = DRAFT_PREFIX + id;
    const result = await reader.addDocument({ id: draftId, content: finalContent });
    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    // Initialize workflow and transition to self_review
    const workflowResult = await draftWorkflowManager.trigger({
      id,
      triggerParams: { action: "submit", content },
    });

    const workflowStatus = workflowResult.ok
      ? `\n**Workflow:** editing → ${workflowResult.to}`
      : "";

    return {
      content: [
        {
          type: "text" as const,
          text: `Draft "${id}" created successfully.
Path: ${result.path}${workflowStatus}

---

## Next: Approval Workflow

1. \`draft(action: "approve", id: "${id}", notes: "<self-review>")\`
2. Explain to user (see \`help(id: "_mcp-interactive-instruction__draft-approval")\`)
3. \`draft(action: "approve", id: "${id}", confirmed: true)\`
4. User provides token → applied`,
        },
      ],
    };
  }

  /**
   * Generate content with frontmatter.
   */
  private generateContentWithFrontmatter(params: {
    content: string;
    description: string;
    whenToUse: string[];
  }): string {
    const { content, description, whenToUse } = params;

    // Strip any existing frontmatter from content
    const bodyContent = stripFrontmatter(content);

    return updateFrontmatter({
      content: bodyContent,
      frontmatter: {
        description,
        whenToUse,
      },
    });
  }
}
