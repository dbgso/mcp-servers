import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { formatNextActions, errorResponse, textResponse } from "../types.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import { gateMutation } from "../../../services/mutation-gate.js";
import {
  draftWorkflowManager,
  stateDescriptions,
  type DraftState,
} from "../../../workflows/draft-workflow.js";
import { parseFrontmatter, updateFrontmatter, stripFrontmatter } from "../../../utils/frontmatter-parser.js";
import { generateDiff } from "../../../utils/diff-utils.js";

const schema = z.object({
  action: z.literal("approve"),
  id: z.string().optional(),
  ids: z.string().optional(),
  targetId: z.string().optional(),
  notes: z.string().optional(),
  explanation: z
    .string()
    .min(1)
    .optional()
    .describe(
      "What this document says and why it should be promoted, in your own words, as you told the user. Required to promote, and identical across every attempt."
    ),
  force: z.boolean().optional(),
});

type Args = z.infer<typeof schema>;

/** Names one promotion to the gate; `what` below is what binds it to content. */
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

export class ApproveHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "approve";
  readonly help = `Promote a draft to a managed document.

The workflow is notes → explanation: \`notes\` records your self-review, then
\`explanation\` is what you told the user about the document. The first attempts
with an explanation are refused and show the diff; repeat the identical call to
promote. \`ids\` promotes several drafts under one explanation.`;
  readonly schema = schema;

    protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id, ids, targetId, notes, explanation, force } = params.args;
    const { reader } = params.context;

    // Batch approval mode
    if (ids) {
      return this.handleBatchApproval({ ids, explanation, reader });
    }

    if (!id) {
      return errorResponse("Error: id or ids is required for approve action");
    }

    const status = await draftWorkflowManager.getStatus({ id });
    const currentState: DraftState = status?.state ?? "editing";

    return this.handleApprovalRequest({ id, targetId, notes, explanation, force, currentState, reader });
  }

  private async handleApprovalRequest(params: {
    id: string;
    targetId?: string;
    notes?: string;
    explanation?: string;
    force?: boolean;
    currentState: DraftState;
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { id, targetId, notes, explanation, force, reader } = params;
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
            description: "Explain the document to the user, then promote it",
            example: `instruction(action: "approve", id: "${id}", explanation: "<what this says and why it should be promoted>")`,
          },
        ]),
      );
    }

    // user_reviewing state
    if (currentState === "user_reviewing") {
      if (explanation === undefined) {
        return errorResponse(
          `# Workflow: user_reviewing

${stateDescriptions.user_reviewing}` +
          formatNextActions([
            {
              action: "read",
              description: "Read approval format rules",
              example: `instruction(action: "read", id: "_mcp-interactive-instruction__draft-approval")`,
            },
            {
              action: "approve",
              description: "Explain the document to the user, then promote it",
              example: `instruction(action: "approve", id: "${id}", explanation: "<what this says and why it should be promoted>")`,
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
                description: "Promote them together under one explanation (recommended)",
                example: `instruction(action: "approve", ids: "${allIds.join(",")}", explanation: "<what these say and why>")`,
              },
              {
                action: "approve",
                description: `Proceed with just "${id}"`,
                example: `instruction(action: "approve", id: "${id}", explanation: "${explanation}", force: true)`,
              },
            ]),
          );
        }
      }

      // Into pending_approval before the gate runs. The gate refuses the first
      // attempt, so the state has to be the one the repeat call lands in --
      // which is the `pending_approval` branch below, not this one.
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

      return this.promote({ id, targetId, explanation, reader });
    }

    // pending_approval: the state a refused attempt leaves behind, so this is
    // where every attempt after the first arrives.
    if (currentState === "pending_approval") {
      if (explanation === undefined) {
        return errorResponse(
          `# Workflow: pending_approval

This draft is waiting to be promoted, and promoting it needs the \`explanation\`
you gave the user.` +
          formatNextActions([{
            action: "approve",
            description: "Repeat the call with your explanation",
            example: `instruction(action: "approve", id: "${id}", explanation: "<what this says and why it should be promoted>")`,
          }]));
      }

      return this.promote({ id, targetId, explanation, reader });
    }

    // Fallback for unexpected states
    return errorResponse(`# Unexpected State

**Current state:** ${currentState}

Expected: self_review, user_reviewing or pending_approval` +
      formatNextActions([{
        action: "approve",
        description: "Provide self-review notes to start",
        example: `instruction(action: "approve", id: "${id}", notes: "...")`,
      }]));
  }

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

  /**
   * Promote several drafts under one explanation.
   *
   * One gate run over the whole batch rather than one per draft: the caller
   * gave the user one account of the change, and making it repeat that account
   * per document is the friction that trained callers to reach for `force`.
   * The key is the concatenated `what` in the caller's order, so adding,
   * dropping or reordering a draft starts a new run.
   */
  private async handleBatchApproval(params: {
    ids: string;
    explanation?: string;
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { ids, explanation, reader } = params;

    const idList = ids.split(",").map((id) => id.trim()).filter((id) => id.length > 0);

    if (idList.length === 0) {
      return errorResponse("Error: No valid IDs provided");
    }

    if (explanation === undefined) {
      return errorResponse(
        `Promoting ${idList.length} draft(s) needs an \`explanation\`: what they say and why they should be promoted, in the words you used with the user.` +
        formatNextActions([{
          action: "approve",
          description: "Say what these are, then repeat the identical call",
          example: `instruction(action: "approve", ids: "${ids}", explanation: "<what these say and why>")`,
        }]));
    }

    // Every draft has to have been explained to the user once already. State
    // alone is not enough: a leftover entry from an earlier cycle reads as
    // `pending_approval`, so a brand-new draft reusing that id could ride along
    // in a batch without self-review. Persisted state is deleted on promotion
    // now, but the check costs nothing and does not depend on that cleanup.
    const notReady: string[] = [];
    for (const id of idList) {
      const status = await draftWorkflowManager.getStatus({ id });
      const state = status?.state ?? "editing";
      if (state !== "user_reviewing" && state !== "pending_approval") {
        notReady.push(`${id} (${state})`);
        continue;
      }
      if (state === "pending_approval" && !status?.visitedStates.includes("user_reviewing")) {
        notReady.push(`${id} (never reviewed)`);
      }
    }

    if (notReady.length > 0) {
      return errorResponse(`# Cannot batch approve

These drafts have not been reviewed yet:
${notReady.map((s) => `- ${s}`).join("\n")}

Each one needs its \`notes\` recorded first.`);
    }

    // Moved before the gate runs, for the same reason as the single path: the
    // refusal has to leave the drafts in the state the repeat call expects.
    const confirmedAt = new Date().toISOString();
    for (const id of idList) {
      const status = await draftWorkflowManager.getStatus({ id });
      if ((status?.state ?? "editing") === "user_reviewing") {
        await draftWorkflowManager.trigger({ id, triggerParams: { action: "confirm", confirmed: true } });
        await this.updateDraftFrontmatterStatus({ id, status: "pending_approval", confirmedAt, reader });
      }
    }

    const what = await this.buildBatchApprovalWhat({ idList, reader });
    if (what === null) {
      return errorResponse("Error: One of the drafts in this batch no longer exists.");
    }

    const changeInfos: string[] = [];
    for (const id of idList) {
      changeInfos.push(await this.generateChangeInfo({ id, reader }));
    }

    return gateMutation({
      operation: "approve",
      subject: buildBatchRequestId(idList),
      what,
      explanation,
      preview: `# Promoting ${idList.length} draft(s)\n\n${changeInfos.join("\n\n---\n\n")}`,
      work: () => this.promoteBatchNow({ idList, reader }),
    });
  }

  /**
   * The batch write.
   *
   * Reports per-draft outcomes and counts the batch as done only if every one
   * of them landed: a partial batch leaves the gate's run standing, so the
   * caller can retry the remainder without explaining itself again.
   */
  private async promoteBatchNow(params: {
    idList: string[];
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { idList, reader } = params;

    const results: string[] = [];
    const failed: string[] = [];

    for (const id of idList) {
      const sourceDraftId = DRAFT_PREFIX + id;

      const blocked = await this.checkPromotable(id);
      if (blocked !== null) {
        results.push(`- ${id}: ${blocked}`);
        failed.push(id);
        continue;
      }

      const draftContent = await reader.getDocumentContent(sourceDraftId);
      if (draftContent === null) {
        results.push(`- ${id}: Draft not found`);
        failed.push(id);
        continue;
      }

      // The state machine moves only once the file has, so a draft that fails
      // here is still promotable on the caller's next attempt.
      const renameResult = await reader.renameDocument({ oldId: sourceDraftId, newId: id, overwrite: true });

      if (renameResult.success) {
        await this.markApproved({ id, reader });
        await this.recordPromoted(id);
        results.push(`- ${id}: promoted`);
      } else {
        results.push(`- ${id}: ${renameResult.error}`);
        failed.push(id);
      }
    }

    const body = `# Batch promotion\n\n${results.join("\n")}` +
      formatNextActions([{
        action: "list",
        description: "View all documents",
        example: `instruction(action: "list")`,
      }]);

    return failed.length === 0 ? textResponse(body) : errorResponse(body);
  }

  /**
   * Drafts confirmed moments ago and still waiting to be promoted.
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

  /**
   * Promote one draft, behind the gate.
   *
   * The diff rides on the refusal: what the promotion does and the request to
   * explain it belong in the same response. There used to be a separate
   * "Approval Requested" step whose whole content was a notification the caller
   * had to get a human to read a token out of.
   */
  private async promote(params: {
    id: string;
    targetId?: string;
    explanation: string;
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { id, targetId, explanation, reader } = params;

    // Computed before anything is written: the promotion rewrites the draft's
    // frontmatter, so a `what` read afterwards would describe the change
    // already in progress rather than the one being gated.
    const what = await this.buildApprovalWhat({ id, targetId, reader });
    if (what === null) {
      return errorResponse(`Error: Draft "${id}" not found.`);
    }

    const changeInfo = await this.generateChangeInfo({ id, targetId, reader });
    const heading = await this.buildApprovalDescription({ id, targetId, reader });

    return gateMutation({
      operation: "approve",
      subject: buildRequestId([id]),
      what,
      explanation,
      preview: `# ${heading}\n\n${changeInfo}`,
      work: () => this.promoteNow({ id, targetId, reader }),
    });
  }

  /**
   * Check that the draft is allowed to be promoted, without moving the state
   * machine.
   *
   * Separate from the transition because the transition must not happen until
   * the file is written. Triggering first meant a failed rename left the draft
   * at `applied` with nothing on disk, and the next attempt -- which the gate's
   * surviving run now makes possible -- fell through to "Unexpected State".
   * Under the token this was invisible: the token was spent, so there was no
   * next attempt to strand.
   */
  private async checkPromotable(id: string): Promise<string | null> {
    const status = await draftWorkflowManager.getStatus({ id });
    const state = status?.state ?? "editing";

    if (state !== "pending_approval") {
      return `Draft "${id}" is ${state}, not pending_approval.`;
    }
    if (!status?.visitedStates.includes("user_reviewing")) {
      return `Draft "${id}" was never reviewed.`;
    }
    return null;
  }

  /**
   * Record the promotion in the state machine, after the file has moved.
   *
   * `delete`, not `clear`: `clear` only drops the in-memory entry, leaving a
   * persisted `pending_approval` on disk that a later draft with the same id
   * inherits -- and can be promoted on without ever being reviewed.
   */
  private async recordPromoted(id: string): Promise<void> {
    await draftWorkflowManager.trigger({ id, triggerParams: { action: "approve" } });
    await draftWorkflowManager.delete({ id });
  }

  private async promoteNow(params: {
    id: string;
    targetId?: string;
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { id, targetId, reader } = params;

    const blocked = await this.checkPromotable(id);
    if (blocked !== null) {
      return errorResponse(`Error: ${blocked}`);
    }

    const sourceDraftId = DRAFT_PREFIX + id;
    const finalTargetId = targetId || id;

    const draftContent = await reader.getDocumentContent(sourceDraftId);
    if (draftContent === null) {
      return errorResponse(`Error: Draft "${id}" not found.`);
    }

    // Move first, mark approved second. The other order left a failed rename
    // with a draft stamped `status: approved`.
    const renameResult = await reader.renameDocument({ oldId: sourceDraftId, newId: finalTargetId, overwrite: true });
    if (!renameResult.success) {
      return errorResponse(`Error: ${renameResult.error}`);
    }

    await this.markApproved({ id: finalTargetId, reader });
    await this.recordPromoted(id);

    return textResponse(
      `Draft "${id}" promoted to "${finalTargetId}".` +
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
