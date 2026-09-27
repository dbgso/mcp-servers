import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { formatNextActions, errorResponse, textResponse } from "../types.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import { draftWorkflowManager } from "../../../workflows/draft-workflow.js";
import {
  parseFrontmatter,
  updateFrontmatter,
  stripFrontmatter,
} from "../../../utils/frontmatter-parser.js";
import { checkDocument, formatWriteLint } from "../../../services/document-lint.js";

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

    // What `lint` would say about this document, said now. The author is the
    // one person who still remembers why the document has the shape it has,
    // and `lint` is a separate call nobody makes until something else prompts
    // it -- by which time the draft is approved and the reason is gone.
    const lint = formatWriteLint(checkDocument({ docId: id, content: finalContent }));

    return textResponse(
      `Draft "${id}" created successfully.
Path: ${result.path}${workflowStatus}` +
        lint +
        formatNextActions([
          {
            action: "approve",
            description: "Start approval workflow with self-review",
            example: `instruction(action: "approve", id: "${id}", notes: "<self-review>")`,
          },
          {
            action: "read",
            description: "Read the draft back",
            example: `instruction(action: "read", id: "${id}")`,
          },
        ]),
    );
  }

  /**
   * Generate content with frontmatter.
   *
   * What the caller wrote in the content's own frontmatter is the base; the
   * arguments are written over the top. It used to be discarded outright, so
   * `relatedDocs` written there was dropped in silence -- reported as #50
   * after 7 documents lost 11 edges between them. Nothing about the document
   * said so, because the prose still read correctly; it showed up only when
   * the graph was drawn, which is the one place those links are used.
   *
   * Arguments win where both say something: they are the ones the tool
   * validated and the ones the caller passed most recently.
   */
  private generateContentWithFrontmatter(params: {
    content: string;
    description: string;
    whenToUse: string[];
    relatedDocs?: string[];
  }): string {
    const { content, description, whenToUse, relatedDocs } = params;

    const fromContent = parseFrontmatter(content);
    const bodyContent = stripFrontmatter(content);

    return updateFrontmatter({
      content: bodyContent,
      frontmatter: {
        ...fromContent,
        description,
        whenToUse,
        relatedDocs: relatedDocs ?? fromContent.relatedDocs,
        // The draft is entering the workflow, whatever the content claimed.
        status: "editing",
      },
    });
  }
}
