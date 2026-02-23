import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";
import type { PlanActionContext } from "../../../types/index.js";

const addSchema = z.object({
  id: z.string().describe("Unique task identifier"),
  title: z.string().describe("Task title"),
  content: z.string().describe("Task description/work content"),
  parent: z
    .string()
    .optional()
    .default("")
    .describe("Parent task ID (empty for root tasks)"),
  dependencies: z
    .array(z.string())
    .describe("Array of dependent task IDs (can be empty [])"),
  dependency_reason: z
    .string()
    .optional()
    .default("")
    .describe("Why this task depends on others (required if dependencies exist)"),
  prerequisites: z.string().describe("What is needed before starting"),
  completion_criteria: z.string().describe("What defines completion"),
  deliverables: z
    .array(z.string())
    .describe("Array of expected outputs/artifacts (can be empty [])"),
  is_parallelizable: z.boolean().describe("Can run in parallel with other tasks?"),
  parallelizable_units: z
    .array(z.string())
    .optional()
    .describe("Array of task IDs that can run in parallel with this task"),
  references: z
    .array(z.string())
    .describe("Array of document IDs (can be empty [])"),
});
type AddArgs = z.infer<typeof addSchema>;

/**
 * AddHandler: Create a new task (root or subtask)
 */
export class AddHandler extends BaseActionHandler<AddArgs, PlanActionContext> {
  readonly action = "add";
  readonly schema = addSchema;

  readonly help = `# plan add

Add a new task to the plan.

## Usage
\`\`\`
plan(action: "add", id: "<task-id>", title: "<title>", content: "<description>", ...)
\`\`\`

## Parameters
- **id** (required): Unique task identifier
- **title** (required): Task title
- **content** (required): Task description/work content
- **parent** (optional): Parent task ID (empty for root tasks)
- **dependencies** (required): Array of dependent task IDs (can be empty [])
- **dependency_reason** (optional): Why this task depends on others (required if dependencies exist)
- **prerequisites** (required): What is needed before starting
- **completion_criteria** (required): What defines completion
- **deliverables** (required): Array of expected outputs/artifacts (can be empty [])
- **is_parallelizable** (required): Can run in parallel with other tasks?
- **parallelizable_units** (optional): Array of task IDs that can run in parallel with this task
- **references** (required): Array of document IDs (can be empty [])

## Notes
- When a task is started, 4 PDCA phase subtasks are automatically created
- PDCA phases: plan, do, check, act
`;

  protected async doExecute(args: AddArgs, context: PlanActionContext) {
    const {
      id,
      title,
      content,
      parent,
      dependencies,
      dependency_reason,
      prerequisites,
      completion_criteria,
      deliverables,
      is_parallelizable,
      parallelizable_units,
      references,
    } = args;
    const { planReader, planReporter } = context;

    // Validate dependency_reason is provided when there are dependencies
    if (dependencies.length > 0 && !dependency_reason) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: dependency_reason is required when dependencies are specified.
Please explain why this task depends on: ${dependencies.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    const result = await planReader.addTask({
      id,
      title,
      content,
      parent: parent || "",
      dependencies,
      dependency_reason: dependency_reason || "",
      prerequisites,
      completion_criteria,
      deliverables,
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

    // Update markdown files
    await planReporter.updateAll();

    const depsInfo =
      dependencies.length > 0 ? dependencies.join(", ") : "none";

    const delivsInfo =
      deliverables.length > 0 ? deliverables.join(", ") : "none";

    const parentInfo = parent ? `\nParent: ${parent}` : "";

    return {
      content: [
        {
          type: "text" as const,
          text: `Task "${id}" created.
Path: ${result.path}${parentInfo}
Dependencies: ${depsInfo}
Deliverables: ${delivsInfo}

**Next Step:** Start the task:
\`\`\`
plan(action: "start", id: "${id}", prompt: "<instructions>")
\`\`\``,
        },
      ],
    };
  }
}
