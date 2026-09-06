import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import { requestApproval, validateApproval, getApprovalRequestedMessage, getApprovalRejectionMessage } from "mcp-shared/approval";
import type { InstructionContext } from "../types.js";
import { formatNextActions, errorResponse, textResponse } from "../types.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import {
  draftWorkflowManager,
  stateDescriptions,
  type DraftState,
} from "../../../workflows/draft-workflow.js";
import { parseFrontmatter, updateFrontmatter, stripFrontmatter } from "../../../utils/frontmatter-parser.js";
import { generateDiff } from "../../../utils/diff-utils.js";

// --- 変更点1: zodスキーマでバリデーション（手動チェック不要に） ---
const schema = z.object({
  action: z.literal("approve"),
  id: z.string().optional(),
  ids: z.string().optional(),
  targetId: z.string().optional(),
  notes: z.string().optional(),
  confirmed: z.boolean().optional(),
  approvalToken: z.string().optional(),
  force: z.boolean().optional(),
});

type Args = z.infer<typeof schema>;

// --- 変更点2: requestId生成を統一 ---
function buildRequestId(parts: string[]): string {
  return `instruction::approve::${parts.join("::")}`;
}

function buildBatchRequestId(ids: string[]): string {
  return `instruction::approve-batch::${ids.join(",")}`;
}

// --- 変更点3: ToolResult → ToolResponse ヘルパー ---

