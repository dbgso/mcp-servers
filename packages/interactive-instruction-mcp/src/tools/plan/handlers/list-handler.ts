import { z } from "zod";
import type {
  PlanActionContext,
  PlanRawParams,
  TaskSummary,
  ToolResult,
} from "../../../types/index.js";
import { formatParallel } from "./format-utils.js";

const paramsSchema = z.object({});

/**
 * ListHandler: Display all tasks with status summary
 */
export class ListHandler {
  readonly action = "list";

  readonly help = `# plan list

List all tasks with status summary.

## Usage
\`\`\`
plan(action: "list")
\`\`\`

## Parameters
None required.

## Notes
- Shows task summary grouped by status
- Highlights tasks pending review
- Shows ready-to-start and blocked tasks
`;

  async execute(params: { rawParams: PlanRawParams; context: PlanActionContext }): Promise<ToolResult> {
    const parseResult = paramsSchema.safeParse(params.rawParams);
    if (!parseResult.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${parseResult.error.errors.map(e => e.message).join(", ")}\n\n${this.help}` }],
        isError: true,
      };
    }

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

    // Group tasks by status (only statuses used in output)
    const byStatus = {
      in_progress: tasks.filter((t) => t.status === "in_progress"),
      pending_review: tasks.filter((t) => t.status === "pending_review"),
      blocked: [] as TaskSummary[],
      completed: tasks.filter((t) => t.status === "completed"),
    };

    // Get blocked and ready tasks
    const blockedTasks: TaskSummary[] = await planReader.getBlockedTasks();
    const readyTasks: TaskSummary[] = await planReader.getReadyTasks();

    byStatus.blocked = blockedTasks;

    let output = "# Task Plan\n\n";
    output += `**Summary:** ${tasks.length} total | `;
    output += `${byStatus.completed.length} completed | `;
    output += `${byStatus.pending_review.length} pending_review | `;
    output += `${byStatus.in_progress.length} in progress | `;
    output += `${readyTasks.length} ready | `;
    output += `${byStatus.blocked.length} blocked\n\n`;

    // Pending Review section with full details
    if (byStatus.pending_review.length > 0) {
      output += "## ⚠️ Pending Review (承認待ち)\n\n";
      output += "以下のタスクはユーザーの承認を待っています。内容を確認して承認または差し戻してください。\n\n";

      for (const t of byStatus.pending_review) {
        const task = await planReader.getTask(t.id);
        if (task) {
          output += `### ${t.id}: ${t.title}\n\n`;
          output += `**What (何をしたか)**\n`;
          output += `- 成果物: ${task.deliverables.length > 0 ? task.deliverables.join(", ") : "なし"}\n`;
          output += `- 結果: ${task.output || "(未記入)"}\n\n`;
          output += `**Why (判断基準)**\n`;
          output += `- 完了条件: ${task.completion_criteria || "(未設定)"}\n\n`;
          output += `**How (次のアクション)**\n`;
          output += `- 承認: \`plan(action: "approve", id: "${t.id}")\`\n`;
          output += `- 差し戻し: \`plan(action: "status", id: "${t.id}", status: "in_progress")\`\n\n`;
        }
      }
    }

    if (readyTasks.length > 0) {
      output += "## Ready to Start\n";
      for (const t of readyTasks) {
        const parallel = formatParallel({ task: t, options: { style: "tag" } });
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
