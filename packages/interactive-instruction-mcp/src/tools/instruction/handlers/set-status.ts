import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext, NextActionSuggestion } from "../types.js";
import { errorResponse, formatNextActions, textResponse } from "../types.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import {
  parseFrontmatter,
  updateFrontmatter,
  stripFrontmatter,
} from "../../../utils/frontmatter-parser.js";
import type { DocumentFrontmatter, DraftStatus } from "../../../types/index.js";
import { draftWorkflowManager } from "../../../workflows/draft-workflow.js";

/**
 * Only `editing` can be set.
 *
 * This action used to accept every state and write it into the frontmatter --
 * where nothing read it. The approve handler reads the workflow manager, so
 * setting `pending_approval` here changed nothing except making the document
 * disagree with the state machine, and a draft stuck mid-flow stayed stuck.
 *
 * Resetting to `editing` is the one thing a caller legitimately needs and the
 * one direction that cannot skip a step: it discards the workflow entry so the
 * draft starts the review over from the beginning. Moving forward is the state
 * machine's business, through `approve`.
 *
 * The restriction lives in the zod schema rather than in a runtime check,
 * because the schema is what the agent is shown. Advertising four states and
 * refusing three of them at call time would keep offering an option that can
 * never work.
 */
const RESETTABLE_STATUS = "editing";

const schema = z.object({
  action: z.literal("set_status"),
  id: z.string().optional().describe("Single draft ID"),
  ids: z.string().optional().describe("Comma-separated draft IDs for batch"),
  status: z
    .literal(RESETTABLE_STATUS)
    .describe(
      `Target status. Only "${RESETTABLE_STATUS}" is accepted: the later states belong to the approval workflow and are reached through \`approve\`. Writing one here would change the frontmatter and nothing else, since the workflow reads its own state.`
    ),
});

type Args = z.infer<typeof schema>;

/** One draft's reset: the line the report shows, and whether it counted as done. */
type ResetOutcome = { ok: boolean; detail: string };

/**
 * `ids` wins over `id` when both are given, and an empty list is not the same as
 * no selector at all: `ids: ","` asks for nothing and gets an empty batch
 * report, while omitting both is a call that cannot be carried out.
 */
function resolveTargetIds(params: { id?: string; ids?: string }): string[] | null {
  const { id, ids } = params;
  if (ids) {
    return ids.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  }
  if (id) {
    return [id];
  }
  return null;
}

/** Drafts written before the frontmatter carried a status have none to report. */
function reportedStatus(frontmatter: DocumentFrontmatter): string {
  return frontmatter.status || "(none)";
}

function allSucceededSummary(params: { targetIds: string[]; successCount: number }): string {
  const { targetIds, successCount } = params;
  if (targetIds.length === 1) {
    return `Status updated for "${targetIds[0]}".`;
  }
  return `Batch status update: ${successCount} succeeded.`;
}

function noneSucceededSummary(params: { targetIds: string[]; errorCount: number }): string {
  const { targetIds, errorCount } = params;
  if (targetIds.length === 1) {
    return `Could not set the status of "${targetIds[0]}".`;
  }
  return `Batch status update: none of ${errorCount} succeeded.`;
}

/**
 * Chosen by what happened, not by how many were asked for. Picking on the
 * count alone printed `Status updated for "x".` above a detail line saying
 * `x: not found`, with no `isError` anywhere.
 */
function summariseOutcome(params: {
  targetIds: string[];
  successCount: number;
  errorCount: number;
}): string {
  const { targetIds, successCount, errorCount } = params;
  if (errorCount === 0) {
    return allSucceededSummary({ targetIds, successCount });
  }
  if (successCount === 0) {
    return noneSucceededSummary({ targetIds, errorCount });
  }
  return `Batch status update: ${successCount} succeeded, ${errorCount} failed.`;
}

/**
 * Suggesting `read` on the id that just failed sends the caller back to the
 * thing that did not work. Offer the listing that would have shown which ids
 * are drafts in the first place.
 */
