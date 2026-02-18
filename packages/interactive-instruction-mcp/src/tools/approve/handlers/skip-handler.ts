import type {
  ToolResult,
  ApproveActionHandler,
  ApproveActionParams,
  ApproveActionContext,
} from "../../../types/index.js";

export class SkipHandler implements ApproveActionHandler {
  async execute(params: {
    actionParams: ApproveActionParams;
    context: ApproveActionContext;
  }): Promise<ToolResult> {
    const { task_id, reason } = params.actionParams;
    const { planReader, planReporter } = params.context;

    // Validate task_id is provided
    if (!task_id) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: task_id is required for target "skip".`,
          },
        ],
        isError: true,
      };
    }

    // Validate reason is provided
    if (!reason) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: reason is required when target is 'skip'.`,
          },
        ],
        isError: true,
      };
    }

    const task = await planReader.getTask(task_id);
    if (!task) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Task "${task_id}" not found.`,
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
      id: task_id,
      status: "skipped",
      output: reason,
    });

    if (!result.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${result.error}`,
          },
        ],
        isError: true,
      };
    }

    // Update markdown files
    await planReporter.updateAll();

    return {
      content: [
        {
          type: "text" as const,
          text: `Task "${task_id}" skipped.\n\nStatus: ${oldStatus} → skipped\n\n**Reason:** ${reason}`,
        },
      ],
    };
  }
}
