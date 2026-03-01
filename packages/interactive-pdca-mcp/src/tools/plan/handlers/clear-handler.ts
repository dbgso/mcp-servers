import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";
import type { PlanActionContext } from "../../../types/index.js";

const clearSchema = z.object({});
type ClearArgs = z.infer<typeof clearSchema>;

/**
 * ClearHandler: Clear all tasks from the plan
 */
export class ClearHandler extends BaseActionHandler<ClearArgs, PlanActionContext> {
  readonly action = "clear";
  readonly schema = clearSchema;

  readonly help = `# plan clear

Clear all tasks from the plan.

## Usage
\`\`\`
plan(action: "clear")
\`\`\`

## Parameters
None required.

## Notes
- Removes all tasks from the plan
- This action cannot be undone
`;

  protected async doExecute(params: { args: ClearArgs; context: PlanActionContext }) {
    const { context } = params;
    const { planReader, planReporter } = context;

    const tasks = await planReader.listTasks();
    if (tasks.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No tasks to clear.",
          },
        ],
      };
    }

    const result = await planReader.clearAllTasks();

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    // Update markdown files
    await planReporter.updateAll();

    return {
      content: [
        {
          type: "text" as const,
          text: `Cleared ${result.count} tasks. Plan is now empty.`,
        },
      ],
    };
  }
}
