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
import { checkDocument, formatWriteLint, isReasonGiven } from "../../../services/document-lint.js";

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
 * What `sizeExemption` was given, as one of three intents.
 *
 * `null` means remove, and a client that renders tool arguments as strings
 * cannot send it: what arrives is `"null"`, which 2.0.1 stored as the reason. So
 * the call `stale-size-exemption` recommends did nothing and the finding came
 * back unchanged. An empty string is accepted as remove for that reason -- it is
 * the one "no value" a stringifying client can express -- and the placeholders
 * are refused rather than stored, because a document whose reason reads "null"
 * is one the next reader cannot make sense of.
 */
function readSizeExemption(value: string | null | undefined):
  | { kind: "unchanged" }
  | { kind: "remove" }
  | { kind: "set"; reason: string }
  | { kind: "refused"; given: string } {
  if (value === undefined) return { kind: "unchanged" };
  if (value === null) return { kind: "remove" };

  const trimmed = value.trim();
  if (trimmed === "") return { kind: "remove" };
  if (!isReasonGiven(trimmed)) return { kind: "refused", given: trimmed };
  return { kind: "set", reason: value };
}

/** The refusal, naming both ways to remove it and what a reason is for. */
function refuseSizeExemption(params: { id: string; given: string }): ToolResponse {
  const { id, given } = params;
  return errorResponse(
    `\`sizeExemption: "${given}"\` is not a reason for keeping the document whole, and storing it would leave the next reader unable to tell a decision from a warning nobody got to.` +
    formatNextActions([
      {
        action: "update",
        description: "Remove the exemption",
        example: `instruction(action: "update", id: "${id}", sizeExemption: "")`,
      },
      {
        action: "update",
        description: "Say why the document stays whole",
        example: `instruction(action: "update", id: "${id}", sizeExemption: "<why>")`,
      },
    ]));
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

    // Generate content with frontmatter
    const finalContent = this.generateContentWithFrontmatter({
      content,
      description,
      whenToUse,
      relatedDocs,
      sizeExemption: exemption.kind === "set" ? exemption.reason : exemption.kind === "remove" ? null : undefined,
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
    sizeExemption?: string | null;
  }): string {
    const { content, description, whenToUse, relatedDocs, sizeExemption } = params;

    const fromContent = parseFrontmatter(content);
    const bodyContent = stripFrontmatter(content);

    return updateFrontmatter({
      content: bodyContent,
      frontmatter: {
        ...fromContent,
        description,
        whenToUse,
        relatedDocs: relatedDocs ?? fromContent.relatedDocs,
        // `null` is "explicitly none", which is what an empty string at creation
        // means; `undefined` is "nothing said", which falls back to whatever the
        // frontmatter inside `content` claimed.
        sizeExemption: sizeExemption === null ? undefined : (sizeExemption ?? fromContent.sizeExemption),
        // The draft is entering the workflow, whatever the content claimed.
        status: "editing",
      },
    });
  }
}
