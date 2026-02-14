import type {
  PlanActionHandler,
  PlanActionParams,
  PlanActionContext,
  ToolResult,
} from "../../../types/index.js";

export class AddHandler implements PlanActionHandler {
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

    // Validate all required fields are present
    if (
      !id ||
      !title ||
      !content ||
      dependencies === undefined ||
      prerequisites === undefined ||
      completion_criteria === undefined ||
      is_parallelizable === undefined ||
      references === undefined
    ) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: All fields are required for add action:
- id: task identifier (string)
- title: task title (string)
- content: task description/work content (string)
- dependencies: array of dependent task IDs (can be empty [])
- dependency_reason: why this task depends on others (string, can be empty if no dependencies)
- prerequisites: what is needed before starting (string)
- completion_criteria: what defines completion (string)
- is_parallelizable: can run in parallel? (boolean)
- references: array of document IDs (can be empty [])`,
          },
        ],
        isError: true,
      };
    }

    // Validate dependency_reason is provided when there are dependencies
    if (dependencies.length > 0 && !dependency_reason) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: dependency_reason is required when dependencies are specified.
Please explain why this task depends on: ${dependencies.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    const result = await planReader.addTask({
      id,
      title,
      content,
      dependencies,
      dependency_reason: dependency_reason || "",
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

    const depsInfo =
      dependencies.length > 0 ? dependencies.join(", ") : "none";

    return {
      content: [
        {
          type: "text" as const,
          text: `Task "${id}" created successfully.
Path: ${result.path}
Dependencies: ${depsInfo}
Parallelizable: ${is_parallelizable}
Completion Criteria: ${completion_criteria}`,
        },
      ],
    };
  }
}
