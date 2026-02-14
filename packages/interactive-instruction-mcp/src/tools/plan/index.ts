import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { wrapResponse } from "../../utils/response-wrapper.js";
import type { ReminderConfig, PlanActionHandler } from "../../types/index.js";
import type { PlanReader } from "../../services/plan-reader.js";
import {
  ListHandler,
  ReadHandler,
  AddHandler,
  UpdateHandler,
  DeleteHandler,
  StatusHandler,
  ClearHandler,
} from "./handlers/index.js";

const PLAN_HELP = `# Plan Tool

Manage task plans with DAG-based dependencies. Tasks are stored in tmp/ directory.

## IMPORTANT: Required Fields for Add

When creating a task, ALL fields are required to force careful planning:
- **id**: Unique task identifier
- **title**: Human-readable task title
- **content**: Detailed task description/work content
- **dependencies**: Array of task IDs this depends on (use [] for no dependencies)
- **dependency_reason**: Why this task depends on others (required if dependencies is not empty)
- **prerequisites**: What is needed before starting this task
- **completion_criteria**: What defines this task as complete
- **is_parallelizable**: Can this task run in parallel with others?
- **references**: Array of document IDs to reference (use [] for none)

## Task Statuses
- \`pending\`: Task not started (ready if no incomplete dependencies)
- \`in_progress\`: Currently working on
- \`completed\`: Task finished
- \`blocked\`: Waiting on dependencies (automatically calculated on list)
- \`skipped\`: Task skipped/not needed

## Actions

- \`plan()\` - Show this help
- \`plan(action: "list")\` - List all tasks with status and dependencies
- \`plan(action: "read", id: "<id>")\` - Read task detail
- \`plan(action: "add", id, title, content, dependencies, dependency_reason, prerequisites, completion_criteria, is_parallelizable, references)\` - Create new task
- \`plan(action: "update", id: "<id>", ...)\` - Update task fields
- \`plan(action: "delete", id: "<id>")\` - Delete task (fails if other tasks depend on it)
- \`plan(action: "status", id: "<id>", status: "<status>")\` - Change task status
- \`plan(action: "clear")\` - Clear all tasks (reset plan)

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
  is_parallelizable: true,
  references: ["api-design"])
\`\`\``;

const TaskStatusSchema = z.enum([
  "pending",
  "in_progress",
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
  clear: new ClearHandler(),
};

export function registerPlanTool(params: {
  server: McpServer;
  planReader: PlanReader;
  config: ReminderConfig;
}): void {
  const { server, planReader, config } = params;

  server.registerTool(
    "plan",
    {
      description:
        "Manage task plans with DAG-based dependencies. Create, track, and complete tasks with dependency management. All fields required when adding tasks to ensure thorough planning. Tasks stored in tmp/ directory.",
      inputSchema: {
        action: z
          .enum(["list", "read", "add", "update", "delete", "status", "clear"])
          .optional()
          .describe("Action to perform. Omit to show help."),
        id: z.string().optional().describe("Task ID"),
        title: z.string().optional().describe("Task title (required for add)"),
        content: z
          .string()
          .optional()
          .describe("Task description/work content (required for add)"),
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
      },
    },
    async ({
      action,
      id,
      title,
      content,
      dependencies,
      dependency_reason,
      prerequisites,
      completion_criteria,
      is_parallelizable,
      references,
      status,
    }) => {
      if (!action) {
        return wrapResponse({
          result: {
            content: [{ type: "text" as const, text: PLAN_HELP }],
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
          dependencies,
          dependency_reason,
          prerequisites,
          completion_criteria,
          is_parallelizable,
          references,
          status,
        },
        context: { planReader, config },
      });
      return wrapResponse({ result, config });
    }
  );
}
