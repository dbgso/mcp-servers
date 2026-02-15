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
    const delivs =
      task.deliverables.length > 0 ? task.deliverables.join(", ") : "none";

    let feedbackSection = "";
    if (task.feedback && task.feedback.length > 0) {
      feedbackSection = "\n\n## Feedback History\n\n";
      for (const fb of task.feedback) {
        const icon = fb.decision === "adopted" ? "✅" : "❌";
        feedbackSection += `${icon} **${fb.decision}** (${fb.timestamp})\n`;
        feedbackSection += `> ${fb.comment}\n\n`;
      }
    }

    const output = `# Task: ${task.title}

**ID:** ${task.id}
**Status:** ${task.status}
**Parent:** ${task.parent || "(root)"}
**Dependencies:** ${deps}
**Dependency Reason:** ${task.dependency_reason || "N/A"}
**Prerequisites:** ${task.prerequisites || "N/A"}
**Completion Criteria:** ${task.completion_criteria || "N/A"}
**Deliverables:** ${delivs}
**Output:** ${task.output || "(not completed)"}
**Parallelizable:** ${task.is_parallelizable ? "yes" : "no"}
**References:** ${refs}
**Created:** ${task.created}
**Updated:** ${task.updated}

---

${task.content}${feedbackSection}`;

    return {
      content: [{ type: "text" as const, text: output }],
    };
  }
}
