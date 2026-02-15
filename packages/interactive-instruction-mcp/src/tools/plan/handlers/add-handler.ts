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
      parent,
      dependencies,
      dependency_reason,
      prerequisites,
      completion_criteria,
      deliverables,
      is_parallelizable,
      references,
    } = params.actionParams;
    const { planReader, planReporter } = params.context;

    // Validate all required fields are present
    if (
      !id ||
      !title ||
      !content ||
      dependencies === undefined ||
      prerequisites === undefined ||
      completion_criteria === undefined ||
      deliverables === undefined ||
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
- deliverables: array of expected outputs/artifacts (can be empty [])
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

    // Validate that deliverables include test-related items
    const testKeywords = ["test", "テスト", "spec", "検証"];
    const hasTestDeliverable = deliverables.some((d) =>
      testKeywords.some((keyword) => d.toLowerCase().includes(keyword))
    );
    if (!hasTestDeliverable) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: deliverables must include test-related items.

Your deliverables: ${deliverables.length > 0 ? deliverables.join(", ") : "(empty)"}

Please add at least one test-related deliverable, e.g.:
- "unit tests for X"
- "integration tests"
- "test coverage for new functions"
- "テストコード"

This ensures all implementations are verified before completion.`,
          },
        ],
        isError: true,
      };
    }

    const result = await planReader.addTask({
      id,
      title,
      content,
      parent: parent || "",
      dependencies,
      dependency_reason: dependency_reason || "",
      prerequisites,
      completion_criteria,
      deliverables,
      is_parallelizable,
      references,
    });

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    // Update markdown files
    await planReporter.updateAll();

    const depsInfo =
      dependencies.length > 0 ? dependencies.join(", ") : "none";

    const delivsInfo =
      deliverables.length > 0 ? deliverables.join(", ") : "none";

    const parentInfo = parent ? `\nParent: ${parent}` : "";

    return {
      content: [
        {
          type: "text" as const,
          text: `Task "${id}" created successfully.
Path: ${result.path}${parentInfo}
Dependencies: ${depsInfo}
Deliverables: ${delivsInfo}
Parallelizable: ${is_parallelizable}
Completion Criteria: ${completion_criteria}

💡 Consider: Does this task need verification subtasks (build check, test run, review)?
   Add them with: plan(action: "add", parent: "${id}", ...)`,
        },
      ],
    };
  }
}
