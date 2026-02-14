import type {
  PlanActionHandler,
  PlanActionParams,
  PlanActionContext,
  ToolResult,
} from "../../../types/index.js";

export class ReadHandler implements PlanActionHandler {
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
            text: "Error: id is required for read action",
          },
        ],
        isError: true,
      };
    }

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

    const deps =
      task.dependencies.length > 0 ? task.dependencies.join(", ") : "none";
    const refs = task.references.length > 0 ? task.references.join(", ") : "none";

    const output = `# Task: ${task.title}

**ID:** ${task.id}
**Status:** ${task.status}
**Dependencies:** ${deps}
**Dependency Reason:** ${task.dependency_reason || "N/A"}
**Prerequisites:** ${task.prerequisites || "N/A"}
**Completion Criteria:** ${task.completion_criteria || "N/A"}
**Parallelizable:** ${task.is_parallelizable ? "yes" : "no"}
**References:** ${refs}
**Created:** ${task.created}
**Updated:** ${task.updated}

---

${task.content}`;

    return {
      content: [{ type: "text" as const, text: output }],
    };
  }
}
