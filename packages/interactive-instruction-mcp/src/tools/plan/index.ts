import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { wrapResponse } from "../../utils/response-wrapper.js";
import type { ReminderConfig, PlanReporter, FeedbackReaderInterface, PlanActionContext, PlanRawParams, PlanActionHandler } from "../../types/index.js";
import type { PlanReader } from "../../services/plan-reader.js";
import {
  AddHandler,
  UpdateHandler,
  FeedbackHandler,
  ListHandler,
  ReadHandler,
  ReadOutputHandler,
  DeleteHandler,
  ClearHandler,
  GraphHandler,
  StartHandler,
  RequestChangesHandler,
  SkipHandler,
  BlockHandler,
  InterpretHandler,
  PlanSubmitHandler,
  DoSubmitHandler,
  CheckSubmitHandler,
  ActSubmitHandler,
} from "./handlers/index.js";

const handlers: PlanActionHandler[] = [
  new ListHandler(),
  new ReadHandler(),
  new ReadOutputHandler(),
  new AddHandler(),
  new UpdateHandler(),
  new DeleteHandler(),
  new FeedbackHandler(),
  new InterpretHandler(),
  new ClearHandler(),
  new GraphHandler(),
  new StartHandler(),
  new PlanSubmitHandler(),
  new DoSubmitHandler(),
  new CheckSubmitHandler(),
  new ActSubmitHandler(),
  new RequestChangesHandler(),
  new SkipHandler(),
  new BlockHandler(),
];

function resolveHandler(action: string): PlanActionHandler | undefined {
  return handlers.find((h) => h.action === action);
}

const getPlanHelp = (planDir: string) => `# Plan Tool

Task planning for current work session.

**Storage Path:** \`${planDir}\`

## Quick Start

1. **Create tasks**: \`plan(action: "add", ...)\`
2. **Start task**: \`plan(action: "start", id: "<id>", prompt: "...")\`
3. **Follow the guided workflow** (shown when task is started)

## Required Fields for Add

- **id**: Unique task identifier
- **title**: Human-readable task title
- **content**: Task description
- **parent**: Parent task ID (use "" for root tasks)
- **dependencies**: Array of task IDs (use [] for none)
- **dependency_reason**: Why depends (required if dependencies exist)
- **prerequisites**: What is needed before starting
- **completion_criteria**: What defines completion
- **deliverables**: Array of outputs (can be [])
- **is_parallelizable**: Can run in parallel?
- **references**: Array of doc IDs (can be [])

## Actions

- \`plan()\` - Show this help
- \`plan(action: "list")\` - List all tasks
- \`plan(action: "read", id: "<id>")\` - Read task detail
- \`plan(action: "add", ...)\` - Create new task
- \`plan(action: "start", id: "<id>", prompt: "...")\` - Start task
- \`plan(action: "update", id: "<id>", ...)\` - Update task
- \`plan(action: "delete", id: "<id>")\` - Delete task
- \`plan(action: "skip", id: "<id>", reason: "...")\` - Skip task
- \`plan(action: "graph")\` - Show dependency graph

## Example: Bug Fix

Create separate tasks for each phase:

\`\`\`
plan(action: "add",
  id: "fix-bug__research",
  title: "Investigate the bug",
  content: "Find root cause",
  dependencies: [], ...)

plan(action: "add",
  id: "fix-bug__implement",
  title: "Apply the fix",
  content: "Implement solution",
  dependencies: ["fix-bug__research"],
  dependency_reason: "Need to know cause before fixing", ...)

plan(action: "add",
  id: "fix-bug__test",
  title: "Verify the fix",
  content: "Test the solution",
  dependencies: ["fix-bug__implement"],
  dependency_reason: "Need fix before testing", ...)
\`\`\`

Then start each task in order:
\`\`\`
plan(action: "start", id: "fix-bug__research", prompt: "<instructions>")
\`\`\`

### When to decompose

Split into multiple tasks when work involves:
- Investigation/research before implementation
- Multiple distinct deliverables
- Verification that deserves its own cycle
- Work that could be reviewed incrementally`;

const TaskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "pending_review",
  "completed",
  "blocked",
  "skipped",
]);

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
          .enum([
            "list", "read", "read_output", "add", "update", "delete", "feedback", "interpret", "clear", "graph",
            // Dedicated state transitions (PDCA)
            "start", "submit_plan", "submit_do", "submit_check", "submit_act", "request_changes", "skip", "block"
          ])
          .optional()
          .describe("Action to perform. Omit to show help. State transitions: start (pending->in_progress), submit_* (in_progress->pending_review), request_changes (pending_review->in_progress), skip/block (any->skipped/blocked)"),
        id: z.string().optional().describe("Task ID"),
        force: z.boolean().optional().describe("Force cascade delete - deletes all dependent tasks (for delete action)"),
        cancel: z.boolean().optional().describe("Cancel a pending deletion (for delete action)"),
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
        output_what: z
          .string()
          .optional()
          .describe(
            "What was done (required for submit_review)"
          ),
        output_why: z
          .string()
          .optional()
          .describe(
            "Why this is sufficient (required for submit_review)"
          ),
        output_how: z
          .string()
          .optional()
          .describe(
            "How it was done/investigated (required for submit_review)"
          ),
        reason: z
          .string()
          .optional()
          .describe(
            "Reason for skip/block actions"
          ),
        is_parallelizable: z
          .boolean()
          .optional()
          .describe("Can this task run in parallel? (required for add)"),
        parallelizable_units: z
          .array(z.string())
          .optional()
          .describe("Array of task IDs that can run in parallel with this task"),
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
        // Common fields for all submit_* actions
        blockers: z
          .array(z.string())
          .optional()
          .describe("Encountered blockers (required for submit_*, can be empty [])"),
        risks: z
          .array(z.string())
          .optional()
          .describe("Risks and concerns (required for submit_*, can be empty [])"),
        // submit_plan specific
        findings: z
          .string()
          .optional()
          .describe("Research findings and discoveries (required for submit_plan)"),
        sources: z
          .array(z.string())
          .optional()
          .describe("Sources investigated - URLs, file paths, etc. (required for submit_plan)"),
        // submit_do specific
        design_decisions: z
          .string()
          .optional()
          .describe("Design decisions - why this implementation was chosen (required for submit_do)"),
        // submit_check specific
        test_target: z
          .string()
          .optional()
          .describe("Test target - what was tested (required for submit_check)"),
        test_results: z
          .string()
          .optional()
          .describe("Test results - success/failure details (required for submit_check)"),
        coverage: z
          .string()
          .optional()
          .describe("Coverage - how much was covered (required for submit_check)"),
        // submit_act specific
        feedback_addressed: z
          .string()
          .optional()
          .describe("What feedback was addressed (required for submit_act)"),
        // start action specific
        prompt: z
          .string()
          .optional()
          .describe("Instructions/request content (required for start action, saved to prompts/{task-id}.md)"),
      },
    },
    async ({
      action,
      id,
      force,
      cancel,
      title,
      content,
      parent,
      dependencies,
      dependency_reason,
      prerequisites,
      completion_criteria,
      deliverables,
      output,
      output_what,
      output_why,
      output_how,
      reason,
      is_parallelizable,
      parallelizable_units,
      references,
      status,
      comment,
      decision: _decision,
      changes,
      why,
      references_used,
      references_reason,
      feedback_id,
      interpretation,
      blockers,
      risks,
      findings,
      sources,
      design_decisions,
      test_target,
      test_results,
      coverage,
      feedback_addressed,
      prompt,
    }) => {
      if (!action) {
        return wrapResponse({
          result: {
            content: [{ type: "text" as const, text: getPlanHelp(planDir) }],
          },
          config,
        });
      }

      const context: PlanActionContext = { planReader, planReporter, feedbackReader, config, planDir };

      // Resolve handler by action name
      const handler = resolveHandler(action);
      if (!handler) {
        return wrapResponse({
          result: {
            content: [{ type: "text" as const, text: `Error: Unknown action "${action}"` }],
            isError: true,
          },
          config,
        });
      }

      // Pass all params - handler validates what it needs
      const rawParams: PlanRawParams = {
        id, force, cancel, title, content, parent, dependencies, dependency_reason,
        prerequisites, completion_criteria, deliverables, output,
        output_what, output_why, output_how, reason, is_parallelizable, parallelizable_units, references,
        status, comment, changes, why, references_used, references_reason,
        feedback_id, interpretation,
        blockers, risks, findings, sources, design_decisions,
        test_target, test_results, coverage, feedback_addressed, prompt,
      };

      const result = await handler.execute({ rawParams, context });
      return wrapResponse({ result, config });
    }
  );
}
