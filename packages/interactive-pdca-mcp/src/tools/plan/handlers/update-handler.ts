import { z } from "zod";
import type { PlanActionContext, ToolResult, PlanRawParams } from "../../../types/index.js";

const paramsSchema = z.object({
  id: z.string().describe("Task ID to update"),
  title: z.string().optional().describe("New task title"),
  content: z.string().optional().describe("Task description/work content"),
  dependencies: z
    .array(z.string())
    .optional()
    .describe("Array of dependent task IDs"),
  dependency_reason: z
    .string()
    .optional()
    .describe("Explanation of why this task depends on others"),
  prerequisites: z
    .string()
    .optional()
    .describe("What is needed before starting this task"),
  completion_criteria: z
    .string()
    .optional()
    .describe("What defines task completion"),
  is_parallelizable: z
    .boolean()
    .optional()
    .describe("Whether the task can run in parallel with others"),
  parallelizable_units: z
    .array(z.string())
    .optional()
    .describe("Array of task IDs that can run in parallel with this task"),
  references: z
    .array(z.string())
    .optional()
    .describe("Array of document IDs for reference"),
});

/**
 * UpdateHandler: Update task properties
 */
export class UpdateHandler {
  readonly action = "update";

  readonly help = `# plan update

Update task properties.

## Usage
\`\`\`
plan(action: "update", id: "<task-id>", title?: "...", content?: "...", ...)
\`\`\`

## Parameters
- **id** (required): Task ID to update
- **title**: New task title
- **content**: Task description/work content
- **dependencies**: Array of dependent task IDs
- **dependency_reason**: Why this task depends on others (required when adding dependencies)
- **prerequisites**: What is needed before starting
- **completion_criteria**: What defines completion
- **is_parallelizable**: Can run in parallel?
- **parallelizable_units**: Array of task IDs that can run in parallel with this task
- **references**: Array of document IDs

## Notes
- At least one field to update must be provided (besides id)
- When adding dependencies, dependency_reason is required
`;

  async execute(params: { rawParams: PlanRawParams; context: PlanActionContext }): Promise<ToolResult> {
    const parseResult = paramsSchema.safeParse(params.rawParams);
    if (!parseResult.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${parseResult.error.errors.map((e) => e.message).join(", ")}\n\n${this.help}`,
          },
        ],
        isError: true,
      };
    }

    const {
      id,
      title,
      content,
      dependencies,
      dependency_reason,
      prerequisites,
      completion_criteria,
      is_parallelizable,
      parallelizable_units,
      references,
    } = parseResult.data;

    // Check if at least one field to update is provided
    if (
      title === undefined &&
      content === undefined &&
      dependencies === undefined &&
      dependency_reason === undefined &&
      prerequisites === undefined &&
      completion_criteria === undefined &&
      is_parallelizable === undefined &&
      parallelizable_units === undefined &&
      references === undefined
    ) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: At least one field to update is required.\n\n${this.help}`,
          },
        ],
        isError: true,
      };
    }

    const { planReader } = params.context;

    // Validate dependency_reason when updating dependencies
    if (
      dependencies !== undefined &&
      dependencies.length > 0 &&
      !dependency_reason
    ) {
      // Get existing task to check if it has a dependency_reason
      const existingTask = await planReader.getTask(id);
      if (existingTask && !existingTask.dependency_reason) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: dependency_reason is required when adding dependencies.
Please explain why this task depends on: ${dependencies.join(", ")}`,
            },
          ],
          isError: true,
        };
      }
    }

    const result = await planReader.updateTask({
      id,
      title,
      content,
      dependencies,
      dependency_reason,
      prerequisites,
      completion_criteria,
      is_parallelizable,
      parallelizable_units,
      references,
    });

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Task "${id}" updated successfully.`,
        },
      ],
    };
  }
}
