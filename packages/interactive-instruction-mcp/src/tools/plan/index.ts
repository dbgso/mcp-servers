import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { wrapResponse } from "../../utils/response-wrapper.js";
import type { ReminderConfig, PlanActionHandler, PlanReporter, FeedbackReaderInterface } from "../../types/index.js";
import type { PlanReader } from "../../services/plan-reader.js";
import {
  ListHandler,
  ReadHandler,
  AddHandler,
  UpdateHandler,
  DeleteHandler,
  StatusHandler,
  FeedbackHandler,
  InterpretHandler,
  ClearHandler,
  GraphHandler,
} from "./handlers/index.js";

const getPlanHelp = (planDir: string) => `# Plan Tool

Temporary task planning for current work session. Tasks are stored in OS temp directory.

**Storage Path:** \`${planDir}\`

## IMPORTANT: Required Fields for Add

When creating a task, ALL fields are required to force careful planning:
- **id**: Unique task identifier
- **title**: Human-readable task title
- **content**: Detailed task description/work content
- **parent**: Parent task ID for subtasks (use "" for root tasks)
- **dependencies**: Array of task IDs this depends on (use [] for no dependencies)
- **dependency_reason**: Why this task depends on others (required if dependencies is not empty)
- **prerequisites**: What is needed before starting this task
- **completion_criteria**: What defines this task as complete
- **deliverables**: Array of expected outputs/artifacts (e.g., ["design doc", "test results"])
- **is_parallelizable**: Can this task run in parallel with others?
- **references**: Array of document IDs to reference (use [] for none). Run \`help()\` to list available documents.

## Subtasks (Parent-Child)

Use \`parent\` to create subtasks. Parent task cannot be completed until all subtasks are done.

Example: Break down "implement-feature" into verification steps:
\`\`\`
plan(action: "add", id: "impl-code", parent: "implement-feature", ...)
plan(action: "add", id: "build-check", parent: "implement-feature", ...)
plan(action: "add", id: "test-run", parent: "implement-feature", ...)
\`\`\`
Now "implement-feature" cannot be approved until impl-code, build-check, and test-run are all completed.

## IMPORTANT: Review Workflow

When marking a task as \`completed\`, it automatically becomes \`pending_review\`:
1. You set status to "completed" with output → Task becomes "pending_review"
2. User reviews the output and uses the separate \`approve\` tool → Task becomes "completed"

**Note:** The \`approve\` tool is separate and for human reviewers only. Do NOT look for or call approve - wait for user approval.

## Task Statuses
- \`pending\`: Task not started (ready if no incomplete dependencies)
- \`in_progress\`: Currently working on
- \`pending_review\`: Work done, waiting for user approval
- \`completed\`: Task approved and finished
- \`blocked\`: Waiting on dependencies (automatically calculated on list)
- \`skipped\`: Task skipped/not needed

## Actions

- \`plan()\` - Show this help
- \`plan(action: "list")\` - List all tasks with status and dependencies
- \`plan(action: "read", id: "<id>")\` - Read task detail
- \`plan(action: "add", id, title, content, dependencies, dependency_reason, prerequisites, completion_criteria, is_parallelizable, references)\` - Create new task
- \`plan(action: "update", id: "<id>", ...)\` - Update task fields
- \`plan(action: "delete", id: "<id>")\` - Delete task (fails if other tasks depend on it)
- \`plan(action: "status", id: "<id>", status: "completed", output: "<result>")\` - Mark task done (becomes pending_review)
- \`plan(action: "clear")\` - Clear all tasks (reset plan)
- \`plan(action: "graph")\` - Show task dependency graph (Mermaid format)
- \`plan(action: "feedback", id: "<id>", comment: "<feedback>", decision: "adopted" | "rejected")\` - Record user feedback

## Example

\`\`\`
plan(action: "add",
  id: "setup-project",
  title: "Set up project structure",
  content: "Create directories and initial files for the new feature",
  dependencies: [],
  dependency_reason: "",
  prerequisites: "Node.js 18+ installed, pnpm available",
  completion_criteria: "pnpm install succeeds and pnpm build passes",
  deliverables: ["package.json", "tsconfig.json", "src/ directory"],
  is_parallelizable: false,
  references: ["coding-style", "project-setup"])
\`\`\`

\`\`\`
plan(action: "add",
  id: "implement-api",
  title: "Implement API endpoints",
  content: "Create REST endpoints for user management",
  dependencies: ["setup-project"],
  dependency_reason: "Project structure must exist before adding API code",
  prerequisites: "Database schema defined",
  completion_criteria: "All endpoints return correct responses, tests pass",
  deliverables: ["API endpoints", "integration tests", "API documentation"],
  is_parallelizable: true,
  references: ["api-design"])
\`\`\`

## Tips

1. **Before planning**: Run \`help()\` to see available documents for references
2. **References**: Link to coding rules, design docs, specs (e.g., "coding-rules/typescript")
3. **Parallelizable**: Mark tasks that don't share state and can run concurrently`;

const TaskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "pending_review",
  "completed",
  "blocked",
  "skipped",
]);

