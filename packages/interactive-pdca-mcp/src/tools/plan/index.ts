import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { wrapResponse } from "../../utils/response-wrapper.js";
import type { ReminderConfig, PlanReporter, FeedbackReaderInterface, PlanActionContext, PlanRawParams, PlanActionHandler } from "../../types/index.js";
import type { PlanReader } from "../../services/plan-reader.js";
import { needsTemplateSetup } from "../../services/template-setup.js";
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
  ConfirmHandler,
  RequestChangesHandler,
  BlockHandler,
  InterpretHandler,
  PlanSubmitHandler,
  DoSubmitHandler,
  CheckSubmitHandler,
  ActSubmitHandler,
} from "./handlers/index.js";

function createHandlers(): PlanActionHandler[] {
  return [
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
    new ConfirmHandler(),
    new PlanSubmitHandler(),
    new DoSubmitHandler(),
    new CheckSubmitHandler(),
    new ActSubmitHandler(),
    new RequestChangesHandler(),
    new BlockHandler(),
  ];
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
- \`approve(target: "skip", task_id: "<id>", reason: "...")\` - Skip task (requires approval)
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
- Work that could be reviewed incrementally

## PDCA Subtasks (Auto-Generated)

When you start a task with \`plan(action: "start", ...)\`, PDCA subtasks are **automatically created**:

- \`<task-id>__plan\` - Research & planning
- \`<task-id>__do\` - Implementation
- \`<task-id>__check\` - Verification
- \`<task-id>__act\` - Feedback & improvements

Each phase has specific submit actions:
- \`submit_plan\` - Submit research findings
- \`submit_do\` - Submit implementation
- \`submit_check\` - Submit verification results
- \`submit_act\` - Submit feedback response

### Nested Task Structure

For complex work, create nested tasks that each follow the PDCA cycle:

\`\`\`
fix-xxx                          # Parent task
├── fix-xxx__investigation       # Subtask 1 (when started, gets PDCA phases)
│   ├── fix-xxx__investigation__plan
│   ├── fix-xxx__investigation__do
│   ├── fix-xxx__investigation__check
│   └── fix-xxx__investigation__act
├── fix-xxx__implementation      # Subtask 2 (when started, gets PDCA phases)
│   ├── fix-xxx__implementation__plan
│   ├── fix-xxx__implementation__do
│   ├── fix-xxx__implementation__check
│   └── fix-xxx__implementation__act
└── fix-xxx__testing             # Subtask 3 (when started, gets PDCA phases)
    ├── fix-xxx__testing__plan
    ├── fix-xxx__testing__do
    ├── fix-xxx__testing__check
    └── fix-xxx__testing__act
\`\`\`

**The PDCA phases are universal** - they apply to any type of task:
- Investigation tasks: Plan what to look for, Do the research, Check findings, Act on insights
- Implementation tasks: Plan approach, Do coding, Check it works, Act on feedback
- Testing tasks: Plan test cases, Do testing, Check coverage, Act on failures`;

const TaskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "self_review",
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
  markdownDir: string;
  config: ReminderConfig;
}): void {
  const { server, planReader, planReporter, feedbackReader, planDir, markdownDir, config } = params;

  const handlers = createHandlers();
  const resolveHandler = (action: string): PlanActionHandler | undefined => {
    return handlers.find((h) => h.action === action);
  };

  server.registerTool(
    "plan",
    {
      description:
        "Task planning with PDCA workflow. Use help() for details.",
      inputSchema: {
        help: z
          .boolean()
          .optional()
          .describe("Show help"),
        action: z
          .enum([
            "list", "read", "read_output", "add", "update", "delete", "feedback", "interpret", "clear", "graph",
            // Dedicated state transitions (PDCA)
            "start", "submit_plan", "submit_do", "submit_check", "submit_act", "confirm", "request_changes", "block",
          ])
          .optional()
          .describe("Action to perform. Omit to show help."),
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
            "Reason for block action"
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
        self_review_ref: z
          .string()
          .optional()
          .describe("Self-review help ID that was read (required for submit_*, e.g., '_mcp-interactive-instruction__plan__self-review__do')"),
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
      help,
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
      self_review_ref,
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
      if (help || !action) {
        // Check if template setup is needed
        let templateSetupPrompt = "";
        try {
          const needsSetup = await needsTemplateSetup(markdownDir);
          if (needsSetup) {
            templateSetupPrompt = `

---

## Template Setup Available

Self-review templates are available for this project. Would you like to set them up?

- **Yes**: Run \`approve(target: "setup_templates")\` to copy templates
- **No**: Run \`approve(target: "skip_templates")\` to skip and create empty directory`;
          }
        } catch {
          // Ignore errors checking for template setup
        }

        return wrapResponse({
          result: {
            content: [{ type: "text" as const, text: getPlanHelp(planDir) + templateSetupPrompt }],
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
        self_review_ref, blockers, risks, findings, sources, design_decisions,
        test_target, test_results, coverage, feedback_addressed, prompt,
      };

      const result = await handler.execute({ rawParams, context });
      return wrapResponse({ result, config });
    }
  );
}