// --- 変更点4: extends BaseActionHandler（旧: implements DraftActionHandler） ---
export class ApproveHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "approve";
  readonly help = "Progress through the approval workflow: notes → confirmed → token.";
  readonly schema = schema;

  // --- 変更点5: doExecute（旧: execute） args（旧: actionParams） ---
  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id, ids, targetId, approvalToken, notes, confirmed, force } = params.args;
    const { reader } = params.context;

    // Batch approval mode
    if (ids) {
      return this.handleBatchApproval({ ids, confirmed, approvalToken, reader });
    }

    if (!id) {
      return errorResponse("Error: id or ids is required for approve action");
    }

    const status = await draftWorkflowManager.getStatus({ id });
    const currentState: DraftState = status?.state ?? "editing";

    if (approvalToken) {
      return this.handleApprovalWithToken({ id, targetId, approvalToken, currentState, reader });
    }

    return this.handleApprovalRequest({ id, targetId, notes, confirmed, force, currentState, reader });
  }

  private async handleApprovalRequest(params: {
    id: string;
    targetId?: string;
    notes?: string;
    confirmed?: boolean;
    force?: boolean;
    currentState: DraftState;
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { id, targetId, notes, confirmed, force, currentState, reader } = params;

    // self_review state: need notes to proceed
    if (currentState === "self_review") {
      if (!notes) {
        // --- 変更点6: formatNextActionsで統一形式 ---
        return errorResponse(`# Workflow: ${currentState}

**${stateDescriptions[currentState]}**

You must provide \`notes\` (your self-review of the content) to proceed.` +
          formatNextActions([{
            action: "approve",
            description: "Provide self-review notes",
            example: `instruction(action: "approve", id: "${id}", notes: "Reviewed: covers X and Y, ready for user")`,
          }]));
      }

      const result = await draftWorkflowManager.trigger({
        id,
        triggerParams: { action: "review_complete", notes },
      });

      if (!result.ok) {
        return errorResponse(`Error: ${result.error}`);
      }

      await this.updateDraftFrontmatterStatus({ id, status: "user_reviewing", selfReviewNotes: notes, reader });

      return textResponse(
        `# Workflow: self_review → user_reviewing

Self-review recorded.

## Next Step: Explain to User` +
        formatNextActions([
          {
            action: "read",
            description: "Read approval format rules",
            example: `instruction(action: "read", id: "_mcp-interactive-instruction__draft-approval")`,
          },
          {
            action: "approve",
            description: "After explaining and user confirms",
            example: `instruction(action: "approve", id: "${id}", confirmed: true)`,
          },
        ]),
      );
    }

    // user_reviewing state
    if (currentState === "user_reviewing") {
      if (!confirmed) {
        return errorResponse(
          `# Workflow: user_reviewing` +
          formatNextActions([
            {
              action: "read",
              description: "Read approval format rules",
              example: `instruction(action: "read", id: "_mcp-interactive-instruction__draft-approval")`,
            },
            {
              action: "approve",
              description: "After explaining and user confirms",
              example: `instruction(action: "approve", id: "${id}", confirmed: true)`,
            },
          ]),
        );
      }

      // Check consecutive approvals
      if (!force) {
        const recentlyConfirmed = await this.getRecentlyConfirmedDrafts({ currentId: id, withinMs: 10_000 });
        if (recentlyConfirmed.length > 0) {
          const allIds = [id, ...recentlyConfirmed];
          return errorResponse(
            `# Warning: Consecutive approval requests detected

You just confirmed "${recentlyConfirmed.join(", ")}" within the last 10 seconds.
Now you're trying to confirm "${id}" separately.` +
            formatNextActions([
              {
                action: "approve",
                description: "Batch confirm all (recommended)",
                example: `instruction(action: "approve", ids: "${allIds.join(",")}", confirmed: true)`,
              },
              {
                action: "approve",
                description: `Proceed with just "${id}"`,
                example: `instruction(action: "approve", id: "${id}", confirmed: true, force: true)`,
              },
            ]),
          );
        }
      }

      // User confirmed - transition to pending_approval
      const confirmResult = await draftWorkflowManager.trigger({
        id,
        triggerParams: { action: "confirm", confirmed: true },
      });

      if (!confirmResult.ok) {
        return errorResponse(`Error: ${confirmResult.error}`);
      }

      await this.updateDraftFrontmatterStatus({
        id,
        status: "pending_approval",
        confirmedAt: new Date().toISOString(),
        reader,
      });

      const changeInfo = await this.generateChangeInfo({ id, targetId, reader });

      // --- 変更点2: requestId統一 ---
      const requestId = buildRequestId([id]);
      const approvalResult = await requestApproval({
        request: { id: requestId, operation: "Draft Approval", description: `Approve draft "${id}"?` },
      });

      return textResponse(
        `# Approval Requested

${changeInfo}

---

${getApprovalRequestedMessage(approvalResult)}` +
        formatNextActions([{
          action: "approve",
          description: "Apply with token from user",
          example: `instruction(action: "approve", id: "${id}", approvalToken: "<token>")`,
        }]),
      );
    }

    // Fallback for unexpected states
    return errorResponse(`# Unexpected State

**Current state:** ${currentState}

Expected: self_review or user_reviewing` +
      formatNextActions([{
        action: "approve",
        description: "Provide self-review notes to start",
        example: `instruction(action: "approve", id: "${id}", notes: "...")`,
      }]));
  }

  // --- ロジック変更なし: generateChangeInfo, generateSummary, generateDiff ---

  private async generateChangeInfo(params: {
    id: string;
    targetId?: string;
    reader: InstructionContext["reader"];
  }): Promise<string> {
    const { id, targetId, reader } = params;
    const finalTargetId = targetId || id;
    const sourceDraftId = DRAFT_PREFIX + id;
    const targetPath = reader.getFilePath(finalTargetId);
    const draftContent = await reader.getDocumentContent(sourceDraftId);
    if (!draftContent) return `**Error:** Draft "${id}" not found.`;
    const existingContent = await reader.getDocumentContent(finalTargetId);
    if (existingContent === null) {
      return this.generateSummary({ content: draftContent, targetId: finalTargetId, targetPath });
    }
    return this.generateDiffView({ oldContent: existingContent, newContent: draftContent, targetId: finalTargetId, targetPath });
  }

  private generateSummary(params: { content: string; targetId: string; targetPath: string }): string {
    const { content, targetId, targetPath } = params;
    const lines = content.split("\n");
    const headers = lines.filter((line) => line.startsWith("#"));
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

  private generateDiffView(params: { oldContent: string; newContent: string; targetId: string; targetPath: string }): string {
    const { oldContent, newContent, targetId, targetPath } = params;

    const diff = generateDiff({
      original: oldContent,
      updated: newContent,
      options: {
        originalName: `original: ${targetId}`,
        newName: `updated: ${targetId}`,
      },
    });

    if (!diff) {
      return `## Update: ${targetId}\n\n**Type:** UPDATE (no changes detected)\n**Path:** \`${targetPath}\``;
    }

    return `## Update: ${targetId}\n\n**Type:** UPDATE (modification)\n**Path:** \`${targetPath}\`\n\n\`\`\`diff\n${diff}\`\`\``;
  }

  // --- Batch approval ---

  private async handleBatchApproval(params: {
    ids: string;
    confirmed?: boolean;
    approvalToken?: string;
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { ids, confirmed, approvalToken, reader } = params;

    if (confirmed && approvalToken) {
      return errorResponse("Error: Cannot provide both confirmed and approvalToken. Use one at a time.");
    }

    const idList = ids.split(",").map((id) => id.trim()).filter((id) => id.length > 0);

    if (idList.length === 0) {
      return errorResponse("Error: No valid IDs provided");
    }

    if (approvalToken) {
      // Fall through to token validation below
    } else if (confirmed) {
      return this.handleBatchConfirmed({ idList, reader });
    }

    // Check all drafts are in pending_approval state
    const notReady: string[] = [];
    for (const id of idList) {
      const status = await draftWorkflowManager.getStatus({ id });
      const state = status?.state ?? "editing";
      if (state !== "pending_approval") notReady.push(`${id} (${state})`);
    }

    if (notReady.length > 0) {
      return errorResponse(`# Cannot batch approve

The following drafts are not in \`pending_approval\` state:
${notReady.map((s) => `- ${s}`).join("\n")}

Each draft must complete the workflow (notes → explain → confirmed) before batch approval.`);
    }

    const batchRequestId = buildBatchRequestId(idList);

    if (!approvalToken) {
      const changeInfos: string[] = [];
      for (const id of idList) {
        const info = await this.generateChangeInfo({ id, reader });
        changeInfos.push(info);
      }

      const approvalResult = await requestApproval({
        request: { id: batchRequestId, operation: "Batch Draft Approval", description: `Approve ${idList.length} drafts: ${idList.join(", ")}` },
      });

      return textResponse(
        `# Batch Approval Requested (${idList.length} drafts)

${changeInfos.join("\n\n---\n\n")}

---

${getApprovalRequestedMessage(approvalResult)}` +
        formatNextActions([{
          action: "approve",
          description: "Apply batch with token from user",
          example: `instruction(action: "approve", ids: "${ids}", approvalToken: "<token>")`,
        }]),
      );
    }

    // Validate token
    const validation = validateApproval({ requestId: batchRequestId, providedToken: approvalToken });
    if (!validation.valid) {
      return errorResponse(`${getApprovalRejectionMessage()}\n\nReason: ${validation.reason}`);
    }

    // Apply all drafts
    const results: string[] = [];
    for (const id of idList) {
      const sourceDraftId = DRAFT_PREFIX + id;
      await draftWorkflowManager.trigger({ id, triggerParams: { action: "approve" }, approvalToken });

      const draftContent = await reader.getDocumentContent(sourceDraftId);
      if (draftContent === null) {
        results.push(`- ${id}: Draft not found`);
        continue;
      }

      const existingFrontmatter = parseFrontmatter(draftContent);
      const approvedContent = updateFrontmatter({
        content: stripFrontmatter(draftContent),
        frontmatter: { ...existingFrontmatter, status: "approved" as const, approvedAt: new Date().toISOString() },
      });

      await reader.updateDocument({ id: sourceDraftId, content: approvedContent });
      const renameResult = await reader.renameDocument({ oldId: sourceDraftId, newId: id, overwrite: true });

      if (renameResult.success) {
        draftWorkflowManager.clear({ id });
        results.push(`- ${id}: Applied`);
      } else {
        results.push(`- ${id}: ${renameResult.error}`);
      }
    }

    return textResponse(
      `# Batch Approval Complete

${results.join("\n")}` +
      formatNextActions([{
        action: "list",
        description: "View all documents",
        example: `instruction(action: "list")`,
      }]),
    );
  }

  private async handleBatchConfirmed(params: {
    idList: string[];
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { idList, reader } = params;

    const notReady: string[] = [];
    for (const id of idList) {
      const status = await draftWorkflowManager.getStatus({ id });
      const state = status?.state ?? "editing";
      if (state !== "user_reviewing") notReady.push(`${id} (${state})`);
    }

    if (notReady.length > 0) {
      return errorResponse(`# Cannot batch confirm

The following drafts are not in \`user_reviewing\` state:
${notReady.map((s) => `- ${s}`).join("\n")}

Each draft must be explained to user first (notes → explain).`);
    }

    const confirmedAt = new Date().toISOString();
    for (const id of idList) {
      await draftWorkflowManager.trigger({ id, triggerParams: { action: "confirm", confirmed: true } });
      await this.updateDraftFrontmatterStatus({ id, status: "pending_approval", confirmedAt, reader });
    }

    const changeInfos: string[] = [];
    for (const id of idList) {
      const info = await this.generateChangeInfo({ id, reader });
      changeInfos.push(info);
    }

    const batchRequestId = buildBatchRequestId(idList);
    const approvalResult = await requestApproval({
      request: { id: batchRequestId, operation: "Batch Draft Approval", description: `Approve ${idList.length} drafts: ${idList.join(", ")}` },
    });

    return textResponse(
      `# Batch Approval Requested (${idList.length} drafts)

${changeInfos.join("\n\n---\n\n")}

---

${getApprovalRequestedMessage(approvalResult)}` +
      formatNextActions([{
        action: "approve",
        description: "Apply batch with token from user",
        example: `instruction(action: "approve", ids: "${idList.join(",")}", approvalToken: "<token>")`,
      }]),
    );
  }

  private async getRecentlyConfirmedDrafts(params: { currentId: string; withinMs: number }): Promise<string[]> {
    const { currentId, withinMs } = params;
    const now = Date.now();
    const allStatuses = await draftWorkflowManager.listAll();
    return allStatuses
      .filter((status) => {
        if (status.id === currentId) return false;
        if (status.state !== "pending_approval") return false;
        const confirmedAt = status.context.confirmedAt;
        if (!confirmedAt) return false;
        return (now - confirmedAt) < withinMs;
      })
      .map((status) => status.id);
  }

  private async handleApprovalWithToken(params: {
    id: string;
    targetId?: string;
    approvalToken: string;
    currentState: DraftState;
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { id, targetId, approvalToken, currentState, reader } = params;

    if (currentState !== "pending_approval") {
      return errorResponse(`# Cannot approve yet

**Current state:** ${currentState}
**Required state:** pending_approval

You must complete the workflow first:
1. Provide \`notes\` (self-review)
2. Explain to user in your own words
3. Call with \`confirmed: true\`` +
        formatNextActions([{
          action: "approve",
          description: "Start with self-review notes",
          example: `instruction(action: "approve", id: "${id}", notes: "...")`,
        }]));
    }

    const requestId = buildRequestId([id]);
    const validation = validateApproval({ requestId, providedToken: approvalToken });

    if (!validation.valid) {
      return errorResponse(`${getApprovalRejectionMessage()}\n\nReason: ${validation.reason}`);
    }

    await draftWorkflowManager.trigger({ id, triggerParams: { action: "approve" }, approvalToken });

    const sourceDraftId = DRAFT_PREFIX + id;
    const finalTargetId = targetId || id;

    const draftContent = await reader.getDocumentContent(sourceDraftId);
    if (draftContent === null) {
      return errorResponse(`Error: Draft "${id}" not found.`);
    }

    const existingFrontmatter = parseFrontmatter(draftContent);
    const approvedContent = updateFrontmatter({
      content: stripFrontmatter(draftContent),
      frontmatter: { ...existingFrontmatter, status: "approved" as const, approvedAt: new Date().toISOString() },
    });

    await reader.updateDocument({ id: sourceDraftId, content: approvedContent });
    const renameResult = await reader.renameDocument({ oldId: sourceDraftId, newId: finalTargetId, overwrite: true });

    if (!renameResult.success) {
      return errorResponse(`Error: ${renameResult.error}`);
    }

    draftWorkflowManager.clear({ id });

    return textResponse(
      `Draft "${id}" approved and promoted to "${finalTargetId}" successfully.` +
      formatNextActions([
        { action: "read", description: "Read the promoted document", example: `instruction(action: "read", id: "${finalTargetId}")` },
        { action: "list", description: "View all documents", example: `instruction(action: "list")` },
      ]),
    );
  }

  private async updateDraftFrontmatterStatus(params: {
    id: string;
    status: "editing" | "self_review" | "user_reviewing" | "pending_approval" | "approved";
    selfReviewNotes?: string;
    confirmedAt?: string;
    reader: InstructionContext["reader"];
  }): Promise<void> {
    const { id, status, selfReviewNotes, confirmedAt, reader } = params;
    const draftId = DRAFT_PREFIX + id;
    const content = await reader.getDocumentContent(draftId);
    if (content === null) return;

    const existingFrontmatter = parseFrontmatter(content);
    const newFrontmatter = {
      ...existingFrontmatter,
      status,
      ...(selfReviewNotes !== undefined && { selfReviewNotes }),
      ...(confirmedAt !== undefined && { confirmedAt }),
    };

    const newContent = updateFrontmatter({
      content: stripFrontmatter(content),
      frontmatter: newFrontmatter,
    });

    await reader.updateDocument({ id: draftId, content: newContent });
  }
}
