import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { formatNextActions, errorResponse, textResponse } from "../types.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import { gateMutation } from "../../../services/mutation-gate.js";
import {
  draftWorkflowManager,
  stateDescriptions,
  type DraftContext,
  type DraftState,
} from "../../../workflows/draft-workflow.js";
import type { DocumentFrontmatter, DraftStatus } from "../../../types/index.js";
import { parseFrontmatter, updateFrontmatter, stripFrontmatter } from "../../../utils/frontmatter-parser.js";
import { generateDiff } from "../../../utils/diff-utils.js";

const schema = z.object({
  action: z.literal("approve"),
  id: z.string().optional(),
  ids: z.string().optional(),
  targetId: z
    .string()
    .optional()
    .describe(
      "Promote the draft under this id instead of its own. Single promotion only -- a batch has one id per draft, so `ids` refuses it."
    ),
  notes: z.string().optional(),
  explanation: z
    .string()
    .min(1)
    .optional()
    .describe(
      "What this document says and why it should be promoted, in your own words, as you told the user. Required to promote, and identical across every attempt."
    ),
});

type Args = z.infer<typeof schema>;

/** The workflow entry for a draft, or null when it has none yet. */
type DraftWorkflowStatus = Awaited<ReturnType<typeof draftWorkflowManager.getStatus>>;

/**
 * A draft with no workflow entry has not started the review: the entry appears
 * on submit. Named because four call sites depend on the rule, and because a
 * stale entry reading as a live state is what several comments below are about.
 */
function stateOf(status: DraftWorkflowStatus): DraftState {
  return status?.state ?? "editing";
}

/**
 * `pending_approval` alone is not proof that anything was shown to the user: an
 * entry left over from an earlier cycle reads exactly the same.
 */
function wasUserReviewed(status: DraftWorkflowStatus): boolean {
  return status?.visitedStates.includes("user_reviewing") === true;
}

/**
 * What one step of the single-draft flow is given. The states differ in what
 * they do with it, not in what they need, which is what lets the dispatch in
 * `handleApprovalRequest` be a straight hand-off.
 */
interface ApprovalStep {
  id: string;
  targetId?: string;
  notes?: string;
  explanation?: string;
  reader: InstructionContext["reader"];
}

/**
 * Add an advisory to a response without changing what the response was.
 *
 * Appended to the first text block rather than pushed as a new one, so a caller
 * reading `content[0].text` -- which is every caller -- sees it. An empty advice
 * returns the response untouched, so the caller of this does not have to branch.
 */
function withAdvice(params: { response: ToolResponse; advice: string }): ToolResponse {
  const { response, advice } = params;
  if (advice === "") return response;

  const first = response.content.findIndex((part) => part.type === "text");
  if (first === -1) {
    return { ...response, content: [...response.content, { type: "text" as const, text: advice }] };
  }

  return {
    ...response,
    content: response.content.map((part, index) =>
      index === first && part.type === "text" ? { ...part, text: part.text + advice } : part
    ),
  };
}

/** How many ids a batch names, for a message that says the count back. */
function countIds(ids: string): number {
  return ids.split(",").filter((each) => each.trim().length > 0).length;
}

/**
 * The arguments the batch path has never been able to use.
 *
 * Both were destructured in `doExecute` and then not passed on, so a batch
 * carrying either was accepted and answered as though it had been applied.
 * Each is single-promotion only for its own reason, and neither is a missing
 * feature:
 *
 * - `targetId` is the id one draft is promoted under, and a batch has one draft
 *   per id, so a single name cannot apply to all of them.
 * - `notes` is one draft's self-review. The batch path already requires each
 *   draft to have had its own recorded -- its refusal says so -- and one note
 *   covering several drafts is the review not having happened.
 * Refused rather than ignored, and refused before anything is promoted:
 * promotion cannot be undone from here, so "it did something else" is the one
 * outcome that cannot be walked back.
 */
