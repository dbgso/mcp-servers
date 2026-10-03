import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { TriggerResult } from "mcp-shared/workflow";
import type { InstructionContext } from "../types.js";
import { formatNextActions, errorResponse, textResponse } from "../types.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import {
  draftWorkflowManager,
  type DraftState,
  type DraftContext,
} from "../../../workflows/draft-workflow.js";
import {
  parseFrontmatter,
  updateFrontmatter,
  stripFrontmatter,
} from "../../../utils/frontmatter-parser.js";
import { checkDocument, formatWriteLint } from "../../../services/document-lint.js";
import { refuseUnreadableFrontmatter } from "./frontmatter-guard.js";
import {
  readSizeExemption,
  refuseSizeExemption,
  newSizeExemption,
  type SizeExemptionIntent,
} from "./size-exemption.js";

const schema = z.object({
  action: z.literal("add"),
  id: z.string().describe("Document ID for the new draft"),
  content: z.string().describe("Document content (markdown)"),
  description: z.string().describe("Short description of the document"),
  whenToUse: z.array(z.string()).describe("Usage scenarios for this document"),
  relatedDocs: z.array(z.string()).optional().describe("Related document IDs"),
  // Nullable to match `update`'s declaration of the same name. The tool merges
  // every handler's fields into one schema and the first declaration of a name
  // wins, so a stricter one here would have been what callers were validated
  // against -- and `update(sizeExemption: null)`, the documented way to remove
  // the field, was rejected at the tool boundary while passing every unit test
  // that called the handler directly. `null` means nothing on a new draft; it is
  // accepted and ignored, which is cheaper than two names for one field.
  sizeExemption: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Why this document stays whole although it is over the line limit -- a reference table is worth more in one piece, and a runbook read out of order is not a runbook. `lint` reports the reason instead of the warning, so the next reader can tell a decision from an unaddressed finding. Pass null to remove it."
    ),
});

type Args = z.infer<typeof schema>;


/**
 * The transition line, reported only when the trigger fired. A draft whose
 * workflow did not start is still a draft, so the failure is not worth a line in
 * the response its author reads.
 */
function workflowStatusLine(result: TriggerResult<DraftState, DraftContext>): string {
  if (!result.ok) return "";
  return `\n**Workflow:** editing → ${result.to}`;
}

export class AddHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "add";
  readonly help = `Create a new draft document with frontmatter metadata.

Usage:
- \`instruction(action: "add", id: "doc-id", content: "...", description: "...", whenToUse: [...])\`
- Add \`sizeExemption: "<why it stays whole>"\` for a document that is deliberately over the line limit`;

  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id, content, description, whenToUse, relatedDocs, sizeExemption } = params.args;
    const { reader } = params.context;

    const exemption = readSizeExemption(sizeExemption);
    if (exemption.kind === "refused") {
      return refuseSizeExemption({ id, given: exemption.given });
    }

    // `add` is documented as keeping the metadata written in `content`, with the
    // arguments winning where both say something. A block that does not parse
    // breaks that promise in silence -- a `relatedDocs` written there is simply
    // gone from the file that comes out.
    const unreadable = refuseUnreadableFrontmatter({ id, content });
    if (unreadable !== null) return unreadable;

    // Generate content with frontmatter
    const finalContent = this.generateContentWithFrontmatter({
      content,
      description,
      whenToUse,
      relatedDocs,
      exemption,
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

    const workflowStatus = workflowStatusLine(workflowResult);

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
    exemption: SizeExemptionIntent;
  }): string {
    const { content, description, whenToUse, relatedDocs, exemption } = params;

    const fromContent = parseFrontmatter(content);
    const bodyContent = stripFrontmatter(content);

    return updateFrontmatter({
      content: bodyContent,
      frontmatter: {
        ...fromContent,
        description,
        whenToUse,
        relatedDocs: relatedDocs ?? fromContent.relatedDocs,
        sizeExemption: newSizeExemption({ intent: exemption, existing: fromContent.sizeExemption }),
        // The draft is entering the workflow, whatever the content claimed.
        status: "editing",
      },
    });
  }
}
