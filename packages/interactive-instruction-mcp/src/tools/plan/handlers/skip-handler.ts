import { z } from "zod";
import type {
  PlanActionContext,
  ToolResult,
  PlanRawParams,
} from "../../../types/index.js";

const paramsSchema = z.object({
  id: z.string().describe("Task ID"),
  reason: z.string().describe("Reason for skipping"),
});

/**
 * SkipHandler: any → skipped transition
 *
 * Requires:
 * - reason: why the task is being skipped
 */
export class SkipHandler {
  readonly action = "skip";

  readonly help = `# plan skip

Skip a task with a reason.

## Usage
\`\`\`
plan(action: "skip", id: "<task-id>", reason: "<why skipping>")
\`\`\`

## Parameters
- **id** (required): Task ID to skip
- **reason** (required): Reason for skipping the task

## Notes
- Completed tasks cannot be skipped
- The reason is stored as the task's output
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

    // Cannot skip completed tasks
    if (task.status === "completed") {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Cannot skip a completed task.`,
          },
        ],
        isError: true,
      };
    }

    const oldStatus = task.status;

    // Update status to skipped with reason as output
    const result = await planReader.updateStatus({
      id,
      status: "skipped",
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
          text: `Task "${id}" skipped.\n\nStatus: ${oldStatus} → skipped\n\n**Reason:** ${reason}`,
        },
      ],
    };
  }
}
