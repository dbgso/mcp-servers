import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { wrapResponse } from "../../utils/response-wrapper.js";
import type { ReminderConfig, PlanReporter, ApproveActionHandler } from "../../types/index.js";
import type { PlanReader } from "../../services/plan-reader.js";
import type { FeedbackReader } from "../../services/feedback-reader.js";
import {
  TaskHandler,
  FeedbackHandler,
  DeletionHandler,
  SkipHandler,
  SetupTemplatesHandler,
  SkipTemplatesHandler,
} from "./handlers/index.js";

const APPROVE_HELP = `# Approve Tool

Human-only tool for approving AI work. AI should never call this tool.

## Actions

- \`approve(target: "task", task_id: "<id>")\` - Approve a pending_review task
- \`approve(target: "feedback", task_id: "<id>", feedback_id: "<id>")\` - Confirm feedback interpretation
- \`approve(target: "deletion", task_id: "<id>")\` - Approve cascade deletion
- \`approve(target: "skip", task_id: "<id>", reason: "...")\` - Skip a task with reason
- \`approve(target: "setup_templates")\` - Setup self-review templates
- \`approve(target: "skip_templates")\` - Skip template setup

## Approval Flow (with notifications)

Task approval and skip actions require a two-step approval process:

1. Call \`approve(target: "task", task_id: "...")\` - sends desktop notification
2. Copy token from notification or fallback file
3. Call \`approve(target: "task", task_id: "...", approvalToken: "<token>")\`

This ensures intentional human approval with notification.

## Workflow

1. AI completes work and submits for review (pending_review status)
2. Human reviews and calls \`approve(target: "task", task_id: "...")\`
3. System sends notification, human provides approvalToken
4. Task is marked as completed

## Feedback Flow

1. Human adds feedback via \`plan(action: "feedback", ...)\`
2. AI interprets via \`plan(action: "interpret", ...)\`
3. Human confirms via \`approve(target: "feedback", ...)\`
4. AI addresses the feedback`;

const targetHandlers: Record<string, ApproveActionHandler> = {
  task: new TaskHandler(),
  feedback: new FeedbackHandler(),
  deletion: new DeletionHandler(),
  skip: new SkipHandler(),
  setup_templates: new SetupTemplatesHandler(),
  skip_templates: new SkipTemplatesHandler(),
};

export function registerApproveTool(params: {
  server: McpServer;
  planReader: PlanReader;
  planReporter: PlanReporter;
  feedbackReader: FeedbackReader;
  markdownDir: string;
  planDir: string;
  config: ReminderConfig;
}): void {
  const { server, planReader, planReporter, feedbackReader, markdownDir, planDir, config } = params;

  server.registerTool(
    "approve",
    {
      description: `Approve tasks, feedback, deletions, or skip tasks. Human reviewers only. Use help() for details.`,
      inputSchema: {
        help: z
          .boolean()
          .optional()
          .describe("Show help"),
        target: z
          .enum(["task", "feedback", "deletion", "skip", "setup_templates", "skip_templates"])
          .optional()
          .describe("What to approve"),
        task_id: z.string().optional().describe("Task ID (required for task, feedback, deletion, skip)"),
        feedback_id: z
          .string()
          .optional()
          .describe("Feedback ID (required when target is 'feedback')"),
        reason: z
          .string()
          .optional()
          .describe("Reason for skipping (required when target is 'skip')"),
        approvalToken: z
          .string()
          .optional()
          .describe("Approval token from desktop notification (required for task/skip after initial request)"),
      },
    },
    async ({ help, target, task_id, feedback_id, reason, approvalToken }) => {
      // Show help when requested or no target provided
      if (help || !target) {
        return wrapResponse({
          result: {
            content: [{ type: "text" as const, text: APPROVE_HELP }],
          },
          config,
        });
      }

      const handler = targetHandlers[target];

      // Handle unknown target (should not happen due to zod enum validation)
      if (!handler) {
        return wrapResponse({
          result: {
            content: [
              {
                type: "text" as const,
                text: `Error: Invalid target "${target}". Use 'task', 'feedback', 'deletion', 'skip', 'setup_templates', or 'skip_templates'.`,
              },
            ],
            isError: true,
          },
          config,
        });
      }

      const result = await handler.execute({
        actionParams: { task_id, feedback_id, reason, approvalToken },
        context: { planReader, planReporter, feedbackReader, markdownDir, planDir, config },
      });

      return wrapResponse({ result, config });
    }
  );
}
