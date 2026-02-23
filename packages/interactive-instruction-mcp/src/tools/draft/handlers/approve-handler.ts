import type { ToolResult, DraftActionHandler, DraftActionParams, DraftActionContext } from "../../../types/index.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import {
  requestApproval,
  validateApproval,
  getApprovalRequestedMessage,
  getApprovalRejectionMessage,
} from "mcp-shared";
import {
  draftWorkflowManager,
  stateDescriptions,
  type DraftState,
} from "../../../workflows/draft-workflow.js";

export class ApproveHandler implements DraftActionHandler {
  async execute(params: {
    actionParams: DraftActionParams;
    context: DraftActionContext;
  }): Promise<ToolResult> {
    const { id, ids, targetId, approvalToken, notes, confirmed, force } = params.actionParams;
    const { reader } = params.context;

    // Batch approval mode
    if (ids) {
      return this.handleBatchApproval({ ids, confirmed, approvalToken, reader });
    }

    if (!id) {
      return {
        content: [
          { type: "text" as const, text: "Error: id or ids is required for approve action" },
        ],
        isError: true,
      };
    }

    // Get current workflow state
    const status = await draftWorkflowManager.getStatus({ id });
    const currentState: DraftState = status?.state ?? "editing";

    // If token provided, validate and complete the workflow
    if (approvalToken) {
      return this.handleApprovalWithToken({
        id,
        targetId,
        approvalToken,
        currentState,
        reader,
      });
    }

    // No token - need to progress workflow
    return this.handleApprovalRequest({
      id,
      targetId,
      notes,
      confirmed,
      force,
      currentState,
      reader,
    });
  }

  private async handleApprovalRequest(params: {
    id: string;
    targetId?: string;
    notes?: string;
    confirmed?: boolean;
    force?: boolean;
    currentState: DraftState;
    reader: DraftActionContext["reader"];
  }): Promise<ToolResult> {
    const { id, targetId, notes, confirmed, force, currentState, reader } = params;

    // self_review state: need notes to proceed
    if (currentState === "self_review") {
      if (!notes) {
        return {
          content: [{
            type: "text" as const,
            text: `# Workflow: ${currentState}

**${stateDescriptions[currentState]}**

You must provide \`notes\` (your self-review of the content) to proceed.

Example:
\`\`\`
draft(action: "approve", id: "${id}", notes: "Reviewed: covers X and Y, ready for user")
\`\`\``,
          }],
          isError: true,
        };
      }

      // Transition self_review → user_reviewing
      const result = await draftWorkflowManager.trigger({
        id,
        triggerParams: { action: "review_complete", notes },
      });

      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      // Tell AI to explain to user - reference help for format rules
      return {
        content: [{
          type: "text" as const,
          text: `# Workflow: self_review → user_reviewing

Self-review recorded.

## Next Step: Explain to User

**See \`help(id: "_mcp-interactive-instruction__draft-approval")\` for explanation format rules.**

After explaining and user confirms:
\`\`\`
draft(action: "approve", id: "${id}", confirmed: true)
\`\`\``,
        }],
      };
    }

    // user_reviewing state: AI must explain, then call with confirmed: true
    if (currentState === "user_reviewing") {
      if (!confirmed) {
        return {
          content: [{
            type: "text" as const,
            text: `# Workflow: user_reviewing

**See \`help(id: "_mcp-interactive-instruction__draft-approval")\` for explanation format rules.**

After explaining and user confirms:
\`\`\`
draft(action: "approve", id: "${id}", confirmed: true)
\`\`\``,
          }],
          isError: true,
        };
      }

      // Check if there are other drafts in user_reviewing state (skip if force: true)
      if (!force) {
        const otherUserReviewing = await this.getOtherDraftsInState({
          currentId: id,
          state: "user_reviewing",
        });

        if (otherUserReviewing.length > 0) {
        const allIds = [id, ...otherUserReviewing];
        return {
          content: [{
            type: "text" as const,
            text: `# Warning: Multiple drafts ready for approval

You are approving "${id}" individually, but there are other drafts also in \`user_reviewing\` state:
${otherUserReviewing.map((otherId) => `- ${otherId}`).join("\n")}

**Recommended:** Use batch approval to confirm all at once with a single token:
\`\`\`
draft(action: "approve", ids: "${allIds.join(",")}", confirmed: true)
\`\`\`

If you want to proceed with just "${id}", call again with \`force: true\`:
\`\`\`
draft(action: "approve", id: "${id}", confirmed: true, force: true)
\`\`\``,
          }],
          isError: true,
        };
        }
      }

      // User confirmed - transition to pending_approval
      const confirmResult = await draftWorkflowManager.trigger({
        id,
        triggerParams: { action: "confirm", confirmed: true },
      });

      if (!confirmResult.ok) {
        return {
          content: [{ type: "text" as const, text: `Error: ${confirmResult.error}` }],
          isError: true,
        };
      }

      // Generate diff/summary for user to see
      const changeInfo = await this.generateChangeInfo({ id, targetId, reader });

      // Send approval notification
      const requestId = `draft-approve-${id}`;
      const approvalResult = await requestApproval({
        request: {
          id: requestId,
          operation: "Draft Approval",
          description: `Approve draft "${id}"?`,
        },
      });

      return {
        content: [{
          type: "text" as const,
          text: `# Approval Requested

${changeInfo}

---

${getApprovalRequestedMessage(approvalResult.fallbackPath)}

When user provides the token, call:
\`\`\`
draft(action: "approve", id: "${id}", approvalToken: "<token>")
\`\`\``,
        }],
      };
    }

    // Fallback for unexpected states
    return {
      content: [{
        type: "text" as const,
        text: `# Unexpected State

**Current state:** ${currentState}

Expected: self_review or user_reviewing

Please check the workflow status and try again.`,
      }],
      isError: true,
    };
  }

