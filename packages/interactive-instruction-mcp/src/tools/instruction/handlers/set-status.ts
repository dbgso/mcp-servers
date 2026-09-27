import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { errorResponse, formatNextActions, textResponse } from "../types.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import {
  parseFrontmatter,
  updateFrontmatter,
  stripFrontmatter,
} from "../../../utils/frontmatter-parser.js";
import type { DraftStatus } from "../../../types/index.js";
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

    // Determine target IDs
    let targetIds: string[] = [];
    if (ids) {
      targetIds = ids.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    } else if (id) {
      targetIds = [id];
    } else {
      return errorResponse(`Error: id or ids is required for set_status action.` +
        formatNextActions([{
          action: "set_status",
          description: "Set status with an ID",
          example: `instruction(action: "set_status", id: "<doc-id>", status: "${status}")`,
        }]));
    }

    const results: string[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const targetId of targetIds) {
      const draftId = DRAFT_PREFIX + targetId;
      const content = await reader.getDocumentContent(draftId);

      if (content === null) {
        // Out of scope and absent are different facts. A promoted document
        // exists; it simply has no workflow state to reset, and reporting that
        // as "not found" sends the caller off to re-check an id that was right.
        const promoted = await reader.documentExists(targetId);
        results.push(
          promoted
            ? `- ${targetId}: promoted, so it has no workflow state to reset`
            : `- ${targetId}: not found`
        );
        errorCount++;
        continue;
      }

      // Parse existing frontmatter
      const existingFrontmatter = parseFrontmatter(content);
      const oldStatus = existingFrontmatter.status || "(none)";

      // Update frontmatter with new status
      const newFrontmatter = {
        ...existingFrontmatter,
        status: status as DraftStatus,
      };

      const body = stripFrontmatter(content);
      const newContent = updateFrontmatter({
        content: body,
        frontmatter: newFrontmatter,
      });

      // Write updated content
      const updateResult = await reader.updateDocument({
        id: draftId,
        content: newContent,
      });

      if (updateResult.success) {
        // The frontmatter is a mirror; this is the state that actually governs
        // what `approve` will allow next.
        await draftWorkflowManager.delete({ id: targetId });
        results.push(`- ${targetId}: ${oldStatus} -> ${status}`);
        successCount++;
      } else {
        results.push(`- ${targetId}: failed - ${updateResult.error}`);
        errorCount++;
      }
    }

    // Chosen by what happened, not by how many were asked for. Picking on the
    // count alone printed `Status updated for "x".` above a detail line saying
    // `x: not found`, with no `isError` anywhere.
    const summary =
      errorCount === 0
        ? targetIds.length === 1
          ? `Status updated for "${targetIds[0]}".`
          : `Batch status update: ${successCount} succeeded.`
        : successCount === 0
          ? targetIds.length === 1
            ? `Could not set the status of "${targetIds[0]}".`
            : `Batch status update: none of ${errorCount} succeeded.`
          : `Batch status update: ${successCount} succeeded, ${errorCount} failed.`;

    const respond = errorCount === 0 ? textResponse : errorResponse;

    return respond(
      `# Set Status Result

${summary}

## Details
${results.join("\n")}` +
      // Suggesting `read` on the id that just failed sends the caller back to
      // the thing that did not work. Offer the listing that would have shown
      // which ids are drafts in the first place.
      formatNextActions(
        errorCount === 0
          ? [
              { action: "read", description: "Read the draft", example: `instruction(action: "read", id: "${targetIds[0]}")` },
              { action: "list", description: "List the drafts", example: 'instruction(action: "list", drafts: true)' },
            ]
          : [
              { action: "list", description: "See which ids are drafts", example: 'instruction(action: "list", drafts: true)' },
              { action: "list", description: "See the promoted documents", example: 'instruction(action: "list", recursive: true)' },
            ]
      ),
    );
  }
}
