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

/**
 * The draft reduced to what a human is actually approving: its metadata and
 * body, with the fields the promotion itself writes (`status`, `approvedAt`,
 * `confirmedAt`) left out, since those differ between the moment approval is
 * requested and the moment it is used.
 */
function stableDraftBody(content: string): string {
  const { description, whenToUse, relatedDocs } = parseFrontmatter(content);
  return [
    JSON.stringify({ description, whenToUse, relatedDocs }),
    stripFrontmatter(content),
  ].join("\n");
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
    const { id, targetId, notes, confirmed, force, reader } = params;
    let { currentState } = params;

    // editing: submit the draft's current content and carry on into
    // self_review. Without this the state has no entry point through this
    // handler -- only `add` performed the submit -- so a draft reset back to
    // `editing` fell through to "Unexpected State" and was stuck for good,
    // which is the complaint issue #6 opens with.
    if (currentState === "editing") {
      const draftContent = await reader.getDocumentContent(DRAFT_PREFIX + id);
      if (draftContent === null) {
        return errorResponse(`Error: Draft "${id}" not found.`);
      }

      const submitted = await draftWorkflowManager.trigger({
        id,
        triggerParams: { action: "submit", content: draftContent },
      });
      if (!submitted.ok) {
        return errorResponse(`Error: ${submitted.error}`);
      }
      currentState = "self_review";
    }

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
        const recentlyConfirmed = await this.getRecentlyConfirmedDrafts({ currentId: id, withinMs: 10_000, reader });
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
      const what = await this.buildApprovalWhat({ id, targetId, reader });
      if (what === null) {
        return errorResponse(`Error: Draft "${id}" not found.`);
      }
      const approvalResult = await requestApproval({
        request: {
          id: requestId,
          operation: "Draft Approval",
          description: await this.buildApprovalDescription({ id, targetId, reader }),
          what,
        },
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

  /**
   * What this promotion will do, computed from the files rather than described
   * by the caller. Bound into the approval so it cannot be swapped afterwards:
   * `targetId` used to be read again at token time and applied with
   * `overwrite: true`, which turned a token approved for "create a new note"
   * into an overwrite of any promoted document. The draft body is in here for
   * the same reason -- editing a draft needs no approval, so a token could
   * otherwise be spent on content nobody saw.
   *
   * Returns null when the draft is gone, which the callers report as an error.
   */
  private async buildApprovalWhat(params: {
    id: string;
    targetId?: string;
    reader: InstructionContext["reader"];
  }): Promise<string | null> {
    const { id, targetId, reader } = params;
    const finalTargetId = targetId || id;

    const draftContent = await reader.getDocumentContent(DRAFT_PREFIX + id);
    if (draftContent === null) return null;

    const existing = await reader.getDocumentContent(finalTargetId);

    return [
      `promote: ${id}`,
      `target: ${finalTargetId}`,
      `overwrites: ${existing === null ? "no" : "yes"}`,
      `content:`,
      stableDraftBody(draftContent),
    ].join("\n");
  }

  /**
   * One line for the desktop notification. That notification is the human's
   * only channel -- the diff goes into the tool response, which only the agent
   * reads -- so it has to name the target and say whether anything is being
   * overwritten.
   */
  private async buildApprovalDescription(params: {
    id: string;
    targetId?: string;
    reader: InstructionContext["reader"];
  }): Promise<string> {
    const { id, targetId, reader } = params;
    const finalTargetId = targetId || id;
    const existing = await reader.getDocumentContent(finalTargetId);
    const verb = existing === null ? "create" : "OVERWRITE";
    return `Promote draft "${id}" -> ${verb} "${finalTargetId}"`;
  }

  /**
   * The batch equivalent, in the caller's order so that reordering the ids
   * produces a different approval rather than reusing one.
   */
  private async buildBatchApprovalWhat(params: {
    idList: string[];
    reader: InstructionContext["reader"];
  }): Promise<string | null> {
    const { idList, reader } = params;
    const parts: string[] = [];
    for (const id of idList) {
      const what = await this.buildApprovalWhat({ id, reader });
      if (what === null) return null;
      parts.push(what);
    }
    return parts.join("\n---\n");
  }

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

    // Check all drafts are in pending_approval state AND actually went through
    // the review steps. State alone is not enough: a leftover entry from an
    // earlier cycle reads as `pending_approval`, so a brand-new draft reusing
    // that id could be batch-approved without self-review or an explanation to
    // the user. Persisted state is deleted on promotion now, but the check
    // costs nothing and does not depend on that cleanup having happened.
    const notReady: string[] = [];
    for (const id of idList) {
      const status = await draftWorkflowManager.getStatus({ id });
      const state = status?.state ?? "editing";
      if (state !== "pending_approval") {
        notReady.push(`${id} (${state})`);
        continue;
      }
      if (!status?.visitedStates.includes("user_reviewing")) {
        notReady.push(`${id} (never reviewed)`);
      }
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

      const what = await this.buildBatchApprovalWhat({ idList, reader });
      if (what === null) {
        return errorResponse("Error: One of the drafts in this batch no longer exists.");
      }
      const approvalResult = await requestApproval({
        request: {
          id: batchRequestId,
          operation: "Batch Draft Approval",
          description: `Promote ${idList.length} drafts: ${idList.join(", ")}`,
          what,
        },
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
    const currentWhat = await this.buildBatchApprovalWhat({ idList, reader });
    if (currentWhat === null) {
      return errorResponse("Error: One of the drafts in this batch no longer exists.");
    }
    const validation = validateApproval({
      requestId: batchRequestId,
      providedToken: approvalToken,
      currentWhat,
    });
    if (!validation.valid) {
      return errorResponse(`${getApprovalRejectionMessage()}\n\nReason: ${validation.reason}`);
    }

    // Apply all drafts
    const results: string[] = [];
    for (const id of idList) {
      const sourceDraftId = DRAFT_PREFIX + id;
      const transition = await draftWorkflowManager.trigger({
        id,
        triggerParams: { action: "approve" },
        approvalToken,
      });
      if (!transition.ok) {
        results.push(`- ${id}: ${transition.error}`);
        continue;
      }

      const draftContent = await reader.getDocumentContent(sourceDraftId);
      if (draftContent === null) {
        results.push(`- ${id}: Draft not found`);
        continue;
      }

      const renameResult = await reader.renameDocument({ oldId: sourceDraftId, newId: id, overwrite: true });

      if (renameResult.success) {
        await this.markApproved({ id, reader });
        await draftWorkflowManager.delete({ id });
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

  /**
   * Drafts confirmed moments ago and still waiting for a token.
   *
   * The draft file has to still be there. Applied drafts used to qualify --
   * their persisted state stayed at `pending_approval` with a fresh
   * `confirmedAt` -- so the warning named documents that no longer existed and
   * the batch command it recommended was guaranteed to fail, which trained
   * callers to reach for `force` instead.
   */
  private async getRecentlyConfirmedDrafts(params: {
    currentId: string;
    withinMs: number;
    reader: InstructionContext["reader"];
  }): Promise<string[]> {
    const { currentId, withinMs, reader } = params;
    const now = Date.now();
    const allStatuses = await draftWorkflowManager.listAll();

    const candidates = allStatuses.filter((status) => {
      if (status.id === currentId) return false;
      if (status.state !== "pending_approval") return false;
      const confirmedAt = status.context.confirmedAt;
      if (!confirmedAt) return false;
      return (now - confirmedAt) < withinMs;
    });

    const stillPending: string[] = [];
    for (const status of candidates) {
      if (await reader.documentExists(DRAFT_PREFIX + status.id)) {
        stillPending.push(status.id);
      }
    }
    return stillPending;
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
    // Recomputed here, before anything is written -- the promotion itself
    // rewrites the draft's frontmatter, so computing it later would compare the
    // approval against the change already in progress.
    const currentWhat = await this.buildApprovalWhat({ id, targetId, reader });
    if (currentWhat === null) {
      return errorResponse(`Error: Draft "${id}" not found.`);
    }
    const validation = validateApproval({ requestId, providedToken: approvalToken, currentWhat });

    if (!validation.valid) {
      return errorResponse(`${getApprovalRejectionMessage()}\n\nReason: ${validation.reason}`);
    }

    const transition = await draftWorkflowManager.trigger({
      id,
      triggerParams: { action: "approve" },
      approvalToken,
    });
    if (!transition.ok) {
      return errorResponse(`Error: ${transition.error}`);
    }

    const sourceDraftId = DRAFT_PREFIX + id;
    const finalTargetId = targetId || id;

    const draftContent = await reader.getDocumentContent(sourceDraftId);
    if (draftContent === null) {
      return errorResponse(`Error: Draft "${id}" not found.`);
    }

    // Move first, mark approved second. The other order left a failed rename
    // with a draft stamped `status: approved` and a token already spent, and
    // the single-id path offers no way to mint another.
    const renameResult = await reader.renameDocument({ oldId: sourceDraftId, newId: finalTargetId, overwrite: true });
    if (!renameResult.success) {
      return errorResponse(`Error: ${renameResult.error}`);
    }

    await this.markApproved({ id: finalTargetId, reader });

    // delete, not clear: `clear` only drops the in-memory entry, leaving a
    // persisted `pending_approval` on disk that a later draft with the same id
    // inherits -- and can be promoted on without ever being reviewed.
    await draftWorkflowManager.delete({ id });

    return textResponse(
      `Draft "${id}" approved and promoted to "${finalTargetId}" successfully.` +
      formatNextActions([
        { action: "read", description: "Read the promoted document", example: `instruction(action: "read", id: "${finalTargetId}")` },
        { action: "list", description: "View all documents", example: `instruction(action: "list")` },
      ]),
    );
  }

  /**
   * Stamp the promoted document as approved. Runs after the move succeeds, so a
   * failed promotion leaves the draft exactly as it was.
   */
  private async markApproved(params: {
    id: string;
    reader: InstructionContext["reader"];
  }): Promise<void> {
    const { id, reader } = params;
    const content = await reader.getDocumentContent(id);
    if (content === null) return;

    await reader.updateDocument({
      id,
      content: updateFrontmatter({
        content: stripFrontmatter(content),
        frontmatter: {
          ...parseFrontmatter(content),
          status: "approved" as const,
          approvedAt: new Date().toISOString(),
        },
      }),
    });
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