function nextActionsAfterReset(params: {
  targetIds: string[];
  errorCount: number;
}): NextActionSuggestion[] {
  const { targetIds, errorCount } = params;
  if (errorCount > 0) {
    return [
      { action: "list", description: "See which ids are drafts", example: 'instruction(action: "list", drafts: true)' },
      { action: "list", description: "See the promoted documents", example: 'instruction(action: "list", recursive: true)' },
    ];
  }
  return [
    { action: "read", description: "Read the draft", example: `instruction(action: "read", id: "${targetIds[0]}")` },
    { action: "list", description: "List the drafts", example: 'instruction(action: "list", drafts: true)' },
  ];
}

export class SetStatusHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "set_status";
  readonly help = `Reset one or more drafts to the start of the review workflow.

Usage:
- Single: \`instruction(action: "set_status", id: "doc-id", status: "editing")\`
- Batch:  \`instruction(action: "set_status", ids: "id1,id2", status: "editing")\`

Only "${RESETTABLE_STATUS}" can be set. The later states are reached by going
through \`approve\`, not by declaring them.`;

  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id, ids, status } = params.args;
    const { reader } = params.context;

    const targetIds = resolveTargetIds({ id, ids });
    if (targetIds === null) {
      return errorResponse(`Error: id or ids is required for set_status action.` +
        formatNextActions([{
          action: "set_status",
          description: "Set status with an ID",
          example: `instruction(action: "set_status", id: "<doc-id>", status: "${status}")`,
        }]));
    }

    const outcomes = await this.resetEach({ reader, targetIds, status });
    const errorCount = outcomes.filter((outcome) => !outcome.ok).length;
    const successCount = outcomes.length - errorCount;

    const respond = errorCount === 0 ? textResponse : errorResponse;

    return respond(
      `# Set Status Result

${summariseOutcome({ targetIds, successCount, errorCount })}

## Details
${outcomes.map((outcome) => outcome.detail).join("\n")}` +
      formatNextActions(nextActionsAfterReset({ targetIds, errorCount })),
    );
  }

  /** Sequential on purpose: each reset writes a file and drops a workflow entry. */
  private async resetEach(params: {
    reader: InstructionContext["reader"];
    targetIds: string[];
    status: DraftStatus;
  }): Promise<ResetOutcome[]> {
    const { reader, targetIds, status } = params;

    const outcomes: ResetOutcome[] = [];
    for (const targetId of targetIds) {
      outcomes.push(await this.resetOne({ reader, targetId, status }));
    }
    return outcomes;
  }

  private async resetOne(params: {
    reader: InstructionContext["reader"];
    targetId: string;
    status: DraftStatus;
  }): Promise<ResetOutcome> {
    const { reader, targetId, status } = params;
    const draftId = DRAFT_PREFIX + targetId;

    const content = await reader.getDocumentContent(draftId);
    if (content === null) {
      return { ok: false, detail: await this.explainNothingToReset({ reader, targetId }) };
    }

    const existingFrontmatter = parseFrontmatter(content);
    const updateResult = await reader.updateDocument({
      id: draftId,
      content: updateFrontmatter({
        content: stripFrontmatter(content),
        frontmatter: { ...existingFrontmatter, status },
      }),
    });
    if (!updateResult.success) {
      return { ok: false, detail: `- ${targetId}: failed - ${updateResult.error}` };
    }

    // The frontmatter is a mirror; this is the state that actually governs
    // what `approve` will allow next.
    await draftWorkflowManager.delete({ id: targetId });
    return {
      ok: true,
      detail: `- ${targetId}: ${reportedStatus(existingFrontmatter)} -> ${status}`,
    };
  }

  /**
   * Out of scope and absent are different facts. A promoted document exists; it
   * simply has no workflow state to reset, and reporting that as "not found"
   * sends the caller off to re-check an id that was right.
   */
  private async explainNothingToReset(params: {
    reader: InstructionContext["reader"];
    targetId: string;
  }): Promise<string> {
    const { reader, targetId } = params;
    if (await reader.documentExists(targetId)) {
      return `- ${targetId}: promoted, so it has no workflow state to reset`;
    }
    return `- ${targetId}: not found`;
  }
}
