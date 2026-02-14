import type {
  PlanActionHandler,
  PlanActionParams,
  PlanActionContext,
  ToolResult,
} from "../../../types/index.js";

export class DeleteHandler implements PlanActionHandler {
  async execute(params: {
    actionParams: PlanActionParams;
    context: PlanActionContext;
  }): Promise<ToolResult> {
    const { id } = params.actionParams;
    const { planReader } = params.context;

    if (!id) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: id is required for delete action",
          },
        ],
        isError: true,
      };
    }

    const result = await planReader.deleteTask(id);

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
          text: `Task "${id}" deleted successfully.`,
        },
      ],
    };
  }
}
