import { z } from "zod";
import type {
  PlanActionContext,
  ToolResult,
  PlanRawParams,
} from "../../../types/index.js";

const paramsSchema = z.object({
  id: z.string().describe("Task ID"),
  reason: z.string().describe("Reason for blocking"),
});

/**
 * BlockHandler: any → blocked transition
 *
 * Requires:
 * - reason: why the task is blocked
 */
export class BlockHandler {
  readonly action = "block";

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

  async execute(params: { rawParams: PlanRawParams; context: PlanActionContext }): Promise<ToolResult> {
    const parseResult = paramsSchema.safeParse(params.rawParams);
    if (!parseResult.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${parseResult.error.errors.map(e => e.message).join(", ")}\n\n${this.help}` }],
        isError: true,
      };
    }
    const { id, reason } = parseResult.data;
    const { planReader, planReporter } = params.context;

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
