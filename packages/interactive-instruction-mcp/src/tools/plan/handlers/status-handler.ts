import type {
  PlanActionHandler,
  PlanActionParams,
  PlanActionContext,
  ToolResult,
  TaskStatus,
} from "../../../types/index.js";

const VALID_STATUSES: TaskStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "skipped",
];

export class StatusHandler implements PlanActionHandler {
  async execute(params: {
    actionParams: PlanActionParams;
    context: PlanActionContext;
  }): Promise<ToolResult> {
    const { id, status } = params.actionParams;
    const { planReader } = params.context;

    if (!id || !status) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: id and status are required for status action.
Valid statuses: ${VALID_STATUSES.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    if (!VALID_STATUSES.includes(status)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Invalid status "${status}".
Valid statuses: ${VALID_STATUSES.join(", ")}`,
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

    const oldStatus = task.status;
    const result = await planReader.updateStatus({ id, status });

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    let additionalInfo = "";

    // If completing a task, show newly ready tasks
    if (status === "completed") {
      const readyTasks = await planReader.getReadyTasks();
      if (readyTasks.length > 0) {
        const newlyReady = readyTasks.filter(
          (t) => t.status === "pending"
        );
        if (newlyReady.length > 0) {
          additionalInfo = `\n\nNewly ready tasks: ${newlyReady.map((t) => t.id).join(", ")}`;
        }
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Task "${id}" status changed: ${oldStatus} -> ${status}${additionalInfo}`,
        },
      ],
    };
  }
}
