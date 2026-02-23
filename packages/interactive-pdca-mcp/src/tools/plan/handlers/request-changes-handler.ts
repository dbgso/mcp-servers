import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";
import type { PlanActionContext } from "../../../types/index.js";

const requestChangesSchema = z.object({
  id: z.string().describe("Task ID"),
  comment: z.string().describe("Feedback comment"),
});
type RequestChangesArgs = z.infer<typeof requestChangesSchema>;

/**
 * RequestChangesHandler: pending_review → in_progress transition
 *
 * Requires:
 * - comment: feedback/reason for requesting changes
 */
export class RequestChangesHandler extends BaseActionHandler<RequestChangesArgs, PlanActionContext> {
  readonly action = "request_changes";
  readonly schema = requestChangesSchema;

  readonly help = `# plan request_changes

Request changes for a task under review.

## Usage
\`\`\`
plan(action: "request_changes", id: "<task-id>", comment: "<feedback>")
\`\`\`

## Parameters
- **id** (required): Task ID
- **comment** (required): Feedback comment explaining what changes are needed

## Notes
- Only pending_review tasks can have changes requested
- Creates a draft feedback record for the change request
- Transitions task status back to in_progress
`;

  protected async doExecute(args: RequestChangesArgs, context: PlanActionContext) {
    const { id, comment } = args;
    const { planReader, planReporter, feedbackReader } = context;

    const task = await planReader.getTask(id);
    if (!task) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Task "${id}" not found.`,
          },
        ],
        isError: true,
      };
    }

    // Check current status
    if (task.status !== "pending_review") {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Cannot request changes. Task "${id}" status: ${task.status}\n\nOnly pending_review tasks can have changes requested.`,
          },
        ],
        isError: true,
      };
    }

    // Create draft feedback for the change request
    const feedbackResult = await feedbackReader.createDraftFeedback({
      taskId: id,
      original: comment,
      decision: "rejected",
    });

    if (!feedbackResult.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Failed to create feedback record: ${feedbackResult.error}`,
          },
        ],
        isError: true,
      };
    }

    // Update status back to in_progress
    const result = await planReader.updateStatus({
      id,
      status: "in_progress",
    });

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    // Update markdown files
    await planReporter.updateAll();

    return {
      content: [
        {
          type: "text" as const,
          text: `Changes requested for task "${id}".\n\nStatus: pending_review → in_progress\n\n**Feedback:** ${comment}\n**Feedback ID:** ${feedbackResult.feedbackId}\n\n---\n\n## Next steps:\n\n1. AI interprets feedback:\n\`\`\`\nplan(action: "interpret", id: "${id}", feedback_id: "${feedbackResult.feedbackId}", interpretation: "<detailed action items>")\n\`\`\`\n\n2. User confirms interpretation:\n\`\`\`\napprove(target: "feedback", task_id: "${id}", feedback_id: "${feedbackResult.feedbackId}")\n\`\`\`\n\n3. AI addresses feedback and resubmits`,
        },
      ],
    };
  }
}
