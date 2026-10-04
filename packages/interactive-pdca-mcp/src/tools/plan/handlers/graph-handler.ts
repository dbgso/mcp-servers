import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";
import type { PlanActionContext, TaskStatus, TaskSummary } from "../../../types/index.js";
import { STATUS_STYLE, statusLookup } from "../../../services/task-presentation.js";

const STATUS_ICON: Record<TaskStatus, string> = {
  completed: "✓",
  self_review: "◐",
  pending_review: "⏳",
  in_progress: "●",
  blocked: "◇",
  skipped: "⊘",
  pending: "○",
};

const graphSchema = z.object({});
type GraphArgs = z.infer<typeof graphSchema>;

/**
 * GraphHandler: Display task graph as Mermaid flowchart
 */
export class GraphHandler extends BaseActionHandler<GraphArgs, PlanActionContext> {
  readonly action = "graph";
  readonly schema = graphSchema;

  readonly help = `# plan graph

Display task graph as Mermaid flowchart.

## Usage
\`\`\`
plan(action: "graph")
\`\`\`

## Parameters
None

## Output
- Mermaid flowchart showing task dependencies
- Status icons and styling for each task
- Legend explaining symbols
`;

  protected async doExecute(params: { args: GraphArgs; context: PlanActionContext }) {
    const { context } = params;
    const { planReader } = context;
    const tasks: TaskSummary[] = await planReader.listTasks();

    if (tasks.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No tasks to graph.",
          },
        ],
      };
    }

    const blockedTasks = await planReader.getBlockedTasks();
    const blockedIds = new Set(blockedTasks.map((t) => t.id));

    // Build Mermaid flowchart
    let mermaid = "```mermaid\nflowchart TD\n";

    // Define nodes with status styling
    for (const task of tasks) {
      const status = blockedIds.has(task.id) ? "blocked" : task.status;
      const icon = statusLookup({ table: STATUS_ICON, status });
      const label = `${task.title} ${icon}`;
      const nodeId = this.sanitizeId(task.id);

      // Use different shapes based on parallelizable
      if (task.is_parallelizable) {
        mermaid += `  ${nodeId}([${label}])\n`;
      } else {
        mermaid += `  ${nodeId}[${label}]\n`;
      }
    }

    mermaid += "\n";

    // Define edges (dependencies)
    for (const task of tasks) {
      const nodeId = this.sanitizeId(task.id);
      for (const dep of task.dependencies) {
        const depId = this.sanitizeId(dep);
        mermaid += `  ${depId} --> ${nodeId}\n`;
      }
    }

    mermaid += "\n";

    // Add styling
    mermaid += "  %% Styling\n";
    for (const task of tasks) {
      const status = blockedIds.has(task.id) ? "blocked" : task.status;
      const style = statusLookup({ table: STATUS_STYLE, status });
      const nodeId = this.sanitizeId(task.id);
      mermaid += `  style ${nodeId} ${style}\n`;
    }

    mermaid += "```";

    // Add legend
    let output = "# Task Graph\n\n";
    output += mermaid;
    output += "\n\n## Legend\n";
    output += "- ✓ completed\n";
    output += "- ◐ self_review\n";
    output += "- ⏳ pending_review\n";
    output += "- ● in_progress\n";
    output += "- ○ pending/ready\n";
    output += "- ◇ blocked\n";
    output += "- ⊘ skipped\n";
    output += "- `[ ]` sequential\n";
    output += "- `([ ])` parallelizable\n";

    return {
      content: [{ type: "text" as const, text: output }],
    };
  }

  private sanitizeId(id: string): string {
    // Mermaid IDs can't have hyphens in some contexts, replace with underscore
    return id.replace(/-/g, "_");
  }
}