function batchWouldIgnore(params: {
  targetId?: string;
  notes?: string;
}): { reason: (count: number) => string; singleDescription: string; singleArgs: string } | null {
  const { targetId, notes } = params;

  if (targetId !== undefined) {
    return {
      reason: (count) =>
        `\`targetId\` renames the one document being promoted, so it cannot apply to a batch of ${count}.`,
      singleDescription: "Promote one draft under a different id",
      singleArgs: 'targetId: "<new-id>"',
    };
  }

  if (notes !== undefined) {
    return {
      reason: (count) =>
        `\`notes\` is one draft's self-review, so it cannot stand for a batch of ${count}. ` +
        "Record each draft's own notes first; the batch then promotes them under one explanation.",
      singleDescription: "Record one draft's self-review",
      singleArgs: 'notes: "<self-review>"',
    };
  }

  return null;
}

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

/**
 * Why there is no draft under this id.
 *
 * Out of scope and absent are different facts. A document that has already been
 * promoted exists -- there is simply nothing left to approve -- and calling
 * that "not found" sends the caller off to re-check an id that was right.
 */
async function noDraftReason(params: {
  reader: InstructionContext["reader"];
  id: string;
}): Promise<string> {
  const { reader, id } = params;
  return (await reader.documentExists(id))
    ? `"${id}" is already promoted, so there is nothing left to approve.`
    : `Error: Draft "${id}" not found.`;
}

/** Fallback for a state with no step of its own, such as `applied`. */
function refuseUnexpectedState(params: { id: string; currentState: DraftState }): ToolResponse {
  const { id, currentState } = params;
  return errorResponse(`# Unexpected State

**Current state:** ${currentState}

Expected: self_review, user_reviewing or pending_approval` +
    formatNextActions([{
      action: "approve",
      description: "Provide self-review notes to start",
      example: `instruction(action: "approve", id: "${id}", notes: "...")`,
    }]));
}

/** Whether the promotion replaces something, in the wording the approval key uses. */
function overwritesLabel(existing: string | null): string {
  return existing === null ? "no" : "yes";
}

/**
 * The frontmatter a promoted document keeps.
 *
 * Spelled as removals rather than as a list of survivors, so a field added to
 * `DocumentFrontmatter` is published by default: these three are the only ones
 * that exist purely to run the approval conversation.
 */
function publishedFrontmatter(frontmatter: DocumentFrontmatter): DocumentFrontmatter {
  const published = { ...frontmatter };
  delete published.status;
  delete published.selfReviewNotes;
  delete published.confirmedAt;
  return published;
}

/**
 * Only the fields this transition carries. An absent one is left out rather
 * than written as `undefined`, which would erase whatever is already there.
 */
function workflowFrontmatterFields(params: {
  status: DraftStatus;
  selfReviewNotes?: string;
  confirmedAt?: string;
}): DocumentFrontmatter {
  const { status, selfReviewNotes, confirmedAt } = params;
  return {
    status,
    ...(selfReviewNotes !== undefined && { selfReviewNotes }),
    ...(confirmedAt !== undefined && { confirmedAt }),
  };
}

/** Confirmed inside the window. No timestamp means the confirm never happened. */
function confirmedWithin(params: {
  context: DraftContext;
  now: number;
  withinMs: number;
}): boolean {
  const { context, now, withinMs } = params;
  if (!context.confirmedAt) {
    return false;
  }
  return now - context.confirmedAt < withinMs;
}

/**
 * Why one draft cannot join a batch. Two kinds rather than one message, because
 * the refusal groups them: the two problems need different things done about
 * them, and mixing them into one list said "record notes" about ids that were
 * already promoted.
 */
type BatchObstacle = { kind: "promoted" | "notReady"; entry: string };

/** The two states a batch may promote from: the draft has been explained to the user. */
function isBatchReadyState(state: DraftState): boolean {
  return state === "user_reviewing" || state === "pending_approval";
}

function needsReview(params: { state: DraftState; status: DraftWorkflowStatus }): boolean {
  const { state, status } = params;
  return state === "pending_approval" && !wasUserReviewed(status);
}

/** How this draft falls short of being batch-promotable, as the refusal lists it. */
function notReadyEntry(params: { id: string; status: DraftWorkflowStatus }): string | null {
  const { id, status } = params;
  const state = stateOf(status);

  if (!isBatchReadyState(state)) {
    return `${id} (${state})`;
  }
  if (needsReview({ state, status })) {
    return `${id} (never reviewed)`;
  }
  return null;
}

