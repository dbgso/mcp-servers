import type {
  PlanActionHandler,
  PlanActionParams,
  PlanActionContext,
  ToolResult,
} from "../../../types/index.js";

export class UpdateHandler implements PlanActionHandler {
  async execute(params: {
    actionParams: PlanActionParams;
    context: PlanActionContext;
  }): Promise<ToolResult> {
    const {
      id,
      title,
      content,
      dependencies,
      dependency_reason,
      prerequisites,
      completion_criteria,
      is_parallelizable,
      references,
    } = params.actionParams;
    const { planReader } = params.context;

    if (!id) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: id is required for update action",
          },
        ],
        isError: true,
      };
    }

    // Check if at least one field to update is provided
    if (
      title === undefined &&
      content === undefined &&
      dependencies === undefined &&
      dependency_reason === undefined &&
      prerequisites === undefined &&
      completion_criteria === undefined &&
      is_parallelizable === undefined &&
      references === undefined
    ) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: At least one field to update is required:
- title: task title
- content: task description/work content
- dependencies: array of dependent task IDs
- dependency_reason: why this task depends on others
- prerequisites: what is needed before starting
- completion_criteria: what defines completion
- is_parallelizable: can run in parallel?
- references: array of document IDs`,
          },
        ],
        isError: true,
      };
    }

    // Validate dependency_reason when updating dependencies
    if (dependencies !== undefined && dependencies.length > 0 && !dependency_reason) {
      // Get existing task to check if it has a dependency_reason
      const existingTask = await planReader.getTask(id);
      if (existingTask && !existingTask.dependency_reason) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: dependency_reason is required when adding dependencies.
Please explain why this task depends on: ${dependencies.join(", ")}`,
            },
          ],
          isError: true,
        };
      }
    }

    const result = await planReader.updateTask({
      id,
      title,
      content,
      dependencies,
      dependency_reason,
      prerequisites,
      completion_criteria,
      is_parallelizable,
      references,
    });

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
          text: `Task "${id}" updated successfully.`,
        },
      ],
    };
  }
}
