import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { wrapResponse } from "../../utils/response-wrapper.js";
import type { ReminderConfig, PlanReporter } from "../../types/index.js";
import type { PlanReader } from "../../services/plan-reader.js";
import type { FeedbackReader } from "../../services/feedback-reader.js";

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

async function approveFeedback(params: {
  feedbackReader: FeedbackReader;
  taskId: string;
  feedbackId: string;
}): Promise<{ success: boolean; message: string }> {
  const { feedbackReader, taskId, feedbackId } = params;

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
  config: ReminderConfig;
}): void {
  const { server, planReader, planReporter, feedbackReader, config } = params;

  server.registerTool(
    "approve",
    {
      description: `Approve tasks, feedback, or deletions. This tool is for human reviewers only - agents should NOT use this tool.

**For tasks:**
\`approve(target: "task", task_id: "<id>")\` - Approve a pending_review task

**For feedback:**
\`approve(target: "feedback", task_id: "<id>", feedback_id: "<id>")\` - Confirm AI's interpretation is correct

**For deletions:**
\`approve(target: "deletion", task_id: "<id>")\` - Approve cascade deletion

To view feedback before approving, use:
\`plan(action: "feedback", id: "<task-id>", feedback_id: "<fb-id>")\``,
      inputSchema: {
        target: z
          .enum(["task", "feedback", "deletion"])
          .describe("What to approve: 'task' for pending_review tasks, 'feedback' for draft feedback, 'deletion' for cascade delete"),
        task_id: z.string().describe("Task ID"),
        feedback_id: z
          .string()
          .optional()
          .describe("Feedback ID (required when target is 'feedback')"),
      },
    },
    async ({ target, task_id, feedback_id }) => {
      // Validate task_id is provided
      if (!task_id) {
        return wrapResponse({
          result: {
            content: [
              {
                type: "text" as const,
                text: `Error: task_id is required.`,
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

        const result = await approveFeedback({ feedbackReader, taskId: task_id, feedbackId: feedback_id });
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

      return wrapResponse({
        result: {
          content: [
            {
              type: "text" as const,
              text: `Error: Invalid target "${target}". Use 'task', 'feedback', or 'deletion'.`,
            },
          ],
          isError: true,
        },
        config,
      });
    }
  );
}
