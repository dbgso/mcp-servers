import { z } from "zod";
import type {
  PlanActionContext,
  ToolResult,
  PlanRawParams,
} from "../../../types/index.js";

const paramsSchema = z.object({
  id: z.string().describe("Task ID"),
});

/**
 * ReadOutputHandler: Read output content of a task
 */
export class ReadOutputHandler {
  readonly action = "read_output";

  readonly help = `# plan read_output

Read the output content of a task.

## Usage
\`\`\`
plan(action: "read_output", id: "<task-id>")
\`\`\`

## Parameters
- **id** (required): Task ID

## Notes
- Returns only the output_content section of the task
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
    const { planReader } = params.context;

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

    // Return only the output_content section
    if (!task.output_content || task.output_content.trim() === "") {
      return {
        content: [
          {
            type: "text" as const,
            text: `# Output Content: ${task.title}\n\n**ID:** ${task.id}\n**Status:** ${task.status}\n\n---\n\n(no output content yet)`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `# Output Content: ${task.title}\n\n**ID:** ${task.id}\n**Status:** ${task.status}\n\n---\n\n${task.output_content}`,
        },
      ],
    };
  }
}
