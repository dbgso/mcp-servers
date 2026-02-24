import type { ToolResult, DraftActionHandler, DraftActionParams, DraftActionContext } from "../../../types/index.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import { draftWorkflowManager } from "../../../workflows/draft-workflow.js";
import { updateFrontmatter, parseFrontmatter, stripFrontmatter } from "../../../utils/frontmatter-parser.js";

export class UpdateHandler implements DraftActionHandler {
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
            text: "Error: id and content are required for update action",
          },
        ],
        isError: true,
      };
    }

    const draftId = DRAFT_PREFIX + id;

    // Get existing content to preserve frontmatter if not overridden
    const existingContent = await reader.getDocumentContent(draftId);
    const existingFrontmatter = existingContent ? parseFrontmatter(existingContent) : {};

    // Generate content with frontmatter
    const finalContent = this.generateContentWithFrontmatter({
      content,
      description,
      whenToUse,
      existingFrontmatter,
    });

    const result = await reader.updateDocument({ id: draftId, content: finalContent });
    if (!result.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${result.error}`,
          },
        ],
        isError: true,
      };
    }

    // Reset workflow to self_review (content changed, need re-review)
    draftWorkflowManager.clear({ id });
    const workflowResult = await draftWorkflowManager.trigger({
      id,
      triggerParams: { action: "submit", content },
    });

    const workflowStatus = workflowResult.ok
      ? `\n**Workflow:** reset → ${workflowResult.to}`
      : "";

    return {
      content: [
        {
          type: "text" as const,
          text: `Draft "${id}" updated successfully.
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
   * Generate content with frontmatter, preserving existing if not overridden.
   */
  private generateContentWithFrontmatter(params: {
    content: string;
    description?: string;
    whenToUse?: string[];
    existingFrontmatter: { description?: string; whenToUse?: string[] };
  }): string {
    const { content, description, whenToUse, existingFrontmatter } = params;

    // Check if new content already has frontmatter
    const newFrontmatter = parseFrontmatter(content);
    const bodyContent = stripFrontmatter(content);

    // Priority: explicit params > new content frontmatter > existing frontmatter > infer
    const finalDescription = description
      ?? newFrontmatter.description
      ?? existingFrontmatter.description
      ?? this.inferDescription(bodyContent);

    const finalWhenToUse = whenToUse
      ?? newFrontmatter.whenToUse
      ?? existingFrontmatter.whenToUse
      ?? undefined;

    // If no metadata, return original content
    if (!finalDescription && !finalWhenToUse) {
      return content;
    }

    return updateFrontmatter({
      content: bodyContent,
      frontmatter: {
        description: finalDescription,
        whenToUse: finalWhenToUse,
      },
    });
  }

  /**
   * Infer description from first paragraph after title.
   */
  private inferDescription(content: string): string | undefined {
    const lines = content.split("\n");
    let foundTitle = false;
    const paragraphLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!foundTitle && trimmed === "") continue;
      if (!foundTitle && trimmed.startsWith("# ")) {
        foundTitle = true;
        continue;
      }
      if (foundTitle && trimmed === "" && paragraphLines.length === 0) continue;
      if (foundTitle && trimmed !== "") {
        if (trimmed.startsWith("#") || trimmed.startsWith("```")) break;
        paragraphLines.push(trimmed);
      }
      if (foundTitle && trimmed === "" && paragraphLines.length > 0) break;
    }

    return paragraphLines.length > 0 ? paragraphLines.join(" ") : undefined;
  }
}
