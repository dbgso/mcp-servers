import { z } from "zod";
import type {
  PlanActionContext,
  ToolResult,
  PlanRawParams,
} from "../../../types/index.js";

const paramsSchema = z.object({});

/**
 * ClearHandler: Clear all tasks from the plan
 */
export class ClearHandler {
  readonly action = "clear";

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

  async execute(params: { rawParams: PlanRawParams; context: PlanActionContext }): Promise<ToolResult> {
    const parseResult = paramsSchema.safeParse(params.rawParams);
    if (!parseResult.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${parseResult.error.errors.map(e => e.message).join(", ")}\n\n${this.help}` }],
        isError: true,
      };
    }

    const { planReader, planReporter } = params.context;

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
