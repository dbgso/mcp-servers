import type {
  PlanActionHandler,
  PlanActionParams,
  PlanActionContext,
  ToolResult,
  TaskSummary,
} from "../../../types/index.js";

export class ListHandler implements PlanActionHandler {
  async execute(params: {
    actionParams: PlanActionParams;
    context: PlanActionContext;
  }): Promise<ToolResult> {
    const { planReader } = params.context;
    const tasks: TaskSummary[] = await planReader.listTasks();

    if (tasks.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: 'No tasks found. Use `plan(action: "add", ...)` to create one.',
          },
        ],
      };
    }

    // Group tasks by status
    const byStatus = {
      in_progress: tasks.filter((t) => t.status === "in_progress"),
      pending: tasks.filter((t) => t.status === "pending"),
      blocked: [] as TaskSummary[],
      completed: tasks.filter((t) => t.status === "completed"),
      skipped: tasks.filter((t) => t.status === "skipped"),
    };

    // Get blocked and ready tasks
    const blockedTasks: TaskSummary[] = await planReader.getBlockedTasks();
    const readyTasks: TaskSummary[] = await planReader.getReadyTasks();

    byStatus.blocked = blockedTasks;

    let output = "# Task Plan\n\n";
    output += `**Summary:** ${tasks.length} total | `;
    output += `${byStatus.completed.length} completed | `;
    output += `${byStatus.in_progress.length} in progress | `;
    output += `${readyTasks.length} ready | `;
    output += `${byStatus.blocked.length} blocked\n\n`;

    if (readyTasks.length > 0) {
      output += "## Ready to Start\n";
      for (const t of readyTasks) {
        const parallel = t.is_parallelizable ? " [parallel]" : "";
        output += `- **${t.id}**: ${t.title}${parallel}\n`;
      }
      output += "\n";
    }

    if (byStatus.in_progress.length > 0) {
      output += "## In Progress\n";
      for (const t of byStatus.in_progress) {
        output += `- **${t.id}**: ${t.title}\n`;
      }
      output += "\n";
    }

    if (byStatus.blocked.length > 0) {
      output += "## Blocked\n";
      for (const t of byStatus.blocked) {
        output += `- **${t.id}**: ${t.title} (waiting: ${t.dependencies.join(", ")})\n`;
      }
      output += "\n";
    }

    // Full task list
    output += "## All Tasks\n";
    output += planReader.formatTaskList(tasks);

    return {
      content: [{ type: "text" as const, text: output }],
    };
  }
}
