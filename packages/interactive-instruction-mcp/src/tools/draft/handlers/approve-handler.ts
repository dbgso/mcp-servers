import type { ToolResult, DraftActionHandler, DraftActionParams, DraftActionContext } from "../../../types/index.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import {
  requestApproval,
  validateApproval,
  getApprovalRequestedMessage,
  getApprovalRejectionMessage,
} from "mcp-shared";

export class ApproveHandler implements DraftActionHandler {
  async execute(params: {
    actionParams: DraftActionParams;
    context: DraftActionContext;
  }): Promise<ToolResult> {
    const { id, targetId, approvalToken } = params.actionParams;
    const { reader } = params.context;

    if (!id) {
      return {
        content: [
          { type: "text" as const, text: "Error: id is required for approve action" },
        ],
        isError: true,
      };
    }

    const requestId = `draft-approve-${id}`;

    // If no token provided, request approval via notification
    if (!approvalToken) {
      const { fallbackPath } = await requestApproval({
        request: {
          id: requestId,
          operation: "Approve Draft",
          description: `Approve and promote draft '${id}' to confirmed documentation`,
        },
        options: { timeoutMs: 5 * 60 * 1000 }, // 5 minutes
      });

      return {
        content: [
          { type: "text" as const, text: getApprovalRequestedMessage(fallbackPath) },
        ],
      };
    }

    // Validate token
    const validation = validateApproval({
      requestId,
      providedToken: approvalToken,
    });

    if (!validation.valid) {
      return {
        content: [
          {
            type: "text" as const,
            text: `${getApprovalRejectionMessage()}\n\nReason: ${validation.reason}`,
          },
        ],
        isError: true,
      };
    }

    // Token valid - promote the draft
    const sourceDraftId = DRAFT_PREFIX + id;
    const finalTargetId = targetId || id;

    const draftContent = await reader.getDocumentContent(sourceDraftId);
    if (draftContent === null) {
      return {
        content: [
          { type: "text" as const, text: `Error: Draft "${id}" not found.` },
        ],
        isError: true,
      };
    }

    const renameResult = await reader.renameDocument({
      oldId: sourceDraftId,
      newId: finalTargetId,
      overwrite: true,
    });
    if (!renameResult.success) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${renameResult.error}` },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Draft "${id}" approved and promoted to "${finalTargetId}" successfully.`,
        },
      ],
    };
  }
}
