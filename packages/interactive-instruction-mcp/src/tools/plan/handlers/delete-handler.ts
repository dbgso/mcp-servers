import { z } from "zod";
import type {
  PlanActionContext,
  ToolResult,
  PlanRawParams,
} from "../../../types/index.js";

const paramsSchema = z.object({
  id: z.string().describe("Task ID to delete"),
});

/**
 * DeleteHandler: Remove a task from the plan
 */
export class DeleteHandler {
  readonly action = "delete";

  readonly help = `# plan delete

Delete a task from the plan.

## Usage
\`\`\`
plan(action: "delete", id: "<task-id>")
\`\`\`

## Parameters
- **id** (required): Task ID to delete
`;

  async execute(params: { rawParams: PlanRawParams; context: PlanActionContext }): Promise<ToolResult> {
    const parseResult = paramsSchema.safeParse(params.rawParams);
    if (!parseResult.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${parseResult.error.errors.map(e => e.message).join(", ")}\n\n${this.help}` }],
        isError: true,
      };
    }
    const { id } = parseResult.data;
    const { planReader, planReporter } = params.context;

    const result = await planReader.deleteTask(id);

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
          text: `Task "${id}" deleted successfully.`,
        },
      ],
    };
  }
}
