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
  ResearchSubmitHandler,
  ImplementSubmitHandler,
  VerifySubmitHandler,
  FixSubmitHandler,
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
  new ResearchSubmitHandler(),
  new ImplementSubmitHandler(),
  new VerifySubmitHandler(),
  new FixSubmitHandler(),
  new RequestChangesHandler(),
  new SkipHandler(),
  new BlockHandler(),
];

function resolveHandler(action: string): PlanActionHandler | undefined {
  return handlers.find((h) => h.action === action);
}

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

Use dedicated state transition actions:

1. **Start work**: \`plan(action: "start", id: "<id>")\`
2. **Submit for review** (use phase-specific action):
   - Research: \`plan(action: "submit_research", id: "<id>__research", findings: "...", sources: [...])\`
   - Implement: \`plan(action: "submit_implement", id: "<id>__implement", changes: [...], design_decisions: "...")\`
   - Verify: \`plan(action: "submit_verify", id: "<id>__verify", test_target: "...", test_results: "...", coverage: "...")\`
   - Fix: \`plan(action: "submit_fix", id: "<id>__fix", changes: [...], feedback_addressed: "...")\`
3. **User approves**: \`approve(target: "task", id: "<id>")\` → Task becomes "completed"
4. **Or user requests changes**: \`plan(action: "request_changes", id: "<id>", comment: "<feedback>")\`

**Note:** The \`approve\` tool is separate and for human reviewers only. Do NOT call approve - wait for user approval.

## Task Statuses
- \`pending\`: Task not started (ready if no incomplete dependencies)
- \`in_progress\`: Currently working on
- \`pending_review\`: Work done, waiting for user approval
- \`completed\`: Task approved and finished
- \`blocked\`: Waiting on dependencies (automatically calculated on list)
- \`skipped\`: Task skipped/not needed

## Actions

### Basic Actions
- \`plan()\` - Show this help
- \`plan(action: "list")\` - List all tasks with status and dependencies
- \`plan(action: "read", id: "<id>")\` - Read task detail
- \`plan(action: "read_output", id: "<id>")\` - Read task output (what/why/how)
- \`plan(action: "add", ...)\` - Create new task (auto-creates 4 subtasks)
- \`plan(action: "update", id: "<id>", ...)\` - Update task fields
- \`plan(action: "delete", id: "<id>")\` - Delete task
- \`plan(action: "clear")\` - Clear all tasks
- \`plan(action: "graph")\` - Show dependency graph

### State Transitions (Recommended)
- \`plan(action: "start", id: "<id>")\` - Start task (pending → in_progress)
- \`plan(action: "submit_research", ...)\` - Submit research task for review
- \`plan(action: "submit_implement", ...)\` - Submit implementation task for review
- \`plan(action: "submit_verify", ...)\` - Submit verification task for review
- \`plan(action: "submit_fix", ...)\` - Submit fix task for review
- \`plan(action: "request_changes", id: "<id>", comment: "<feedback>")\` - Request changes (pending_review → in_progress)
- \`plan(action: "skip", id: "<id>", reason: "<why>")\` - Skip task (any → skipped)
- \`plan(action: "block", id: "<id>", reason: "<why>")\` - Block task (any → blocked)

### Common Fields for All submit_* Actions
- \`output_what\`: 何をしたのか (What was done)
- \`output_why\`: なぜこれで十分なのか (Why this is sufficient)
- \`output_how\`: どうやって調べた/実装したのか (How it was done)
- \`blockers\`: 遭遇した障害 (Array, can be empty)
- \`risks\`: リスク・懸念事項 (Array, can be empty)
- \`references_used\`: Array of doc IDs (required, must include prompts/<task-id>)
- \`references_reason\`: Why referenced or why not needed

### Phase-Specific Required Fields
- **submit_research**: \`findings\`, \`sources\`
- **submit_implement**: \`changes\`, \`design_decisions\`
- **submit_verify**: \`test_target\`, \`test_results\`, \`coverage\`
- **submit_fix**: \`changes\`, \`feedback_addressed\`

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
            // Dedicated state transitions
            "start", "submit_research", "submit_implement", "submit_verify", "submit_fix", "request_changes", "skip", "block"
          ])
          .optional()
          .describe("Action to perform. Omit to show help. State transitions: start (pending→in_progress), submit_* (in_progress→pending_review), request_changes (pending_review→in_progress), skip/block (any→skipped/blocked)"),
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
        output_content: z
          .string()
          .optional()
          .describe(
            "Deliverables/results content for the task (deprecated: use output_what/output_why/output_how instead)"
          ),
        output_what: z
          .string()
          .optional()
          .describe(
            "何をしたのか - What was done (required for submit_review)"
          ),
        output_why: z
          .string()
          .optional()
          .describe(
            "なぜこれで十分なのか - Why this is sufficient (required for submit_review)"
          ),
        output_how: z
          .string()
          .optional()
          .describe(
            "どうやって調べた/実装したのか - How it was done/investigated (required for submit_review)"
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
          .describe("遭遇した障害・ブロッカー (required for submit_*, can be empty [])"),
        risks: z
          .array(z.string())
          .optional()
          .describe("リスク・懸念事項 (required for submit_*, can be empty [])"),
        // submit_research specific
        findings: z
          .string()
          .optional()
          .describe("調査結果・発見事項 (required for submit_research)"),
        sources: z
          .array(z.string())
          .optional()
          .describe("調査したソース - URL、ファイルパスなど (required for submit_research)"),
        // submit_implement specific
        design_decisions: z
          .string()
          .optional()
          .describe("設計判断・なぜこの実装を選んだか (required for submit_implement)"),
        // submit_verify specific
        test_target: z
          .string()
          .optional()
          .describe("テスト対象・何をテストしたか (required for submit_verify)"),
        test_results: z
          .string()
          .optional()
          .describe("テスト結果・成功/失敗の詳細 (required for submit_verify)"),
        coverage: z
          .string()
          .optional()
          .describe("網羅性・どの程度カバーしたか (required for submit_verify)"),
        // submit_fix specific
        feedback_addressed: z
          .string()
          .optional()
          .describe("対応したフィードバックの内容 (required for submit_fix)"),
        // start action specific
        prompt: z
          .string()
          .optional()
          .describe("依頼内容・指示 (required for start action, saved to prompts/{task-id}.md)"),
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
      output_content,
      output_what,
      output_why,
      output_how,
      reason,
      is_parallelizable,
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
        id, title, content, parent, dependencies, dependency_reason,
        prerequisites, completion_criteria, deliverables, output, output_content,
        output_what, output_why, output_how, reason, is_parallelizable, references,
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
