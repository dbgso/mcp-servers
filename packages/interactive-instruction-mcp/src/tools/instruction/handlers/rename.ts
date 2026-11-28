import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { formatNextActions, errorResponse, textResponse } from "../types.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import { gateMutation } from "../../../services/mutation-gate.js";
import { resolveVersions, refuseAmbiguousId } from "./document-versions.js";

const schema = z.object({
  action: z.literal("rename"),
  id: z.string(),
  newId: z.string(),
  explanation: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Why this document should move, in your own words, as you told the user. Required for a promoted document, and identical across every attempt."
    ),
});

type Args = z.infer<typeof schema>;


/**
 * Binds a rename to both ends of the move. `destinationOccupied` is in here so
 * that a document appearing at the destination mid-run fails the match rather
 * than the rename silently meaning something different.
 */
async function buildRenameWhat(params: {
  reader: InstructionContext["reader"];
  id: string;
  newId: string;
}): Promise<string> {
  const { reader, id, newId } = params;
  const destinationOccupied = await reader.documentExists(newId);
  return [
    `rename: ${id}`,
    `to: ${newId}`,
    `destinationOccupied: ${destinationOccupied ? "yes" : "no"}`,
  ].join("\n");
}

/** `renameDocument` reports failure without always saying why. */
function renameFailure(error: string | undefined): ToolResponse {
  return errorResponse(`Error: ${error ?? "Unknown error"}`);
}

function refuseMissingDocument(params: { id: string; newId: string }): ToolResponse {
  const { id } = params;
  return errorResponse(`Document "${id}" not found (neither as draft nor promoted).` +
    formatNextActions([{
      action: "list",
      description: "View all documents",
      example: `instruction(action: "list")`,
    }]));
}

/**
 * Optional in the schema because a draft rename has nothing to explain; for a
 * promoted document it is the key the run is built on.
 */
function refuseMissingExplanation(params: { id: string; newId: string }): ToolResponse {
  const { id, newId } = params;
  return errorResponse(
    `Renaming the promoted document "${id}" needs an \`explanation\`: why it should move, in the words you used with the user.` +
    formatNextActions([{
      action: "rename",
      description: "Say why, then repeat the identical call",
      example: `instruction(action: "rename", id: "${id}", newId: "${newId}", explanation: "<why it should move>")`,
    }]));
}

function refuseOccupiedDestination(newId: string): ToolResponse {
  return errorResponse(`Error: Document "${newId}" already exists. Choose a different name or delete the existing document first.`);
}

/**
 * The backlink list rides on the refusal rather than being a `confirmed` step of
 * its own: seeing which documents get edited and being asked to explain the move
 * are the same moment.
 */
function renamePreview(params: { id: string; newId: string; backlinks: { id: string }[] }): string {
  const { id, newId, backlinks } = params;
  return [
    `## Renaming ${id} → ${newId}`,
    "",
    backlinks.length > 0
      ? `**${backlinks.length} document(s) link to it and will be edited to point at the new id:**\n${backlinks
          .map((doc) => `- ${doc.id}`)
          .join("\n")}`
      : "Nothing links to it.",
  ].join("\n");
}

/** Only reported when there were any: an empty list would read as a failure. */
function backlinkSection(updated: string[] | undefined): string {
  if (updated && updated.length > 0) {
    return `\n\n**Updated backlinks:**\n${updated.map((b) => `- ${b}`).join("\n")}`;
  }
  return "";
}

export class RenameHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "rename";
  readonly help = `Rename a document (draft or promoted).

A draft rename is immediate. Renaming a promoted document rewrites every
backlink to it, so the first attempts are refused with the list of documents
that would be edited; repeat the identical call, with the same \`explanation\`,
to go through.`;
  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id, newId, explanation } = params.args;
    const { reader } = params.context;

    const versions = await resolveVersions({ reader, id });
    if (versions === "ambiguous") return refuseAmbiguousId(id);
    // A draft rename is immediate: nothing links to a draft by its plain id.
    if (versions === "draft") return this.renameDraft({ reader, id, newId });
    if (versions === "missing") return refuseMissingDocument({ id, newId });
    return this.renamePromoted({ reader, id, newId, explanation });
  }

  private async renameDraft(params: {
    reader: InstructionContext["reader"];
    id: string;
    newId: string;
  }): Promise<ToolResponse> {
    const { reader, id, newId } = params;
    const oldDraftId = DRAFT_PREFIX + id;
    const newDraftId = DRAFT_PREFIX + newId;

    // Check if destination already exists
    const destExists = await reader.documentExists(newDraftId);
    if (destExists) {
      return errorResponse(`Error: Draft "${newId}" already exists. Choose a different name or delete the existing draft first.`);
    }

    const result = await reader.renameDocument({
      oldId: oldDraftId,
      newId: newDraftId,
    });

    if (!result.success) {
      return renameFailure(result.error);
    }

    return textResponse(
      `Draft renamed from "${id}" to "${newId}" successfully.` +
      formatNextActions([
        { action: "read", description: "Read the renamed draft", example: `instruction(action: "read", id: "${newId}")` },
        { action: "list", description: "View all documents", example: `instruction(action: "list")` },
      ]),
    );
  }

  /**
   * The gated path.
   *
   * The backlink list rides on the refusal rather than being a `confirmed`
   * step of its own: seeing which documents get edited and being asked to
   * explain the move are the same moment.
   */
  private async renamePromoted(params: {
    reader: InstructionContext["reader"];
    id: string;
    newId: string;
    explanation: string | undefined;
  }): Promise<ToolResponse> {
    const { reader, id, newId, explanation } = params;

    if (explanation === undefined) return refuseMissingExplanation({ id, newId });

    // Checked before the run starts rather than after it passes. It is also
    // part of the bound `what` below, so a destination that appears mid-run
    // breaks the key instead of quietly changing what the rename means.
    if (await reader.documentExists(newId)) {
      return refuseOccupiedDestination(newId);
    }

    const backlinks = await reader.findBacklinks(id);
    const preview = renamePreview({ id, newId, backlinks });

    return gateMutation({
      operation: "rename",
      subject: `instruction::rename::${id}::${newId}`,
      what: await buildRenameWhat({ reader, id, newId }),
      explanation,
      preview,
      work: () => this.applyRename({ reader, id, newId }),
    });
  }

  private async applyRename(params: {
    reader: InstructionContext["reader"];
    id: string;
    newId: string;
  }): Promise<ToolResponse> {
    const { reader, id, newId } = params;

    const result = await reader.renameDocument({
      oldId: id,
      newId,
      updateBacklinks: true,
    });

    if (!result.success) {
      return renameFailure(result.error);
    }

    return textResponse(
      `Successfully renamed "${id}" to "${newId}".` +
      backlinkSection(result.updatedBacklinks) +
      formatNextActions([
        { action: "read", description: "Read the renamed document", example: `instruction(action: "read", id: "${newId}")` },
        { action: "list", description: "View all documents", example: `instruction(action: "list")` },
      ]),
    );
  }
}
