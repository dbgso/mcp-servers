import type {
  ToolResult,
  ApproveActionHandler,
  ApproveActionParams,
  ApproveActionContext,
} from "../../../types/index.js";

export class TaskHandler implements ApproveActionHandler {
  async execute(params: {
    actionParams: ApproveActionParams;
    context: ApproveActionContext;
  }): Promise<ToolResult> {
    const { task_id } = params.actionParams;
    const { planReader, planReporter } = params.context;

    // Validate task_id is provided
    if (!task_id) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: task_id is required for target "task".`,
          },
        ],
        isError: true,
      };
    }

    const task = await planReader.getTask(task_id);

    // Validate task exists
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

    const result = await planReader.approveTask(task_id);

    // Handle approval failure
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

    // Show newly ready tasks
    const readyTasks = await planReader.getReadyTasks();
    const pendingReviewTasks = (await planReader.listTasks()).filter(t => t.status === "pending_review");
    const { planDir } = params.context;

    let additionalInfo = "";
    if (readyTasks.length > 0) {
      additionalInfo = `\n\nReady tasks: ${readyTasks.map((t) => t.id).join(", ")}`;
    }

    // Show review files if there are more pending review tasks
    let reviewFilesInfo = "";
    if (pendingReviewTasks.length > 0) {
      reviewFilesInfo = `\n\n**More tasks pending review (${pendingReviewTasks.length}):**\n`;
      reviewFilesInfo += `- \`${planDir}/PENDING_REVIEW.md\` - Detailed task output\n`;
      reviewFilesInfo += `- \`${planDir}/GRAPH.md\` - Task dependency graph`;
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Task "${task_id}" approved and marked as completed.\n\nOutput was: ${task.output}${additionalInfo}${reviewFilesInfo}`,
        },
      ],
    };
  }
}
