import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";
import type {
  PlanActionContext,
  TaskSummary,
} from "../../../types/index.js";
import { formatParallel } from "./format-utils.js";

const listSchema = z.object({});
type ListArgs = z.infer<typeof listSchema>;

/**
 * ListHandler: Display all tasks with status summary
 */
export class ListHandler extends BaseActionHandler<ListArgs, PlanActionContext> {
  readonly action = "list";
  readonly schema = listSchema;

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

  protected async doExecute(params: { args: ListArgs; context: PlanActionContext }) {
    const { context } = params;
    const { planReader, planReporter } = context;

    // Update markdown files to ensure they're in sync
    await planReporter.updateAll();
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
      const { planDir } = context;
      output += "## Pending Review\n\n";
      output += "The following tasks are waiting for user approval. Review and approve or request changes.\n\n";
      output += `**Review files:**\n`;
      output += `- \`${planDir}/PENDING_REVIEW.md\` - Detailed task output for review\n`;
      output += `- \`${planDir}/GRAPH.md\` - Task dependency graph\n\n`;

      for (const t of byStatus.pending_review) {
        const task = await planReader.getTask(t.id);
        if (task) {
          output += `### ${t.id}: ${t.title}\n\n`;
          output += `**What**\n`;
          output += `- Deliverables: ${task.deliverables.length > 0 ? task.deliverables.join(", ") : "none"}\n`;
          output += `- Result: ${task.output || "(not recorded)"}\n\n`;
          output += `**Why**\n`;
          output += `- Completion criteria: ${task.completion_criteria || "(not set)"}\n\n`;
          output += `**How**\n`;
          output += `- Approve: \`plan(action: "approve", id: "${t.id}")\`\n`;
          output += `- Request changes: \`plan(action: "status", id: "${t.id}", status: "in_progress")\`\n\n`;
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
