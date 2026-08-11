import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import { requestApproval, validateApproval, getApprovalRequestedMessage, getApprovalRejectionMessage } from "mcp-shared/approval";
import type { InstructionContext } from "../types.js";
import { formatNextActions, errorResponse, textResponse } from "../types.js";
import { DRAFT_PREFIX } from "../../../constants.js";

const schema = z.object({
  action: z.literal("delete"),
  id: z.string().describe("Document ID to delete"),
  confirmed: z.boolean().optional().describe("Confirm deletion of promoted document"),
  approvalToken: z.string().optional().describe("Approval token from user"),
});

type Args = z.infer<typeof schema>;


export class DeleteHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "delete";
  readonly help = `Delete a draft or promoted document.

Usage:
- \`instruction(action: "delete", id: "doc-id")\` - Delete a draft (immediate) or preview promoted deletion
- \`instruction(action: "delete", id: "doc-id", confirmed: true)\` - Request approval for promoted deletion
- \`instruction(action: "delete", id: "doc-id", approvalToken: "<token>")\` - Apply with token`;

  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id, confirmed, approvalToken } = params.args;
    const { reader } = params.context;

    // P1: draft/promoted同名存在ガード
    const draftExists = await reader.documentExists(DRAFT_PREFIX + id);
    const promotedExists = await reader.documentExists(id);
    if (draftExists && promotedExists) {
      return errorResponse(`Both draft and promoted versions of "${id}" exist. Delete or promote the draft first, then retry.`);
    }

    // Draft delete - no approval needed
    if (draftExists) {
      return this.deleteDraft({ reader, id });
    }

    // Check promoted document exists
    if (!promotedExists) {
      return errorResponse(`Error: Document "${id}" not found (neither as draft nor promoted).`);
    }

    // Promoted delete - requires approval

    // Preview mode
    if (!confirmed && !approvalToken) {
      return this.showPreview({ reader, id });
    }

    // Request approval
    if (confirmed && !approvalToken) {
      return this.requestDeleteApproval({ reader, id });
    }

    // Apply with token
    if (approvalToken) {
      return this.applyDelete({ reader, id, approvalToken });
    }

    return errorResponse("Error: Unexpected state");
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

  private async showPreview(params: {
    reader: InstructionContext["reader"];
    id: string;
  }): Promise<ToolResponse> {
    const { reader, id } = params;
    const backlinks = await reader.findBacklinks(id);

    let text = `## Delete Preview

**Document:** ${id}
**Type:** Promoted (approval required)
`;

    if (backlinks.length > 0) {
      text += `
**Warning: Referenced by ${backlinks.length} document(s):**
${backlinks.map((doc) => `- ${doc.id}`).join("\n")}
`;
    }

    return textResponse(
      text +
        formatNextActions([
          {
            action: "delete",
            description: "Confirm deletion",
            example: `instruction(action: "delete", id: "${id}", confirmed: true)`,
          },
        ]),
    );
  }

  private async requestDeleteApproval(params: {
    reader: InstructionContext["reader"];
    id: string;
  }): Promise<ToolResponse> {
    const { reader, id } = params;
    const backlinks = await reader.findBacklinks(id);
    const requestId = `instruction::delete::${id}`;

    const approvalResult = await requestApproval({
      request: {
        id: requestId,
        operation: "Delete document",
        description: `Delete "${id}"${backlinks.length > 0 ? ` (referenced by ${backlinks.length} documents)` : ""}`,
      },
    });

    return textResponse(
      `# Approval Requested

**Delete:** ${id}
${backlinks.length > 0 ? `**Warning:** Referenced by ${backlinks.length} document(s)` : ""}

${getApprovalRequestedMessage(approvalResult.fallbackPath)}` +
        formatNextActions([
          {
            action: "delete",
            description: "Apply with token from user",
            example: `instruction(action: "delete", id: "${id}", approvalToken: "<token>")`,
          },
        ]),
    );
  }

  private async applyDelete(params: {
    reader: InstructionContext["reader"];
    id: string;
    approvalToken: string;
  }): Promise<ToolResponse> {
    const { reader, id, approvalToken } = params;
    const requestId = `instruction::delete::${id}`;

    const validation = validateApproval({
      requestId,
      providedToken: approvalToken,
    });

    if (!validation.valid) {
      return errorResponse(`${getApprovalRejectionMessage()}\n\nReason: ${validation.reason}`);
    }

    const deleteResult = await reader.deleteDocument(id);
    if (!deleteResult.success) {
      return errorResponse(`Error: ${deleteResult.error ?? "Unknown error"}`);
    }

    return textResponse(
      `Document "${id}" deleted successfully.` +
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