const actionHandlers: Record<string, PlanActionHandler> = {
  list: new ListHandler(),
  read: new ReadHandler(),
  add: new AddHandler(),
  update: new UpdateHandler(),
  delete: new DeleteHandler(),
  status: new StatusHandler(),
  feedback: new FeedbackHandler(),
  interpret: new InterpretHandler(),
  clear: new ClearHandler(),
  graph: new GraphHandler(),
};

export function registerPlanTool(params: {
  server: McpServer;
  planReader: PlanReader;
  planReporter: PlanReporter;
  feedbackReader: FeedbackReaderInterface;
  planDir: string;
  config: ReminderConfig;
}): void {
  const { server, planReader, planReporter, feedbackReader, planDir, config } = params;

  server.registerTool(
    "plan",
    {
      description:
        "Temporary task planning for current work session. Plan, track, and complete tasks with mandatory review workflow. Supports parent-child relationships for enforcing verification steps. Tasks are stored in OS temp directory and should be cleared when done.",
      inputSchema: {
        action: z
          .enum(["list", "read", "add", "update", "delete", "status", "feedback", "interpret", "clear", "graph"])
          .optional()
          .describe("Action to perform. Omit to show help."),
        id: z.string().optional().describe("Task ID"),
        title: z.string().optional().describe("Task title (required for add)"),
        content: z
          .string()
          .optional()
          .describe("Task description/work content (required for add)"),
        parent: z
          .string()
          .optional()
          .describe("Parent task ID for subtasks (use empty string for root tasks)"),
        dependencies: z
          .array(z.string())
          .optional()
          .describe(
            "Array of task IDs this depends on (required for add, can be empty [])"
          ),
        dependency_reason: z
          .string()
          .optional()
          .describe(
            "Why this task depends on others (required if dependencies is not empty)"
          ),
        prerequisites: z
          .string()
          .optional()
          .describe("What is needed before starting (required for add)"),
        completion_criteria: z
          .string()
          .optional()
          .describe("What defines completion (required for add)"),
        deliverables: z
          .array(z.string())
          .optional()
          .describe(
            "Array of expected outputs/artifacts (required for add, can be empty [])"
          ),
        output: z
          .string()
          .optional()
          .describe(
            "Summary of what was accomplished (required when status is 'completed')"
          ),
        is_parallelizable: z
          .boolean()
          .optional()
          .describe("Can this task run in parallel? (required for add)"),
        references: z
          .array(z.string())
          .optional()
          .describe(
            "Array of document IDs to reference (required for add, can be empty [])"
          ),
        status: TaskStatusSchema.optional().describe(
          "Task status for status action"
        ),
        comment: z
          .string()
          .optional()
          .describe("Feedback comment (required for feedback action)"),
        decision: z
          .enum(["adopted", "rejected"])
          .optional()
          .describe(
            "Feedback decision: adopted (will be applied) or rejected (will not be applied)"
          ),
        changes: z
          .array(
            z.object({
              file: z.string().describe("File path"),
              lines: z.string().describe("Line numbers (e.g., '1-50')"),
              description: z.string().describe("What was changed"),
            })
          )
          .optional()
          .describe(
            "Array of file changes (required when status is 'completed')"
          ),
        why: z
          .string()
          .optional()
          .describe(
            "Explanation of how implementation satisfies completion criteria (required when status is 'completed')"
          ),
        references_used: z
          .array(z.string())
          .nullable()
          .optional()
          .describe(
            "Document IDs referenced during implementation, or null if none (required when status is 'completed')"
          ),
        references_reason: z
          .string()
          .optional()
          .describe(
            "Why these references were used, or why none were needed (required when status is 'completed')"
          ),
        feedback_id: z
          .string()
          .optional()
          .describe("Feedback ID (required for interpret action)"),
        interpretation: z
          .string()
          .optional()
          .describe(
            "AI's detailed interpretation of feedback - action items to address it (required for interpret action)"
          ),
      },
    },
    async ({
      action,
      id,
      title,
      content,
      parent,
      dependencies,
      dependency_reason,
      prerequisites,
      completion_criteria,
      deliverables,
      output,
      is_parallelizable,
      references,
      status,
      comment,
      decision,
      changes,
      why,
      references_used,
      references_reason,
      feedback_id,
      interpretation,
    }) => {
      if (!action) {
        return wrapResponse({
          result: {
            content: [{ type: "text" as const, text: getPlanHelp(planDir) }],
          },
          config,
        });
      }

      const handler = actionHandlers[action];
      if (!handler) {
        return wrapResponse({
          result: {
            content: [
              {
                type: "text" as const,
                text: `Error: Unknown action "${action}"`,
              },
            ],
            isError: true,
          },
          config,
        });
      }

      const result = await handler.execute({
        actionParams: {
          id,
          title,
          content,
          parent,
          dependencies,
          dependency_reason,
          prerequisites,
          completion_criteria,
          deliverables,
          output,
          is_parallelizable,
          references,
          status,
          comment,
          decision,
          changes,
          why,
          references_used,
          references_reason,
          feedback_id,
          interpretation,
        },
        context: { planReader, planReporter, feedbackReader, config },
      });
      return wrapResponse({ result, config });
    }
  );
}
