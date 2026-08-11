import type {
  ToolResult,
  ApproveActionHandler,
  ApproveActionParams,
  ApproveActionContext,
} from "../../../types/index.js";

export class DeletionHandler implements ApproveActionHandler {
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
            text: `Error: task_id is required for target "deletion".`,
          },
        ],
        isError: true,
      };
    }

    const pending = await planReader.getPendingDeletion(task_id);
    if (!pending) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: No pending deletion found for task "${task_id}".`,
          },
        ],
        isError: true,
      };
    }

    const result = await planReader.executePendingDeletion(task_id);
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

    await planReporter.updateAll();

    return {
      content: [
        {
          type: "text" as const,
          text: `Cascade deleted ${result.deleted?.length ?? 0} tasks:\n${result.deleted?.map((t) => `- ${t}`).join("\n") ?? ""}`,
        },
      ],
    };
  }
}
