import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { formatNextActions, errorResponse, textResponse } from "../types.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import { draftWorkflowManager } from "../../../workflows/draft-workflow.js";
import { updateFrontmatter, stripFrontmatter } from "../../../utils/frontmatter-parser.js";

const schema = z.object({
  action: z.literal("add"),
  id: z.string().describe("Document ID for the new draft"),
  content: z.string().describe("Document content (markdown)"),
  description: z.string().describe("Short description of the document"),
  whenToUse: z.array(z.string()).describe("Usage scenarios for this document"),
  relatedDocs: z.array(z.string()).optional().describe("Related document IDs"),
});

type Args = z.infer<typeof schema>;


export class AddHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "add";
  readonly help = `Create a new draft document with frontmatter metadata.

Usage:
- \`instruction(action: "add", id: "doc-id", content: "...", description: "...", whenToUse: [...])\``;

  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id, content, description, whenToUse, relatedDocs } = params.args;
    const { reader } = params.context;

    // Generate content with frontmatter
    const finalContent = this.generateContentWithFrontmatter({
      content,
      description,
      whenToUse,
      relatedDocs,
    });

    const draftId = DRAFT_PREFIX + id;
    const result = await reader.addDocument({ id: draftId, content: finalContent });
    if (!result.success) {
      return errorResponse(`Error: ${result.error}`);
    }

    // Initialize workflow and transition to self_review
    const workflowResult = await draftWorkflowManager.trigger({
      id,
      triggerParams: { action: "submit", content },
    });

    const workflowStatus = workflowResult.ok
      ? `\n**Workflow:** editing → ${workflowResult.to}`
      : "";

    return textResponse(
      `Draft "${id}" created successfully.
Path: ${result.path}${workflowStatus}` +
        formatNextActions([
          {
            action: "approve",
            description: "Start approval workflow with self-review",
            example: `instruction(action: "approve", id: "${id}", notes: "<self-review>")`,
          },
          {
            action: "read",
            description: "Read approval format rules",
            example: `instruction(action: "read", id: "_mcp-interactive-instruction__draft-approval")`,
          },
        ]),
    );
  }

  /**
   * Generate content with frontmatter.
   */
  private generateContentWithFrontmatter(params: {
    content: string;
    description: string;
    whenToUse: string[];
    relatedDocs?: string[];
  }): string {
    const { content, description, whenToUse, relatedDocs } = params;

    // Strip any existing frontmatter from content
    const bodyContent = stripFrontmatter(content);

    return updateFrontmatter({
      content: bodyContent,
      frontmatter: {
        description,
        whenToUse,
        relatedDocs,
        status: "editing",
      },
    });
  }
}