function entriesOfKind(params: {
  obstacles: BatchObstacle[];
  kind: BatchObstacle["kind"];
}): string[] {
  const { obstacles, kind } = params;
  return obstacles.filter((obstacle) => obstacle.kind === kind).map((obstacle) => obstacle.entry);
}

/** Empty when there is nothing of this kind, so the refusal can splice it unconditionally. */
function promotedSection(ids: string[]): string[] {
  if (ids.length === 0) {
    return [];
  }
  return [
    "These are already promoted, so there is nothing left to approve:",
    ids.map((id) => `- ${id}`).join("\n"),
  ];
}

function notReadySection(entries: string[]): string[] {
  if (entries.length === 0) {
    return [];
  }
  return [
    "These drafts have not been reviewed yet:",
    entries.map((entry) => `- ${entry}`).join("\n"),
    "Each one needs its \`notes\` recorded first.",
  ];
}

function batchRefusal(params: {
  alreadyPromoted: string[];
  notReady: string[];
}): string | null {
  const { alreadyPromoted, notReady } = params;
  if (alreadyPromoted.length === 0 && notReady.length === 0) {
    return null;
  }

  const sections = [...promotedSection(alreadyPromoted), ...notReadySection(notReady)];
  return `# Cannot batch approve\n\n${sections.join("\n\n")}`;
}

/**
 * Why this draft cannot be moved right now, as a value rather than a message:
 * the single and batch paths word the same two refusals differently.
 */
type PromotionBlock = { kind: "state"; message: string } | { kind: "missingDraft" };

/** The batch report is one line per draft, so it keeps the reason short. */
function batchBlockText(block: PromotionBlock): string {
  if (block.kind === "state") {
    return block.message;
  }
  return "Draft not found";
}

/** One draft's line in the batch report, and whether it counted as promoted. */
type BatchOutcome = { ok: boolean; line: string };

/**
 * The note itself, kept out of `batchingAdvice` so that deciding whether to say
 * anything is separate from the wording.
 */
