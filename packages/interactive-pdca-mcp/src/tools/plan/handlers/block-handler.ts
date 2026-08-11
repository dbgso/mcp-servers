import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";
import type { PlanActionContext } from "../../../types/index.js";

const blockSchema = z.object({
  id: z.string().describe("Task ID"),
  reason: z.string().describe("Reason for blocking"),
});
type BlockArgs = z.infer<typeof blockSchema>;

/**
 * BlockHandler: any → blocked transition
 *
 * Requires:
 * - reason: why the task is blocked
 */
export class BlockHandler extends BaseActionHandler<BlockArgs, PlanActionContext> {
  readonly action = "block";
  readonly schema = blockSchema;

  readonly help = `# plan block

Mark a task as blocked.

## Usage
\`\`\`
plan(action: "block", id: "<task-id>", reason: "<reason>")
\`\`\`

## Parameters
- **id** (required): Task ID to block
- **reason** (required): Reason for blocking

## Notes
- Cannot block completed or skipped tasks
- The reason will be stored in the task output
`;

  protected async doExecute(params: { args: BlockArgs; context: PlanActionContext }) {
    const { args, context } = params;
    const { id, reason } = args;
    const { planReader, planReporter } = context;

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

    // Cannot block completed or skipped tasks
    if (task.status === "completed" || task.status === "skipped") {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Cannot block a ${task.status} task.`,
          },
        ],
        isError: true,
      };
    }

    const oldStatus = task.status;

    // Update status to blocked with reason as output
    const result = await planReader.updateStatus({
      id,
      status: "blocked",
      output: reason,
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
          text: `Task "${id}" marked as blocked.\n\nStatus: ${oldStatus} → blocked\n\n**Reason:** ${reason}\n\nTo unblock, use:\n- \`plan(action: "start", id: "${id}")\` - Resume work`,
        },
      ],
    };
  }
}
