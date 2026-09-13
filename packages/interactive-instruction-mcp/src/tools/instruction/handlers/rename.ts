import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import { requestApproval, validateApproval, getApprovalRequestedMessage, getApprovalRejectionMessage } from "mcp-shared/approval";
import type { InstructionContext } from "../types.js";
import { formatNextActions, errorResponse, textResponse } from "../types.js";
import { DRAFT_PREFIX } from "../../../constants.js";

const schema = z.object({
  action: z.literal("rename"),
  id: z.string(),
  newId: z.string(),
  confirmed: z.boolean().optional(),
  approvalToken: z.string().optional(),
});

type Args = z.infer<typeof schema>;


/**
 * Binds a rename approval to both ends of the move. `destinationOccupied` is in
 * here so that a document appearing at the destination after approval fails the
 * match rather than the rename silently meaning something different.
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

export class RenameHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "rename";
  readonly help = "Rename a document (draft or promoted). Promoted renames require approval.";
  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id, newId, confirmed, approvalToken } = params.args;
    const { reader } = params.context;

    // P1: draft/promoted同名存在ガード
    const draftExists = await reader.documentExists(DRAFT_PREFIX + id);
    const promotedExists = await reader.documentExists(id);
    if (draftExists && promotedExists) {
      return errorResponse(`Both draft and promoted versions of "${id}" exist. Delete or promote the draft first, then retry.`);
    }

    // Draft rename - no approval needed
    if (draftExists) {
      return this.renameDraft({ reader, id, newId });
    }

    // Check promoted document exists
    if (!promotedExists) {
      return errorResponse(`Document "${id}" not found (neither as draft nor promoted).` +
        formatNextActions([{
          action: "list",
          description: "View all documents",
          example: `instruction(action: "list")`,
        }]));
    }

    // Preview mode
    if (!confirmed && !approvalToken) {
      return this.showPreview({ reader, id, newId });
    }

    // Request approval
    if (confirmed && !approvalToken) {
      return this.requestRenameApproval({ reader, id, newId });
    }

    // Apply with token
    if (approvalToken) {
      return this.applyRename({ reader, id, newId, approvalToken });
    }

    return errorResponse("Unexpected state");
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
      return errorResponse(`Error: ${result.error ?? "Unknown error"}`);
    }

    return textResponse(
      `Draft renamed from "${id}" to "${newId}" successfully.` +
      formatNextActions([
        { action: "read", description: "Read the renamed draft", example: `instruction(action: "read", id: "${newId}")` },
        { action: "list", description: "View all documents", example: `instruction(action: "list")` },
      ]),
    );
  }

  private async showPreview(params: {
    reader: InstructionContext["reader"];
    id: string;
    newId: string;
  }): Promise<ToolResponse> {
    const { reader, id, newId } = params;
    const backlinks = await reader.findBacklinks(id);

    let text = `## Rename Preview

**From:** ${id}
**To:** ${newId}
`;

    if (backlinks.length > 0) {
      text += `
**Backlinks to update (${backlinks.length}):**
${backlinks.map((doc) => `- ${doc.id}`).join("\n")}
`;
    }

    return textResponse(
      text +
      formatNextActions([{
        action: "rename",
        description: "Confirm rename",
        example: `instruction(action: "rename", id: "${id}", newId: "${newId}", confirmed: true)`,
      }]),
    );
  }

  private async requestRenameApproval(params: {
    reader: InstructionContext["reader"];
    id: string;
    newId: string;
  }): Promise<ToolResponse> {
    const { reader, id, newId } = params;
    const backlinks = await reader.findBacklinks(id);
    const requestId = `instruction::rename::${id}::${newId}`;

    const approvalResult = await requestApproval({
      request: {
        id: requestId,
        operation: "Rename document",
        description: `Rename "${id}" to "${newId}"${backlinks.length > 0 ? ` (updates ${backlinks.length} backlinks)` : ""}`,
        what: await buildRenameWhat({ reader, id, newId }),
      },
    });

    return textResponse(
      `# Approval Requested

**Rename:** ${id} → ${newId}
${backlinks.length > 0 ? `**Backlinks to update:** ${backlinks.length}` : ""}

${getApprovalRequestedMessage(approvalResult)}` +
      formatNextActions([{
        action: "rename",
        description: "Apply with token from user",
        example: `instruction(action: "rename", id: "${id}", newId: "${newId}", approvalToken: "<token>")`,
      }]),
    );
  }

  private async applyRename(params: {
    reader: InstructionContext["reader"];
    id: string;
    newId: string;
    approvalToken: string;
  }): Promise<ToolResponse> {
    const { reader, id, newId, approvalToken } = params;
    // No side record of what is pending: the request id already names both ends
    // of the move, and the approval store is what tracks it. The map that used
    // to live here duplicated that, and its `delete` ran before the success
    // check below -- so a failed rename spent the token AND dropped the entry,
    // leaving no way back.
    const requestId = `instruction::rename::${id}::${newId}`;

    // Checked before the token is spent. It used to run after
    // `validateApproval` had already consumed the approval, so losing this race
    // burned the token and left no way forward. It is also part of the bound
    // ground truth below, so a destination that appears after approval fails
    // the match rather than quietly changing what the rename means.
    if (await reader.documentExists(newId)) {
      return errorResponse(`Error: Document "${newId}" already exists. Choose a different name or delete the existing document first.`);
    }

    const validation = validateApproval({
      requestId,
      providedToken: approvalToken,
      currentWhat: await buildRenameWhat({ reader, id, newId }),
    });

    if (!validation.valid) {
      return errorResponse(`${getApprovalRejectionMessage()}\n\nReason: ${validation.reason}`);
    }

    const result = await reader.renameDocument({
      oldId: id,
      newId,
      updateBacklinks: true,
    });

    if (!result.success) {
      return errorResponse(`Error: ${result.error ?? "Unknown error"}`);
    }

    let text = `Successfully renamed "${id}" to "${newId}".`;
    if (result.updatedBacklinks && result.updatedBacklinks.length > 0) {
      text += `\n\n**Updated backlinks:**\n${result.updatedBacklinks.map((b) => `- ${b}`).join("\n")}`;
    }

    return textResponse(
      text +
      formatNextActions([
        { action: "read", description: "Read the renamed document", example: `instruction(action: "read", id: "${newId}")` },
        { action: "list", description: "View all documents", example: `instruction(action: "list")` },
      ]),
    );
  }
}