function batchingAdviceText(params: { id: string; recentlyConfirmed: string[] }): string {
  const { id, recentlyConfirmed } = params;
  const together = [...recentlyConfirmed, id].join(",");
  return `

---

**These may belong together.** "${recentlyConfirmed.join('", "')}" ${recentlyConfirmed.length === 1 ? "was" : "were"} confirmed less than ten seconds ago and ${recentlyConfirmed.length === 1 ? "is" : "are"} still waiting to be promoted. One explanation covering the change reads better to the user than one account per document:

\`instruction(action: "approve", ids: "${together}", explanation: "<what these say and why>")\`

This call is going ahead as made; the batch form is still open afterwards.`;
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
    const { id, ids, targetId, notes, explanation } = params.args;
    const { reader } = params.context;

    if (ids) {
      return this.approveBatch({ ids, targetId, notes, explanation, reader });
    }

    if (!id) {
      return errorResponse("Error: id or ids is required for approve action");
    }

    return this.approveSingle({ id, targetId, notes, explanation, reader });
  }

  /**
   * `targetId` is the name a draft is promoted under, and a batch has one draft
   * per id -- so a single name cannot apply to all of them. It used to be
   * dropped without a word, and every draft landed under its own id while the
   * caller had asked for a different one.
   */
  private async approveBatch(params: Omit<ApprovalStep, "id"> & { ids: string }): Promise<ToolResponse> {
    const { ids, targetId, notes, explanation, reader } = params;

    const singleOnly = batchWouldIgnore({ targetId, notes });
    if (singleOnly !== null) {
      return errorResponse(
        singleOnly.reason(countIds(ids)) +
        formatNextActions([
          {
            action: "approve",
            description: singleOnly.singleDescription,
            example: `instruction(action: "approve", id: "<draft-id>", ${singleOnly.singleArgs}, explanation: "<what it says and why>")`,
          },
          {
            action: "approve",
            description: "Promote the batch, which takes neither",
            example: `instruction(action: "approve", ids: "${ids}", explanation: "<what they say and why>")`,
          },
        ]));
    }

    return this.handleBatchApproval({ ids, explanation, reader });
  }

  private async approveSingle(params: ApprovalStep): Promise<ToolResponse> {
    const status = await draftWorkflowManager.getStatus({ id: params.id });
    return this.handleApprovalRequest({ ...params, currentState: stateOf(status) });
  }

  /**
   * The state decides which step runs; each step is a method of its own, so the
   * chain here stays a hand-off rather than five bodies sharing a scope.
   */
  private async handleApprovalRequest(
    params: ApprovalStep & { currentState: DraftState }
  ): Promise<ToolResponse> {
    const { currentState, ...step } = params;

    if (currentState === "editing") {
      return this.submitThenSelfReview(step);
    }
    if (currentState === "self_review") {
      return this.recordSelfReview(step);
    }
    return this.handleAfterSelfReview({ ...step, currentState });
  }

  /** The states that need an `explanation`; they differ in whether the confirm has happened. */
  private async handleAfterSelfReview(
    params: ApprovalStep & { currentState: DraftState }
  ): Promise<ToolResponse> {
    const { currentState, ...step } = params;

    if (currentState === "user_reviewing") {
      return this.confirmThenPromote(step);
    }
    if (currentState === "pending_approval") {
      return this.promoteIfExplained(step);
    }
    return refuseUnexpectedState({ id: step.id, currentState });
  }

  /**
   * editing: submit the draft's current content and carry on into self_review.
   * Without this the state has no entry point through this handler -- only `add`
   * performed the submit -- so a draft reset back to `editing` fell through to
   * "Unexpected State" and was stuck for good, which is the complaint issue #6
   * opens with.
   */
  private async submitThenSelfReview(step: ApprovalStep): Promise<ToolResponse> {
    const { id, reader } = step;

    const draftContent = await reader.getDocumentContent(DRAFT_PREFIX + id);
    if (draftContent === null) {
      return errorResponse(await noDraftReason({ reader, id }));
    }

    const submitted = await draftWorkflowManager.trigger({
      id,
      triggerParams: { action: "submit", content: draftContent },
    });
    if (!submitted.ok) {
      return errorResponse(`Error: ${submitted.error}`);
    }

    return this.recordSelfReview(step);
  }

  /** self_review: the notes are the AI's review of its own draft, so there is nothing to record without them. */
  private async recordSelfReview(step: ApprovalStep): Promise<ToolResponse> {
    const { id, notes, reader } = step;

    if (!notes) {
      return errorResponse(`# Workflow: self_review

**${stateDescriptions.self_review}**

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

    // The format used to live in a document the server wrote into the user's
    // corpus at startup, which this response then told the caller to go and
    // read. It is three lines; putting them here means they arrive at the
    // moment they are acted on, and the corpus keeps only what the user put
    // in it.
    return textResponse(
      `# Workflow: self_review → user_reviewing

Self-review recorded.

## Next step: explain the draft to the user

In your own words, and before promoting it, tell them:

1. **Where it goes** — the full path, and the id it will have.
2. **What it says** — the points the document makes, not its headings.
3. **Why there** — what the id's prefix groups it with, and why this document
   belongs in that group.

Then promote it with that same account as the \`explanation\`.` +
      formatNextActions([
        {
          action: "approve",
          description: "Explain the document to the user, then promote it",
          example: `instruction(action: "approve", id: "${id}", explanation: "<what this says and why it should be promoted>")`,
        },
        {
          action: "read",
          description: "Read the draft again before explaining it",
          example: `instruction(action: "read", id: "${id}")`,
        },
      ]),
    );
  }

  private async confirmThenPromote(step: ApprovalStep): Promise<ToolResponse> {
    const { id, targetId, explanation, reader } = step;

    if (explanation === undefined) {
      return errorResponse(
        `# Workflow: user_reviewing

${stateDescriptions.user_reviewing}` +
        formatNextActions([
          {
            action: "approve",
            description: "Explain the document to the user, then promote it",
            example: `instruction(action: "approve", id: "${id}", explanation: "<what this says and why it should be promoted>")`,
          },
          {
            action: "read",
            description: "Read the draft again before explaining it",
            example: `instruction(action: "read", id: "${id}")`,
          },
        ]),
      );
    }

    // Advisory rather than a gate, and computed before the confirm so it
    // describes the state the caller was in when they made the call.
    //
    // What it protects is the quality of the account the user gets -- one
    // explanation covering related drafts instead of one vague one per
    // document -- and not the safety of the write, which the deliberation
    // gate holds either way. It used to refuse, which is why `force` existed;
    // the escape hatch outlived its reason, and its heaviest user had become
    // this package's own test suite, silencing a warning the tests provoked by
    // running fast. This package already has the shape for a report that is
    // not a veto: write-time lint says the document was saved and leaves the
    // decision with the author.
    const advice = await this.batchingAdvice({ id, reader });

    // Into pending_approval before the gate runs. The gate refuses the first
    // attempt, so the state has to be the one the repeat call lands in --
    // which is `promoteIfExplained` below, not this step.
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

    return withAdvice({
      response: await this.promote({ id, targetId, explanation, reader }),
      advice,
    });
  }

  /**
   * pending_approval: the state a refused attempt leaves behind, so this is
   * where every attempt after the first arrives.
   */
  private async promoteIfExplained(step: ApprovalStep): Promise<ToolResponse> {
    const { id, targetId, explanation, reader } = step;

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
      `overwrites: ${overwritesLabel(existing)}`,
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
    const targetPath = reader.getFilePath(finalTargetId);
    const draftContent = await reader.getDocumentContent(DRAFT_PREFIX + id);
    // Spliced into the gate preview rather than returned as an error, so it
    // keeps the marker that tells a reader this block is a failure.
    if (!draftContent) return `**Error:** ${await noDraftReason({ reader, id })}`;
    return this.describeChange({ draftContent, targetId: finalTargetId, targetPath, reader });
  }

  /** Create or update, which is the same question as whether anything is there to replace. */
  private async describeChange(params: {
    draftContent: string;
    targetId: string;
    targetPath: string;
    reader: InstructionContext["reader"];
  }): Promise<string> {
    const { draftContent, targetId, targetPath, reader } = params;

    const existingContent = await reader.getDocumentContent(targetId);
    if (existingContent === null) {
      return this.generateSummary({ content: draftContent, targetId, targetPath });
    }
    return this.generateDiffView({ oldContent: existingContent, newContent: draftContent, targetId, targetPath });
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

    return this.gateBatchPromotion({ idList, explanation, reader });
  }

  /**
   * The batch once the call itself is usable: every draft has to be promotable,
   * and the confirm has to happen before the gate refuses so the repeat call
   * finds the state it expects.
   */
  private async gateBatchPromotion(params: {
    idList: string[];
    explanation: string;
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { idList, explanation, reader } = params;

    const obstacles = await this.batchObstacles({ idList, reader });
    const refusal = batchRefusal({
      alreadyPromoted: entriesOfKind({ obstacles, kind: "promoted" }),
      notReady: entriesOfKind({ obstacles, kind: "notReady" }),
    });
    if (refusal !== null) {
      return errorResponse(refusal);
    }

    await this.confirmReviewedDrafts({ idList, reader });

    const what = await this.buildBatchApprovalWhat({ idList, reader });
    if (what === null) {
      return errorResponse("Error: One of the drafts in this batch no longer exists.");
    }

    return gateMutation({
      operation: "approve",
      subject: buildBatchRequestId(idList),
      what,
      explanation,
      preview: await this.batchPreview({ idList, reader }),
      work: () => this.promoteBatchNow({ idList, reader }),
    });
  }

  /**
   * Every draft has to have been explained to the user once already. State
   * alone is not enough: a leftover entry from an earlier cycle reads as
   * `pending_approval`, so a brand-new draft reusing that id could ride along
   * in a batch without self-review. Persisted state is deleted on promotion
   * now, but the check costs nothing and does not depend on that cleanup.
   */
  private async batchObstacles(params: {
    idList: string[];
    reader: InstructionContext["reader"];
  }): Promise<BatchObstacle[]> {
    const { idList, reader } = params;

    const obstacles: BatchObstacle[] = [];
    for (const id of idList) {
      const obstacle = await this.batchObstacle({ id, reader });
      if (obstacle !== null) {
        obstacles.push(obstacle);
      }
    }
    return obstacles;
  }

  private async batchObstacle(params: {
    id: string;
    reader: InstructionContext["reader"];
  }): Promise<BatchObstacle | null> {
    const { id, reader } = params;

    if (await this.isPromotedNotDraft({ id, reader })) {
      return { kind: "promoted", entry: id };
    }

    const entry = notReadyEntry({ id, status: await draftWorkflowManager.getStatus({ id }) });
    if (entry === null) {
      return null;
    }
    return { kind: "notReady", entry };
  }

  /**
   * Promotion deletes the workflow state, so a promoted document reads back as
   * `editing` and would be reported as an unreviewed draft -- telling the caller
   * to record `notes` on an id that will then be refused for being promoted. Out
   * of scope is not "you have more work to do".
   */
  private async isPromotedNotDraft(params: {
    id: string;
    reader: InstructionContext["reader"];
  }): Promise<boolean> {
    const { id, reader } = params;
    return !(await reader.documentExists(DRAFT_PREFIX + id)) && (await reader.documentExists(id));
  }

  /**
   * Moved before the gate runs, for the same reason as the single path: the
   * refusal has to leave the drafts in the state the repeat call expects.
   */
  private async confirmReviewedDrafts(params: {
    idList: string[];
    reader: InstructionContext["reader"];
  }): Promise<void> {
    const { idList, reader } = params;

    const confirmedAt = new Date().toISOString();
    for (const id of idList) {
      const status = await draftWorkflowManager.getStatus({ id });
      await this.confirmOne({ id, state: stateOf(status), confirmedAt, reader });
    }
  }

  private async confirmOne(params: {
    id: string;
    state: DraftState;
    confirmedAt: string;
    reader: InstructionContext["reader"];
  }): Promise<void> {
    const { id, state, confirmedAt, reader } = params;
    if (state !== "user_reviewing") {
      return;
    }
    await draftWorkflowManager.trigger({ id, triggerParams: { action: "confirm", confirmed: true } });
    await this.updateDraftFrontmatterStatus({ id, status: "pending_approval", confirmedAt, reader });
  }

  /** One `changeInfo` per draft, in the caller's order. */
  private async batchPreview(params: {
    idList: string[];
    reader: InstructionContext["reader"];
  }): Promise<string> {
    const { idList, reader } = params;

    const changeInfos: string[] = [];
    for (const id of idList) {
      changeInfos.push(await this.generateChangeInfo({ id, reader }));
    }
    return `# Promoting ${idList.length} draft(s)\n\n${changeInfos.join("\n\n---\n\n")}`;
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

    const outcomes: BatchOutcome[] = [];
    for (const id of idList) {
      outcomes.push(await this.promoteOneInBatch({ id, reader }));
    }

    const body = `# Batch promotion\n\n${outcomes.map((outcome) => outcome.line).join("\n")}` +
      formatNextActions([{
        action: "list",
        description: "View all documents",
        example: `instruction(action: "list")`,
      }]);

    return outcomes.every((outcome) => outcome.ok) ? textResponse(body) : errorResponse(body);
  }

  private async promoteOneInBatch(params: {
    id: string;
    reader: InstructionContext["reader"];
  }): Promise<BatchOutcome> {
    const { id, reader } = params;

    const block = await this.promotionBlock({ id, reader });
    if (block !== null) {
      return { ok: false, line: `- ${id}: ${batchBlockText(block)}` };
    }

    // The state machine moves only once the file has, so a draft that fails
    // here is still promotable on the caller's next attempt.
    const renameResult = await reader.renameDocument({ oldId: DRAFT_PREFIX + id, newId: id, overwrite: true });
    if (!renameResult.success) {
      return { ok: false, line: `- ${id}: ${renameResult.error}` };
    }

    await this.markApproved({ id, reader });
    await this.recordPromoted(id);
    return { ok: true, line: `- ${id}: promoted` };
  }

  /**
   * What to say when related drafts are being promoted one at a time.
   *
   * Empty when there is nothing to say, which is the common case, so the caller
   * can hand the result straight to `withAdvice`.
   *
   * The 10-second window is a heuristic and always was: what it is reaching for
   * is "these were written as one change", which nothing in the corpus records.
   * As a refusal that made it a guess with a veto; as a note it is a guess with
   * a suggestion, which is the most it was ever entitled to.
   */
  private async batchingAdvice(params: {
    id: string;
    reader: InstructionContext["reader"];
  }): Promise<string> {
    const { id, reader } = params;

    const recentlyConfirmed = await this.getRecentlyConfirmedDrafts({
      currentId: id,
      withinMs: 10_000,
      reader,
    });
    if (recentlyConfirmed.length === 0) return "";

    return batchingAdviceText({ id, recentlyConfirmed });
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
      return confirmedWithin({ context: status.context, now, withinMs });
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
      return errorResponse(await noDraftReason({ reader, id }));
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
    const state = stateOf(status);

    if (state !== "pending_approval") {
      return `Draft "${id}" is ${state}, not pending_approval.`;
    }
    if (!wasUserReviewed(status)) {
      return `Draft "${id}" was never reviewed.`;
    }
    return null;
  }

  /**
   * The checks that must pass before the draft is moved, shared by the single
   * and batch paths. Kept out of the move itself so a refusal cannot leave the
   * state machine ahead of the file.
   */
  private async promotionBlock(params: {
    id: string;
    reader: InstructionContext["reader"];
  }): Promise<PromotionBlock | null> {
    const { id, reader } = params;

    const message = await this.checkPromotable(id);
    if (message !== null) {
      return { kind: "state", message };
    }
    if (await reader.getDocumentContent(DRAFT_PREFIX + id) === null) {
      return { kind: "missingDraft" };
    }
    return null;
  }

  /** The single path can say why the id has no draft, which the batch report has no room for. */
  private async explainBlock(params: {
    block: PromotionBlock;
    id: string;
    reader: InstructionContext["reader"];
  }): Promise<string> {
    const { block, id, reader } = params;
    if (block.kind === "state") {
      return `Error: ${block.message}`;
    }
    return await noDraftReason({ reader, id });
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

    const block = await this.promotionBlock({ id, reader });
    if (block !== null) {
      return errorResponse(await this.explainBlock({ block, id, reader }));
    }

    return this.moveAndReport({ id, targetId, reader });
  }

  /**
   * Move first, mark approved second. The other order left a failed rename with
   * a draft stamped `status: approved`.
   */
  private async moveAndReport(params: {
    id: string;
    targetId?: string;
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { id, targetId, reader } = params;
    const finalTargetId = targetId || id;

    const renameResult = await reader.renameDocument({ oldId: DRAFT_PREFIX + id, newId: finalTargetId, overwrite: true });
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
   * Clear the workflow's own fields from the promoted document, and record when
   * it was approved. Runs after the move succeeds, so a failed promotion leaves
   * the draft exactly as it was.
   *
   * `status` and `selfReviewNotes` exist to run the approval conversation: the
   * state machine reads the first, and the second is the AI's account of its
   * own draft. Neither means anything once the document is promoted -- every
   * promoted document is approved -- and they were being published. Reported
   * as #50: a reader got a paragraph of review notes at the top of the
   * document on every `read`, for all 7 documents in that session.
   *
   * `confirmedAt` goes with them, for the same reason. `approvedAt` stays:
   * when a document became part of the corpus is a fact about the document,
   * and it is one line. It is reported by `read_meta` -- writing a value
   * into someone's file that no tool will read back is worse than not writing
   * it, and `read` answers with prose.
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
          ...publishedFrontmatter(parseFrontmatter(content)),
          approvedAt: new Date().toISOString(),
        },
      }),
    });
  }

  private async updateDraftFrontmatterStatus(params: {
    id: string;
    status: DraftStatus;
    selfReviewNotes?: string;
    confirmedAt?: string;
    reader: InstructionContext["reader"];
  }): Promise<void> {
    const { id, status, selfReviewNotes, confirmedAt, reader } = params;
    const draftId = DRAFT_PREFIX + id;
    const content = await reader.getDocumentContent(draftId);
    if (content === null) return;

    const newContent = updateFrontmatter({
      content: stripFrontmatter(content),
      frontmatter: {
        ...parseFrontmatter(content),
        ...workflowFrontmatterFields({ status, selfReviewNotes, confirmedAt }),
      },
    });

    await reader.updateDocument({ id: draftId, content: newContent });
  }
}
