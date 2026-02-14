import type {
  PlanActionHandler,
  PlanActionParams,
  PlanActionContext,
  ToolResult,
} from "../../../types/index.js";

export class ClearHandler implements PlanActionHandler {
  async execute(params: {
    actionParams: PlanActionParams;
    context: PlanActionContext;
  }): Promise<ToolResult> {
    const { planReader } = params.context;

    const tasks = await planReader.listTasks();
    if (tasks.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No tasks to clear.",
          },
        ],
      };
    }

    const result = await planReader.clearAllTasks();

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Cleared ${result.count} tasks. Plan is now empty.`,
        },
      ],
    };
  }
}
