import { z } from "zod";
import type {
  PlanActionContext,
  ToolResult,
  PlanRawParams,
} from "../../../types/index.js";

const paramsSchema = z.object({
  id: z.string().describe("Task ID to confirm"),
});

/**
 * ConfirmHandler: Confirm self-review is complete and submit for user review
 */
export class ConfirmHandler {
  readonly action = "confirm";

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

  async execute(params: { rawParams: PlanRawParams; context: PlanActionContext }): Promise<ToolResult> {
    const parseResult = paramsSchema.safeParse(params.rawParams);
    if (!parseResult.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${parseResult.error.errors.map(e => e.message).join(", ")}\n\n${this.help}` }],
        isError: true,
      };
    }
    const { id } = parseResult.data;
    const { planReader, planReporter } = params.context;

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
