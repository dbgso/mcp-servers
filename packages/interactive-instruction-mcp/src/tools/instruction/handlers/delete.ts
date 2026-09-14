import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { formatNextActions, errorResponse, textResponse } from "../types.js";
import { DRAFT_PREFIX, TRASH_DIR } from "../../../constants.js";
import { gateMutation } from "../../../services/mutation-gate.js";

const schema = z.object({
  action: z.literal("delete"),
  id: z.string().describe("Document ID to delete"),
  explanation: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Why this document should go, in your own words, as you told the user. Required for a promoted document, and identical across every attempt."
    ),
});

type Args = z.infer<typeof schema>;

/**
 * Binds a delete to the document as it stood when the run started. If the
 * content changes in between, the key no longer matches and the caller starts
 * over -- what was explained to the user is not what would now be deleted.
 */
async function buildDeleteWhat(params: {
  reader: InstructionContext["reader"];
  id: string;
}): Promise<string> {
  const { reader, id } = params;
  const content = await reader.getDocumentContent(id);
  return [`delete: ${id}`, `content:`, content ?? "(missing)"].join("\n");
}

export class DeleteHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "delete";
  readonly help = `Delete a draft or promoted document.

Usage:
- \`instruction(action: "delete", id: "doc-id")\` - Delete a draft (immediate)
- \`instruction(action: "delete", id: "doc-id", explanation: "...")\` - Delete a promoted
  document. The first attempts are refused with the backlinks it would break;
  repeat the identical call to go through. The file is moved to \`${TRASH_DIR}/\`, not erased.`;

  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id, explanation } = params.args;
    const { reader } = params.context;

    // P1: draft/promoted同名存在ガード
    const draftExists = await reader.documentExists(DRAFT_PREFIX + id);
    const promotedExists = await reader.documentExists(id);
    if (draftExists && promotedExists) {
      return errorResponse(`Both draft and promoted versions of "${id}" exist. Delete or promote the draft first, then retry.`);
    }

    // A draft is work nobody has accepted yet, and deleting one is what the
    // author does to their own scratch file. Nothing gates it.
    if (draftExists) {
      return this.deleteDraft({ reader, id });
    }

    if (!promotedExists) {
      return errorResponse(`Error: Document "${id}" not found (neither as draft nor promoted).`);
    }

    // Optional in the schema because a draft delete has nothing to explain;
    // for a promoted document it is the key the run is built on, so it cannot
    // be filled in with a default here.
    if (explanation === undefined) {
      return errorResponse(
        `Deleting the promoted document "${id}" needs an \`explanation\`: what this document is and why it should go, in the words you used with the user.` +
        formatNextActions([{
          action: "delete",
          description: "Say why, then repeat the identical call",
          example: `instruction(action: "delete", id: "${id}", explanation: "<why this should go>")`,
        }]));
    }

    return this.deletePromoted({ reader, id, explanation });
  }

  private async deleteDraft(params: {
    reader: InstructionContext["reader"];
    id: string;
  }): Promise<ToolResponse> {
    const { reader, id } = params;
    const draftId = DRAFT_PREFIX + id;
    const deleteResult = await reader.deleteDocument(draftId);
    if (!deleteResult.success) {
      return errorResponse(`Error: ${deleteResult.error ?? "Unknown error"}`);
    }

    return textResponse(
      `Draft "${id}" deleted successfully.` +
        formatNextActions([
          {
            action: "list",
            description: "View all documents",
            example: `instruction(action: "list")`,
          },
        ]),
    );
  }

  /**
   * The gated path.
   *
   * The backlink preview rides on the refusal rather than being a `confirmed`
   * step of its own. Seeing what the deletion breaks and being asked to
   * explain it are the same moment; as separate calls, the explanation got
   * written after the decision instead of as part of making it.
   */
  private async deletePromoted(params: {
    reader: InstructionContext["reader"];
    id: string;
    explanation: string;
  }): Promise<ToolResponse> {
    const { reader, id, explanation } = params;
    const backlinks = await reader.findBacklinks(id);

    const preview = [
      `## Deleting ${id}`,
      "",
      backlinks.length > 0
        ? `**${backlinks.length} document(s) link to it, and those links will dangle:**\n${backlinks
            .map((doc) => `- ${doc.id}`)
            .join("\n")}`
        : "Nothing links to it.",
      "",
      `The file moves to \`${TRASH_DIR}/\` rather than being erased.`,
    ].join("\n");

    return gateMutation({
      operation: "delete",
      subject: `instruction::delete::${id}`,
      what: await buildDeleteWhat({ reader, id }),
      explanation,
      preview,
      work: () => this.trashPromoted({ reader, id, backlinkCount: backlinks.length }),
    });
  }

  private async trashPromoted(params: {
    reader: InstructionContext["reader"];
    id: string;
    backlinkCount: number;
  }): Promise<ToolResponse> {
    const { reader, id, backlinkCount } = params;

    const result = await reader.trashDocument(id);
    if (!result.success) {
      return errorResponse(`Error: ${result.error ?? "Unknown error"}`);
    }

    const dangling =
      backlinkCount > 0
        ? `\n\n${backlinkCount} document(s) still link to "${id}". \`graph\` draws links to documents that no longer exist, so they can be found and fixed.`
        : "";

    return textResponse(
      `Document "${id}" deleted.

Moved to: ${result.trashPath ?? `${TRASH_DIR}/`}

Nothing reads that directory, so the document is gone from every listing; move the file back to restore it.${dangling}` +
        formatNextActions([
          {
            action: "list",
            description: "View all documents",
            example: `instruction(action: "list")`,
          },
        ]),
    );
  }
}
