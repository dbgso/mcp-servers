import { z } from "zod";
import type { PlanActionContext, ToolResult, PlanRawParams } from "../../../types/index.js";

const SUBTASK_PHASES = [
  { suffix: "research", title: "事前調査", description: "調査・分析フェーズ" },
  { suffix: "implement", title: "設計・実装", description: "設計・実装フェーズ" },
  { suffix: "verify", title: "検証", description: "テスト・検証フェーズ" },
  { suffix: "fix", title: "FB修正", description: "フィードバック対応フェーズ" },
] as const;

const paramsSchema = z.object({
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
  references: z
    .array(z.string())
    .describe("Array of document IDs (can be empty [])"),
});

/**
 * AddHandler: Create a new task (root or subtask)
 */
export class AddHandler {
  readonly action = "add";

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
- **references** (required): Array of document IDs (can be empty [])

## Notes
- Root tasks (no parent) automatically get 4 phase subtasks created
- Subtasks must have content and completion_criteria filled in before starting
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
      parent,
      dependencies,
      dependency_reason,
      prerequisites,
      completion_criteria,
      deliverables,
      is_parallelizable,
      references,
    } = parseResult.data;
    const { planReader, planReporter } = params.context;

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

    // Check if this is a root task (no parent) - requires auto-subtasks
    const isRootTask = !parent;

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
      references,
    });

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    // Auto-create 4 phase subtasks for root tasks
    const createdSubtasks: string[] = [];
    if (isRootTask) {
      let prevSubtaskId: string | null = null;

      for (const phase of SUBTASK_PHASES) {
        const subtaskId = `${id}__${phase.suffix}`;
        const subtaskDeps = prevSubtaskId ? [prevSubtaskId] : [];
        const subtaskDepReason = prevSubtaskId
          ? `前フェーズ完了後に実行`
          : "";

        const subtaskResult = await planReader.addTask({
          id: subtaskId,
          title: `${phase.title}`,
          content: "", // Empty - must be filled before starting
          parent: id,
          dependencies: subtaskDeps,
          dependency_reason: subtaskDepReason,
          prerequisites: "",
          completion_criteria: "", // Empty - must be filled before starting
          deliverables: [],
          is_parallelizable: false,
          references: [],
        });

        if (subtaskResult.success) {
          createdSubtasks.push(subtaskId);
        }
        prevSubtaskId = subtaskId;
      }
    }

    // Update markdown files
    await planReporter.updateAll();

    const depsInfo =
      dependencies.length > 0 ? dependencies.join(", ") : "none";

    const delivsInfo =
      deliverables.length > 0 ? deliverables.join(", ") : "none";

    const parentInfo = parent ? `\nParent: ${parent}` : "";

    // Different message for root vs subtask
    if (isRootTask) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Task "${id}" created with 4 phase subtasks.
Path: ${result.path}
Dependencies: ${depsInfo}
Deliverables: ${delivsInfo}

## Subtasks Created (must be fleshed out before starting)
${createdSubtasks.map((s) => `- ${s}`).join("\n")}

**Next Step:** Update each subtask with content and completion_criteria:
\`\`\`
plan(action: "update", id: "${id}__research",
  content: "<what to investigate>",
  completion_criteria: "<how to know research is done>")
\`\`\``,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Subtask "${id}" created successfully.
Path: ${result.path}${parentInfo}
Dependencies: ${depsInfo}
Completion Criteria: ${completion_criteria || "(not set - update before starting)"}`,
        },
      ],
    };
  }
}
