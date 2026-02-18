import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { wrapResponse } from "../../utils/response-wrapper.js";
import type { ReminderConfig, PlanReporter } from "../../types/index.js";
import type { PlanReader } from "../../services/plan-reader.js";
import type { FeedbackReader } from "../../services/feedback-reader.js";
import { setupSelfReviewTemplates } from "../../services/template-setup.js";

const PLAN_DIR_NAME = "_mcp-interactive-instruction/plan";

const APPROVE_HELP = `# Approve Tool

Human-only tool for approving AI work. AI should never call this tool.

## Actions

- \`approve(target: "task", task_id: "<id>")\` - Approve a pending_review task
- \`approve(target: "feedback", task_id: "<id>", feedback_id: "<id>")\` - Confirm feedback interpretation
- \`approve(target: "deletion", task_id: "<id>")\` - Approve cascade deletion
- \`approve(target: "skip", task_id: "<id>", reason: "...")\` - Skip a task with reason
- \`approve(target: "setup_templates")\` - Setup self-review templates
- \`approve(target: "skip_templates")\` - Skip template setup

## Workflow

1. AI completes work and submits for review (pending_review status)
2. Human reviews and calls \`approve(target: "task", task_id: "...")\`
3. Task is marked as completed

## Feedback Flow

1. Human adds feedback via \`plan(action: "feedback", ...)\`
2. AI interprets via \`plan(action: "interpret", ...)\`
3. Human confirms via \`approve(target: "feedback", ...)\`
4. AI addresses the feedback`;

async function approveTask(params: {
  planReader: PlanReader;
  planReporter: PlanReporter;
  taskId: string;
}): Promise<{ success: boolean; message: string }> {
  const { planReader, planReporter, taskId } = params;
  const task = await planReader.getTask(taskId);

  // Validate task exists
  if (!task) {
    return { success: false, message: `Error: Task "${taskId}" not found.` };
  }

  const result = await planReader.approveTask(taskId);

  // Handle approval failure
  if (!result.success) {
    return { success: false, message: `Error: ${result.error}` };
  }

  // Update markdown files
  await planReporter.updateAll();

  // Show newly ready tasks
  const readyTasks = await planReader.getReadyTasks();
  let additionalInfo = "";
  if (readyTasks.length > 0) {
    additionalInfo = `\n\nReady tasks: ${readyTasks.map((t) => t.id).join(", ")}`;
  }

  return {
    success: true,
    message: `Task "${taskId}" approved and marked as completed.\n\nOutput was: ${task.output}${additionalInfo}`,
  };
}

async function approveDeletion(params: {
  planReader: PlanReader;
  planReporter: PlanReporter;
  taskId: string;
}): Promise<{ success: boolean; message: string }> {
  const { planReader, planReporter, taskId } = params;

  const pending = await planReader.getPendingDeletion(taskId);
  if (!pending) {
    return { success: false, message: `Error: No pending deletion found for task "${taskId}".` };
  }

  const result = await planReader.executePendingDeletion(taskId);
  if (!result.success) {
    return { success: false, message: `Error: ${result.error}` };
  }

  await planReporter.updateAll();

  return {
    success: true,
    message: `Cascade deleted ${result.deleted?.length ?? 0} tasks:\n${result.deleted?.map(t => `- ${t}`).join("\n") ?? ""}`,
  };
}

async function setupTemplates(params: {
  markdownDir: string;
}): Promise<{ success: boolean; message: string }> {
  const { markdownDir } = params;

  try {
    const result = await setupSelfReviewTemplates(markdownDir);

    if (result.action === "already_exists") {
      return {
        success: true,
        message: `Self-review templates already exist at: ${result.path}`,
      };
    }

    if (result.action === "copied_templates") {
      return {
        success: true,
        message: `Self-review templates have been set up at: ${result.path}\n\nYou can now customize these templates to match your project's review workflow.`,
      };
    }

    // created_empty - this shouldn't happen when user explicitly calls setup_templates
    // but handle it gracefully
    return {
      success: true,
      message: `Created plan directory at: ${result.path}\n\nNote: Template files were not found in the package. Directory structure has been created.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Error setting up templates: ${message}` };
  }
}

async function skipTemplates(params: {
  markdownDir: string;
}): Promise<{ success: boolean; message: string }> {
  const { markdownDir } = params;
  const planDirPath = path.join(markdownDir, PLAN_DIR_NAME);

  try {
    await fs.mkdir(planDirPath, { recursive: true });

    return {
      success: true,
      message: `Created empty plan directory at: ${planDirPath}\n\nTemplate setup skipped. You can run \`approve(target: "setup_templates")\` later if you want to add templates.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Error creating directory: ${message}` };
  }
}

