import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  requestApproval,
  validateApproval,
  resendApprovalNotification,
  getApprovalRequestedMessage,
  getApprovalRejectionMessage,
} from "mcp-shared";

export function registerStderrTestTool(params: {
  server: McpServer;
}): void {
  const { server } = params;

  server.registerTool(
    "stderr_test",
    {
      description: "Test desktop notification approval flow",
      inputSchema: {
        action: z
          .enum(["request", "confirm", "resend"])
          .optional()
          .describe("Action: request approval, confirm with token, or resend notification"),
        token: z
          .string()
          .optional()
          .describe("Approval token (required for confirm action)"),
      },
    },
    async ({ action, token }) => {
      const requestId = "stderr-test-001";

      // Default to request
      if (!action || action === "request") {
        const result = await requestApproval({
          request: {
            id: requestId,
            operation: "Test Operation",
            description: "Testing desktop notification approval",
          },
          options: { timeoutMs: 60_000 }, // 1 minute for testing
        });

        return {
          content: [
            {
              type: "text" as const,
              text: getApprovalRequestedMessage(result.fallbackPath),
            },
          ],
        };
      }

      // Confirm action
      if (action === "confirm") {
        const result = validateApproval({ requestId, providedToken: token });

        if (!result.valid) {
          return {
            content: [
              {
                type: "text" as const,
                text: `${getApprovalRejectionMessage()}\n\nReason: ${result.reason}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: "Approval confirmed! Operation would proceed.",
            },
          ],
        };
      }

      // Resend notification
      if (action === "resend") {
        const success = resendApprovalNotification(requestId);
        if (!success) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No pending approval found or it has expired. Use action: 'request' first.",
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: "Notification resent.",
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: "Unknown action" }],
        isError: true,
      };
    }
  );
}