  /**
   * Generate change information for user to review.
   * - For CREATE (no existing target): show summary of content
   * - For UPDATE (target exists): show git-style diff
   */
  private async generateChangeInfo(params: {
    id: string;
    targetId?: string;
    reader: DraftActionContext["reader"];
  }): Promise<string> {
    const { id, targetId, reader } = params;
    const finalTargetId = targetId || id;
    const sourceDraftId = DRAFT_PREFIX + id;

    // Get file paths
    const draftPath = reader.getFilePath(sourceDraftId);
    const targetPath = reader.getFilePath(finalTargetId);

    // Get draft content
    const draftContent = await reader.getDocumentContent(sourceDraftId);
    if (!draftContent) {
      return `**Error:** Draft "${id}" not found.`;
    }

    // Check if target exists (UPDATE case)
    const existingContent = await reader.getDocumentContent(finalTargetId);

    if (existingContent === null) {
      // CREATE case: show summary
      return this.generateSummary({ content: draftContent, targetId: finalTargetId, targetPath });
    } else {
      // UPDATE case: show diff
      return this.generateDiff({ oldContent: existingContent, newContent: draftContent, targetId: finalTargetId, targetPath });
    }
  }

  /**
   * Generate a summary for CREATE case.
   * Extracts headers and key sections.
   */
  private generateSummary(params: { content: string; targetId: string; targetPath: string }): string {
    const { content, targetId, targetPath } = params;
    const lines = content.split("\n");
    const headers: string[] = [];

    for (const line of lines) {
      if (line.startsWith("#")) {
        headers.push(line);
      }
    }

    const headerSection = headers.length > 0
      ? headers.map((h) => `  ${h}`).join("\n")
      : "  (no headers found)";

    const lineCount = lines.length;
    const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;

    return `## New Document: ${targetId}

**Type:** CREATE (new file)
**Path:** \`${targetPath}\`
**Lines:** ${lineCount}
**Words:** ${wordCount}

### Structure
${headerSection}`;
  }

