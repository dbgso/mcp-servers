import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";
import type { PlanActionContext, TaskSummary } from "../../../types/index.js";
import { renderTaskGraph } from "../../../services/task-graph.js";

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

    const blockedIds = new Set((await planReader.getBlockedTasks()).map((t) => t.id));
    return {
      content: [{ type: "text" as const, text: renderTaskGraph({ tasks, blockedIds }) }],
    };
  }
}
