import type { ToolResult, DraftActionHandler, DraftActionParams, DraftActionContext } from "../../../types/index.js";
import type { MarkdownReader } from "../../../services/markdown-reader.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import {
  requestApproval,
  validateApproval,
  getApprovalRequestedMessage,
  getApprovalRejectionMessage,
} from "mcp-shared";

interface PendingRename {
  oldId: string;
  newId: string;
  timestamp: number;
}

const pendingRenames = new Map<string, PendingRename>();

export class RenameHandler implements DraftActionHandler {
  async execute(params: {
    actionParams: DraftActionParams;
    context: DraftActionContext;
  }): Promise<ToolResult> {
    const { id, newId, confirmed, approvalToken } = params.actionParams;
    const { reader } = params.context;

    // Validate required params
    if (!id || !newId) {
      return this.errorResult("id and newId are required for rename action");
    }

    // Draft rename - no approval needed
    const isDraft = await reader.documentExists(DRAFT_PREFIX + id);
    if (isDraft) {
      return this.renameDraft({ reader, id, newId });
    }

    // Check promoted document exists
    const isPromoted = await reader.documentExists(id);
    if (!isPromoted) {
      return this.errorResult(`Document "${id}" not found (neither as draft nor promoted).`);
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

    return this.errorResult("Unexpected state");
  }

  private async renameDraft(params: {
    reader: MarkdownReader;
    id: string;
    newId: string;
  }): Promise<ToolResult> {
    const { reader, id, newId } = params;
    const oldDraftId = DRAFT_PREFIX + id;
    const newDraftId = DRAFT_PREFIX + newId;
    const result = await reader.renameDocument({
      oldId: oldDraftId,
      newId: newDraftId,
    });

    if (!result.success) {
      return this.errorResult(result.error ?? "Unknown error");
    }

    return this.successResult(`Draft renamed from "${id}" to "${newId}" successfully.`);
  }

  private async showPreview(params: {
    reader: MarkdownReader;
    id: string;
    newId: string;
  }): Promise<ToolResult> {
    const { reader, id, newId } = params;
    const backlinks = await reader.findBacklinks(id);

    let text = `## Rename Preview

**From:** ${id}
**To:** ${newId}
`;

    if (backlinks.length > 0) {
      text += `
**Backlinks to update (${backlinks.length}):**
${backlinks.map(doc => `- ${doc.id}`).join("\n")}
`;
    }

    text += `
---

To proceed, call:
\`\`\`
draft(action: "rename", id: "${id}", newId: "${newId}", confirmed: true)
\`\`\``;

    return this.successResult(text);
  }

  private async requestRenameApproval(params: {
    reader: MarkdownReader;
    id: string;
    newId: string;
  }): Promise<ToolResult> {
    const { reader, id, newId } = params;
    const backlinks = await reader.findBacklinks(id);
    const requestId = `rename-${id}-${newId}`;

    pendingRenames.set(requestId, {
      oldId: id,
      newId,
      timestamp: Date.now(),
    });

    const approvalResult = await requestApproval({
      request: {
        id: requestId,
        operation: "Rename document",
        description: `Rename "${id}" to "${newId}"${backlinks.length > 0 ? ` (updates ${backlinks.length} backlinks)` : ""}`,
      },
    });

    const text = `# Approval Requested

**Rename:** ${id} → ${newId}
${backlinks.length > 0 ? `**Backlinks to update:** ${backlinks.length}` : ""}

${getApprovalRequestedMessage(approvalResult.fallbackPath)}

When user provides the token, call:
\`\`\`
draft(action: "rename", id: "${id}", newId: "${newId}", approvalToken: "<token>")
\`\`\``;

    return this.successResult(text);
  }

  private async applyRename(params: {
    reader: MarkdownReader;
    id: string;
    newId: string;
    approvalToken: string;
  }): Promise<ToolResult> {
    const { reader, id, newId, approvalToken } = params;
    const requestId = `rename-${id}-${newId}`;
    const pending = pendingRenames.get(requestId);

    if (!pending) {
      return this.errorResult(
        `No pending rename found for "${id}" → "${newId}". Please start the approval workflow again.`
      );
    }

    const validation = validateApproval({
      requestId,
      providedToken: approvalToken,
    });

    if (!validation.valid) {
      return this.errorResult(
        `${getApprovalRejectionMessage()}\n\nReason: ${validation.reason}`
      );
    }

    const result = await reader.renameDocument({
      oldId: id,
      newId,
      updateBacklinks: true,
    });

    pendingRenames.delete(requestId);

    if (!result.success) {
      return this.errorResult(result.error ?? "Unknown error");
    }

    let text = `Successfully renamed "${id}" to "${newId}".`;
    if (result.updatedBacklinks && result.updatedBacklinks.length > 0) {
      text += `\n\n**Updated backlinks:**\n${result.updatedBacklinks.map(b => `- ${b}`).join("\n")}`;
    }

    return this.successResult(text);
  }

  private errorResult(message: string): ToolResult {
    return {
      content: [{ type: "text" as const, text: `Error: ${message}` }],
      isError: true,
    };
  }

  private successResult(text: string): ToolResult {
    return {
      content: [{ type: "text" as const, text }],
    };
  }
}