  /**
   * Generate a git-style unified diff for UPDATE case.
   */
  private generateDiff(params: { oldContent: string; newContent: string; targetId: string; targetPath: string }): string {
    const { oldContent, newContent, targetId, targetPath } = params;

    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");

    const diffLines: string[] = [];
    diffLines.push(`## Update: ${targetId}`);
    diffLines.push("");
    diffLines.push("**Type:** UPDATE (modification)");
    diffLines.push(`**Path:** \`${targetPath}\``);
    diffLines.push("");
    diffLines.push("```diff");

    // Simple line-by-line diff
    const maxLen = Math.max(oldLines.length, newLines.length);
    let addedCount = 0;
    let removedCount = 0;
    let unchangedCount = 0;

    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine === undefined && newLine !== undefined) {
        // Added line
        diffLines.push(`+ ${newLine}`);
        addedCount++;
      } else if (oldLine !== undefined && newLine === undefined) {
        // Removed line
        diffLines.push(`- ${oldLine}`);
        removedCount++;
      } else if (oldLine !== newLine) {
        // Changed line
        diffLines.push(`- ${oldLine}`);
        diffLines.push(`+ ${newLine}`);
        addedCount++;
        removedCount++;
      } else {
        // Unchanged - only show context around changes
        if (i > 0 && (oldLines[i - 1] !== newLines[i - 1])) {
          diffLines.push(`  ${oldLine}`);
        } else if (i < maxLen - 1 && (oldLines[i + 1] !== newLines[i + 1])) {
          diffLines.push(`  ${oldLine}`);
        }
        unchangedCount++;
      }
    }

    diffLines.push("```");
    diffLines.push("");
    diffLines.push(`**Summary:** +${addedCount} -${removedCount} (${unchangedCount} unchanged)`);

    return diffLines.join("\n");
  }

  /**
   * Handle batch approval of multiple drafts with a single token.
   */
  private async handleBatchApproval(params: {
    ids: string;
    confirmed?: boolean;
    approvalToken?: string;
    reader: DraftActionContext["reader"];
  }): Promise<ToolResult> {
    const { ids, confirmed, approvalToken, reader } = params;
    const idList = ids.split(",").map((id) => id.trim()).filter((id) => id.length > 0);

    if (idList.length === 0) {
      return {
        content: [{ type: "text" as const, text: "Error: No valid IDs provided" }],
        isError: true,
      };
    }

    // approvalToken takes precedence for security - prevents AI from bypassing user approval
    if (approvalToken) {
      // Fall through to token validation below
    } else if (confirmed) {
      // No token, just confirmed - transition and send notification
      return this.handleBatchConfirmed({ idList, reader });
    }

    // Check all drafts are in pending_approval state
    const notReady: string[] = [];
    for (const id of idList) {
      const status = await draftWorkflowManager.getStatus({ id });
      const state = status?.state ?? "editing";
      if (state !== "pending_approval") {
        notReady.push(`${id} (${state})`);
      }
    }

    if (notReady.length > 0) {
      return {
        content: [{
          type: "text" as const,
          text: `# Cannot batch approve

The following drafts are not in \`pending_approval\` state:
${notReady.map((s) => `- ${s}`).join("\n")}

Each draft must complete the workflow (notes → explain → confirmed) before batch approval.`,
        }],
        isError: true,
      };
    }

    // Generate batch request ID
    const batchRequestId = `draft-batch-${idList.join("-")}`;

    if (!approvalToken) {
      // Generate change info for all drafts
      const changeInfos: string[] = [];
      for (const id of idList) {
        const info = await this.generateChangeInfo({ id, reader });
        changeInfos.push(info);
      }

      // Send single approval notification
      const approvalResult = await requestApproval({
        request: {
          id: batchRequestId,
          operation: "Batch Draft Approval",
          description: `Approve ${idList.length} drafts: ${idList.join(", ")}`,
        },
      });

      return {
        content: [{
          type: "text" as const,
          text: `# Batch Approval Requested (${idList.length} drafts)

${changeInfos.join("\n\n---\n\n")}

---

${getApprovalRequestedMessage(approvalResult.fallbackPath)}

When user provides the token, call:
\`\`\`
draft(action: "approve", ids: "${ids}", approvalToken: "<token>")
\`\`\``,
        }],
      };
    }

    // Validate token
    const validation = validateApproval({
      requestId: batchRequestId,
      providedToken: approvalToken,
    });

    if (!validation.valid) {
      return {
        content: [{
          type: "text" as const,
          text: `${getApprovalRejectionMessage()}\n\nReason: ${validation.reason}`,
        }],
        isError: true,
      };
    }

    // Apply all drafts
    const results: string[] = [];
    for (const id of idList) {
      const sourceDraftId = DRAFT_PREFIX + id;

      // Transition to applied
      await draftWorkflowManager.trigger({
        id,
        triggerParams: { action: "approve" },
        approvalToken,
      });

      const draftContent = await reader.getDocumentContent(sourceDraftId);
      if (draftContent === null) {
        results.push(`❌ ${id}: Draft not found`);
        continue;
      }

      const renameResult = await reader.renameDocument({
        oldId: sourceDraftId,
        newId: id,
        overwrite: true,
      });

      if (renameResult.success) {
        draftWorkflowManager.clear({ id });
        results.push(`✅ ${id}: Applied`);
      } else {
        results.push(`❌ ${id}: ${renameResult.error}`);
      }
    }

    return {
      content: [{
        type: "text" as const,
        text: `# Batch Approval Complete

${results.join("\n")}`,
      }],
    };
  }

  /**
   * Handle batch confirmed: transition all drafts from user_reviewing to pending_approval
   * and send a single notification.
   */
  private async handleBatchConfirmed(params: {
    idList: string[];
    reader: DraftActionContext["reader"];
  }): Promise<ToolResult> {
    const { idList, reader } = params;

    // Check all drafts are in user_reviewing state
    const notReady: string[] = [];
    for (const id of idList) {
      const status = await draftWorkflowManager.getStatus({ id });
      const state = status?.state ?? "editing";
      if (state !== "user_reviewing") {
        notReady.push(`${id} (${state})`);
      }
    }

    if (notReady.length > 0) {
      return {
        content: [{
          type: "text" as const,
          text: `# Cannot batch confirm

The following drafts are not in \`user_reviewing\` state:
${notReady.map((s) => `- ${s}`).join("\n")}

Each draft must be explained to user first (notes → explain).`,
        }],
        isError: true,
      };
    }

    // Transition all drafts to pending_approval
    for (const id of idList) {
      await draftWorkflowManager.trigger({
        id,
        triggerParams: { action: "confirm", confirmed: true },
      });
    }

    // Generate change info for all drafts
    const changeInfos: string[] = [];
    for (const id of idList) {
      const info = await this.generateChangeInfo({ id, reader });
      changeInfos.push(info);
    }

    // Send single approval notification
    const batchRequestId = `draft-batch-${idList.join("-")}`;
    const approvalResult = await requestApproval({
      request: {
        id: batchRequestId,
        operation: "Batch Draft Approval",
        description: `Approve ${idList.length} drafts: ${idList.join(", ")}`,
      },
    });

    return {
      content: [{
        type: "text" as const,
        text: `# Batch Approval Requested (${idList.length} drafts)

${changeInfos.join("\n\n---\n\n")}

---

${getApprovalRequestedMessage(approvalResult.fallbackPath)}

When user provides the token, call:
\`\`\`
draft(action: "approve", ids: "${idList.join(",")}", approvalToken: "<token>")
\`\`\``,
      }],
    };
  }

  /**
   * Get other drafts in a specific state (excluding current draft)
   */
  private async getOtherDraftsInState(params: {
    currentId: string;
    state: DraftState;
  }): Promise<string[]> {
    const { currentId, state } = params;
    const allStatuses = await draftWorkflowManager.listAll();
    return allStatuses
      .filter((status) => status.id !== currentId && status.state === state)
      .map((status) => status.id);
  }

  private async handleApprovalWithToken(params: {
    id: string;
    targetId?: string;
    approvalToken: string;
    currentState: DraftState;
    reader: DraftActionContext["reader"];
  }): Promise<ToolResult> {
    const { id, targetId, approvalToken, currentState, reader } = params;

    // Must be in pending_approval state to use token
    if (currentState !== "pending_approval") {
      return {
        content: [{
          type: "text" as const,
          text: `# Cannot approve yet

**Current state:** ${currentState}
**Required state:** pending_approval

You must complete the workflow first:
1. Provide \`notes\` (self-review)
2. Explain to user in your own words
3. Call with \`confirmed: true\`

Example:
\`\`\`
draft(action: "approve", id: "${id}", notes: "...")
\`\`\``,
        }],
        isError: true,
      };
    }

    // Validate token
    const requestId = `draft-approve-${id}`;
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

    // Transition to applied
    await draftWorkflowManager.trigger({
      id,
      triggerParams: { action: "approve" },
      approvalToken,
    });

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

    // Clear the workflow from cache
    draftWorkflowManager.clear({ id });

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
