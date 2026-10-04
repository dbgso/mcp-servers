import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";
import type {
  PlanActionContext,
  Task,
  TaskStatus,
  TaskSummary,
} from "../../../types/index.js";
import { listOrNone, reviewCommands } from "../../../services/task-presentation.js";
import { formatParallel } from "./format-utils.js";

const listSchema = z.object({});
type ListArgs = z.infer<typeof listSchema>;

/** One task's entry in the pending-review section: what was delivered, against what, and the calls to decide it. */
function reviewEntry(task: Task): string {
  const commands = reviewCommands(task.id);
  return `### ${task.id}: ${task.title}

**What**
- Deliverables: ${listOrNone(task.deliverables)}
- Result: ${task.output || "(not recorded)"}

**Why**
- Completion criteria: ${task.completion_criteria || "(not set)"}

**How**
- Approve: \`${commands.approve}\`
- Request changes: \`${commands.requestChanges}\`

`;
}

function pendingReviewSection(params: { tasks: Task[]; planDir: string }): string {
  const { tasks, planDir } = params;
  if (tasks.length === 0) return "";
  return `## Pending Review

The following tasks are waiting for user approval. Review and approve or request changes.

**Review files:**
- \`${planDir}/PENDING_REVIEW.md\` - Detailed task output for review
- \`${planDir}/GRAPH.md\` - Task dependency graph

${tasks.map(reviewEntry).join("")}`;
}

/** A `## heading` with one line per task, or nothing when there are none. */
function taskListSection(params: {
  heading: string;
  tasks: TaskSummary[];
  describe: (task: TaskSummary) => string;
}): string {
  const { heading, tasks, describe } = params;
  if (tasks.length === 0) return "";
  const lines = tasks.map((t) => `- **${t.id}**: ${t.title}${describe(t)}\n`);
  return `## ${heading}\n${lines.join("")}\n`;
}

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

    const blockedTasks: TaskSummary[] = await planReader.getBlockedTasks();
    const readyTasks: TaskSummary[] = await planReader.getReadyTasks();
    const withStatus = (status: TaskStatus) => tasks.filter((t) => t.status === status);
    const inProgress = withStatus("in_progress");
    const pendingReview = withStatus("pending_review");
    const reviewTasks = (
      await Promise.all(pendingReview.map((t) => planReader.getTask(t.id)))
    ).filter((t): t is Task => t !== null);

    let output = "# Task Plan\n\n";
    output += `**Summary:** ${tasks.length} total | `;
    output += `${withStatus("completed").length} completed | `;
    output += `${pendingReview.length} pending_review | `;
    output += `${inProgress.length} in progress | `;
    output += `${readyTasks.length} ready | `;
    output += `${blockedTasks.length} blocked\n\n`;
    output += pendingReviewSection({ tasks: reviewTasks, planDir: context.planDir });
    output += taskListSection({ heading: "Ready to Start", tasks: readyTasks, describe: (t) => formatParallel({ task: t, options: { style: "tag" } }) });
    output += taskListSection({ heading: "In Progress", tasks: inProgress, describe: () => "" });
    output += taskListSection({ heading: "Blocked", tasks: blockedTasks, describe: (t) => ` (waiting: ${t.dependencies.join(", ")})` });

    // Full task list
    output += "## All Tasks\n";
    output += planReader.formatTaskList(tasks);

    return {
      content: [{ type: "text" as const, text: output }],
    };
  }
}
