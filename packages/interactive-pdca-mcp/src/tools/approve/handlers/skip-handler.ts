import {
  requestApproval,
  validateApproval,
} from "mcp-shared";
import type {
  ToolResult,
  ApproveActionHandler,
  ApproveActionParams,
  ApproveActionContext,
} from "../../../types/index.js";

export class SkipHandler implements ApproveActionHandler {
  async execute(params: {
    actionParams: ApproveActionParams;
    context: ApproveActionContext;
  }): Promise<ToolResult> {
    const { task_id, reason, approvalToken } = params.actionParams;
    const { planReader, planReporter } = params.context;

    // Validate task_id is provided
    if (!task_id) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: task_id is required for target "skip".`,
          },
        ],
        isError: true,
      };
    }

    // Validate reason is provided
    if (!reason) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: reason is required when target is 'skip'.`,
          },
        ],
        isError: true,
      };
    }

    const task = await planReader.getTask(task_id);
    if (!task) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Task "${task_id}" not found.`,
          },
        ],
        isError: true,
      };
    }

    // Cannot skip completed tasks
    if (task.status === "completed") {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Cannot skip a completed task.`,
          },
        ],
        isError: true,
      };
    }

    // Handle approval flow (skip in test environment)
    const isTestEnv = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
    const approvalRequestId = `pdca-skip-${task_id}`;

    if (!isTestEnv && !approvalToken) {
      // Request approval - send notification
      const { fallbackPath } = await requestApproval({
        request: {
          id: approvalRequestId,
          operation: "Skip Task",
          description: `Skip task "${task_id}" (${task.title})\nReason: ${reason}`,
        },
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `# Approval Requested

A desktop notification has been sent with the approval token.

If you missed the notification, check: ${fallbackPath}

To skip, call:
\`approve(target: "skip", task_id: "${task_id}", reason: "${reason}", approvalToken: "<token>")\``,
          },
        ],
      };
    }

    // Validate approval token (skip in test environment)
    if (!isTestEnv && approvalToken) {
      const approvalResult = validateApproval({
        requestId: approvalRequestId,
        providedToken: approvalToken,
      });

      if (!approvalResult.valid) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Invalid approval token - ${approvalResult.reason}`,
            },
          ],
          isError: true,
        };
      }
    }

    const oldStatus = task.status;

    // Update status to skipped with reason as output
    const result = await planReader.updateStatus({
      id: task_id,
      status: "skipped",
      output: reason,
    });

    if (!result.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${result.error}`,
          },
        ],
        isError: true,
      };
    }

    // Update markdown files
    await planReporter.updateAll();

    return {
      content: [
        {
          type: "text" as const,
          text: `Task "${task_id}" skipped.\n\nStatus: ${oldStatus} → skipped\n\n**Reason:** ${reason}`,
        },
      ],
    };
  }
}
