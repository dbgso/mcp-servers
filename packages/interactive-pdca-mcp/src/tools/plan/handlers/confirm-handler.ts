import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";
import type { PlanActionContext } from "../../../types/index.js";

const confirmSchema = z.object({
  id: z.string().describe("Task ID to confirm"),
});
type ConfirmArgs = z.infer<typeof confirmSchema>;

/**
 * ConfirmHandler: Confirm self-review is complete and submit for user review
 */
export class ConfirmHandler extends BaseActionHandler<ConfirmArgs, PlanActionContext> {
  readonly action = "confirm";
  readonly schema = confirmSchema;

  readonly help = `# plan confirm

Confirm self-review is complete and submit the task for user review.

## Usage
\`\`\`
plan(action: "confirm", id: "<task-id>")
\`\`\`

## Parameters
- **id** (required): Task ID in self_review status

## Notes
- Only works for tasks in self_review status
- Transitions task from self_review → pending_review
- Use this after verifying your submission meets all requirements
`;

  protected async doExecute(params: { args: ConfirmArgs; context: PlanActionContext }) {
    const { args, context } = params;
    const { id } = args;
    const { planReader, planReporter } = context;

    const result = await planReader.confirmSelfReview(id);

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    await planReporter.updateAll();

    const task = await planReader.getTask(id);

    return {
      content: [
        {
          type: "text" as const,
          text: `Task "${id}" confirmed and submitted for user review.

Status: self_review → pending_review

**Waiting for user approval.** User can:
- \`approve(target: "task", task_id: "${id}")\` - Approve and complete
- \`plan(action: "request_changes", id: "${id}", comment: "<feedback>")\` - Request changes

**Output summary:**
${task?.output || "(no output)"}`,
        },
      ],
    };
  }
}