async function skipTask(params: {
  planReader: PlanReader;
  planReporter: PlanReporter;
  taskId: string;
  reason: string;
}): Promise<{ success: boolean; message: string }> {
  const { planReader, planReporter, taskId, reason } = params;

  const task = await planReader.getTask(taskId);
  if (!task) {
    return { success: false, message: `Error: Task "${taskId}" not found.` };
  }

  // Cannot skip completed tasks
  if (task.status === "completed") {
    return { success: false, message: `Error: Cannot skip a completed task.` };
  }

  const oldStatus = task.status;

  // Update status to skipped with reason as output
  const result = await planReader.updateStatus({
    id: taskId,
    status: "skipped",
    output: reason,
  });

  if (!result.success) {
    return { success: false, message: `Error: ${result.error}` };
  }

  // Update markdown files
  await planReporter.updateAll();

  return {
    success: true,
    message: `Task "${taskId}" skipped.\n\nStatus: ${oldStatus} → skipped\n\n**Reason:** ${reason}`,
  };
}

async function approveFeedback(params: {
  feedbackReader: FeedbackReader;
  planReporter: PlanReporter;
  taskId: string;
  feedbackId: string;
}): Promise<{ success: boolean; message: string }> {
  const { feedbackReader, planReporter, taskId, feedbackId } = params;

  const feedback = await feedbackReader.getFeedback(taskId, feedbackId);

  // Validate feedback exists
  if (!feedback) {
    return { success: false, message: `Error: Feedback "${feedbackId}" not found for task "${taskId}".` };
  }

  // Validate interpretation exists
  if (!feedback.interpretation) {
    return {
      success: false,
      message: `Error: Feedback "${feedbackId}" has no interpretation.\n\nAI must add interpretation first using:\nplan(action: "interpret", id: "${taskId}", feedback_id: "${feedbackId}", interpretation: "<detailed action items>")`,
    };
  }

  const result = await feedbackReader.confirmFeedback({ taskId, feedbackId });

  // Handle confirmation failure
  if (!result.success) {
    return { success: false, message: `Error: ${result.error}` };
  }

  // Update PENDING_REVIEW.md and GRAPH.md
  await planReporter.updateAll();

  return {
    success: true,
    message: `Feedback "${feedbackId}" confirmed for task "${taskId}".\n\n**Original:** ${feedback.original}\n\n**Interpretation:** ${feedback.interpretation}\n\nAI can now work on addressing this feedback.`,
  };
}

export function registerApproveTool(params: {
  server: McpServer;
  planReader: PlanReader;
  planReporter: PlanReporter;
  feedbackReader: FeedbackReader;
  markdownDir: string;
  config: ReminderConfig;
}): void {
  const { server, planReader, planReporter, feedbackReader, markdownDir, config } = params;

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
      },
    },
    async ({ help, target, task_id, feedback_id, reason }) => {
      // Show help when requested or no target provided
      if (help || !target) {
        return wrapResponse({
          result: {
            content: [{ type: "text" as const, text: APPROVE_HELP }],
          },
          config,
        });
      }

      // Handle template setup targets first (don't require task_id)
      if (target === "setup_templates") {
        const result = await setupTemplates({ markdownDir });
        return wrapResponse({
          result: {
            content: [{ type: "text" as const, text: result.message }],
            isError: !result.success,
          },
          config,
        });
      }

      if (target === "skip_templates") {
        const result = await skipTemplates({ markdownDir });
        return wrapResponse({
          result: {
            content: [{ type: "text" as const, text: result.message }],
            isError: !result.success,
          },
          config,
        });
      }

      // Validate task_id is provided for other targets
      if (!task_id) {
        return wrapResponse({
          result: {
            content: [
              {
                type: "text" as const,
                text: `Error: task_id is required for target "${target}".`,
              },
            ],
            isError: true,
          },
          config,
        });
      }

      // Handle task approval
      if (target === "task") {
        const result = await approveTask({ planReader, planReporter, taskId: task_id });
        return wrapResponse({
          result: {
            content: [{ type: "text" as const, text: result.message }],
            isError: !result.success,
          },
          config,
        });
      }

      // Handle feedback approval
      if (target === "feedback") {
        // Validate feedback_id for feedback target
        if (!feedback_id) {
          return wrapResponse({
            result: {
              content: [
                {
                  type: "text" as const,
                  text: `Error: feedback_id is required when target is 'feedback'.`,
                },
              ],
              isError: true,
            },
            config,
          });
        }

        const result = await approveFeedback({ feedbackReader, planReporter, taskId: task_id, feedbackId: feedback_id });
        return wrapResponse({
          result: {
            content: [{ type: "text" as const, text: result.message }],
            isError: !result.success,
          },
          config,
        });
      }

      // Handle deletion approval
      if (target === "deletion") {
        const result = await approveDeletion({ planReader, planReporter, taskId: task_id });
        return wrapResponse({
          result: {
            content: [{ type: "text" as const, text: result.message }],
            isError: !result.success,
          },
          config,
        });
      }

      // Handle skip
      if (target === "skip") {
        if (!reason) {
          return wrapResponse({
            result: {
              content: [
                {
                  type: "text" as const,
                  text: `Error: reason is required when target is 'skip'.`,
                },
              ],
              isError: true,
            },
            config,
          });
        }

        const result = await skipTask({ planReader, planReporter, taskId: task_id, reason });
        return wrapResponse({
          result: {
            content: [{ type: "text" as const, text: result.message }],
            isError: !result.success,
          },
          config,
        });
      }

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
  );
}
