import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateApproval, clearApproval } from "mcp-shared";
import { z } from "zod";
import type { PendingStore } from "../pending-store.js";
import type { ProxyClient } from "../proxy-client.js";
import type { RuleEngine } from "../rule-engine.js";
import type { RuleStore } from "../rule-store.js";
import { ConditionSchema, RuleActionSchema } from "../types.js";

export interface RegisterRuleToolsParams {
  server: McpServer;
  ruleStore: RuleStore;
  ruleEngine: RuleEngine;
  proxyClient: ProxyClient;
  pendingStore: PendingStore;
  dryRun?: boolean;
}

export function registerRuleTools(params: RegisterRuleToolsParams): void {
  const { server, ruleStore, ruleEngine, proxyClient, pendingStore, dryRun = false } = params;

  // proxy_rule_list
  server.registerTool(
    "proxy_rule_list",
    {
      description: "List all filtering rules",
      inputSchema: z.object({}),
    },
    async () => {
      const rules = ruleStore.getRules();
      const defaultAction = ruleStore.getDefaultAction();

      const output = {
        defaultAction,
        rulesCount: rules.length,
        rules: rules.map((r) => ({
          id: r.id,
          priority: r.priority,
          action: r.action,
          toolPattern: r.toolPattern,
          conditions: r.conditions,
          description: r.description,
        })),
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(output, null, 2),
          },
        ],
      };
    }
  );

  // proxy_rule_add
  server.registerTool(
    "proxy_rule_add",
    {
      description: "Add a new filtering rule",
      inputSchema: z.object({
        priority: z.number().default(0).describe("Rule priority (higher = evaluated first)"),
        action: RuleActionSchema.describe("Action to take: allow or deny"),
        toolPattern: z.string().describe("Tool name pattern (glob: browser_*, *)"),
        conditions: z.array(ConditionSchema).optional().describe("Parameter conditions (AND)"),
        description: z.string().optional().describe("Human-readable description"),
      }),
    },
    async (args) => {
      const rule = await ruleStore.addRule({
        priority: args.priority,
        action: args.action,
        toolPattern: args.toolPattern,
        conditions: args.conditions,
        description: args.description,
      });

      return {
        content: [
          {
            type: "text",
            text: `Rule created:\n${JSON.stringify(rule, null, 2)}`,
          },
        ],
      };
    }
  );

  // proxy_rule_remove
  server.registerTool(
    "proxy_rule_remove",
    {
      description: "Remove a filtering rule by ID",
      inputSchema: z.object({
        id: z.string().describe("Rule ID to remove"),
      }),
    },
    async (args) => {
      const removed = await ruleStore.removeRule(args.id);

      if (!removed) {
        return {
          content: [
            {
              type: "text",
              text: `Rule not found: ${args.id}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Rule removed: ${args.id}`,
          },
        ],
      };
    }
  );

  // proxy_rule_update
  server.registerTool(
    "proxy_rule_update",
    {
      description: "Update an existing filtering rule",
      inputSchema: z.object({
        id: z.string().describe("Rule ID to update"),
        priority: z.number().optional().describe("New priority"),
        action: RuleActionSchema.optional().describe("New action"),
        toolPattern: z.string().optional().describe("New tool pattern"),
        conditions: z.array(ConditionSchema).optional().describe("New conditions"),
        description: z.string().optional().describe("New description"),
      }),
    },
    async (args) => {
      const { id, ...updates } = args;
      const rule = await ruleStore.updateRule(id, updates);

      if (!rule) {
        return {
          content: [
            {
              type: "text",
              text: `Rule not found: ${id}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Rule updated:\n${JSON.stringify(rule, null, 2)}`,
          },
        ],
      };
    }
  );

  // proxy_rule_test
  server.registerTool(
    "proxy_rule_test",
    {
      description: "Test how a tool call would be evaluated",
      inputSchema: z.object({
        toolName: z.string().describe("Tool name to test"),
        args: z.record(z.unknown()).optional().describe("Tool arguments"),
      }),
    },
    async (testArgs) => {
      const args = (testArgs.args as Record<string, unknown>) ?? {};
      const { finalAction, evaluatedRules } = ruleEngine.evaluateAll(
        testArgs.toolName,
        args
      );

      // Build detailed output
      const output = {
        result: {
          action: finalAction.action,
          reason: finalAction.reason,
          matchedRule: finalAction.matchedRule
            ? {
                id: finalAction.matchedRule.id,
                priority: finalAction.matchedRule.priority,
                description: finalAction.matchedRule.description,
              }
            : null,
        },
        evaluationDetails: evaluatedRules.map((er) => ({
          order: er.order,
          ruleId: er.rule.id,
          priority: er.rule.priority,
          action: er.rule.action,
          toolPattern: er.rule.toolPattern,
          patternMatch: er.patternMatch,
          matches: er.matches,
          wouldApply: er.wouldApply,
          conditions: er.conditionResults.length > 0
            ? er.conditionResults.map((cr) => ({
                param: cr.condition.param,
                operator: cr.condition.operator,
                expected: cr.condition.value,
                actual: cr.actualValue,
                matches: cr.matches,
              }))
            : undefined,
        })),
        summary: {
          totalRules: evaluatedRules.length,
          matchingRules: evaluatedRules.filter((r) => r.matches).length,
          appliedRule: evaluatedRules.find((r) => r.wouldApply)?.rule.id ?? "(default action)",
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(output, null, 2),
          },
        ],
      };
    }
  );

  // proxy_status
  server.registerTool(
    "proxy_status",
    {
      description: "Get proxy status and target MCP info",
      inputSchema: z.object({}),
    },
    async () => {
      const targetConfig = proxyClient.getConfig();
      const targetTools = proxyClient.getCachedTools();

      const status = {
        connected: proxyClient.isConnected(),
        dryRun,
        targetPid: proxyClient.getPid(),
        target: {
          command: targetConfig.command,
          args: targetConfig.args,
        },
        rulesFile: ruleStore.getFilePath(),
        rulesCount: ruleStore.count(),
        defaultAction: ruleStore.getDefaultAction(),
        proxiedToolsCount: targetTools?.length ?? 0,
        pendingCount: pendingStore.count(),
        pendingTtlMs: pendingStore.getTtlMs(),
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    }
  );

  // proxy_set_default
  server.registerTool(
    "proxy_set_default",
    {
      description: "Set the default action when no rule matches",
      inputSchema: z.object({
        action: RuleActionSchema.describe("Default action: allow, deny, or ask"),
      }),
    },
    async (args) => {
      await ruleStore.setDefaultAction(args.action);

      return {
        content: [
          {
            type: "text",
            text: `Default action set to: ${args.action}`,
          },
        ],
      };
    }
  );

  // proxy_pending
  server.registerTool(
    "proxy_pending",
    {
      description: "List pending tool calls awaiting approval",
      inputSchema: z.object({}),
    },
    async () => {
      const pending = pendingStore.list();
      const now = Date.now();

      const output = {
        count: pending.length,
        ttlMs: pendingStore.getTtlMs(),
        pending: pending.map((p) => {
          const remainingMs = p.expiresAt - now;
          const remainingSec = Math.ceil(remainingMs / 1000);
          return {
            id: p.id,
            toolName: p.toolName,
            args: p.args,
            rule: p.matchedRule.description ?? p.matchedRule.id,
            createdAt: new Date(p.createdAt).toISOString(),
            expiresAt: new Date(p.expiresAt).toISOString(),
            remainingSec,
          };
        }),
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(output, null, 2),
          },
        ],
      };
    }
  );

  // proxy_approve
  server.registerTool(
    "proxy_approve",
    {
      description: "Approve a pending tool call with the approval token",
      inputSchema: z.object({
        requestId: z.string().describe("The pending request ID"),
        approvalToken: z.string().describe("The approval token from the notification"),
      }),
    },
    async (args) => {
      const { requestId, approvalToken } = args;

      // Validate the approval token
      const validationResult = validateApproval({
        requestId,
        providedToken: approvalToken,
      });

      if (!validationResult.valid) {
        const reasonMessages: Record<string, string> = {
          missing_token: "No approval token provided",
          invalid_token: "Invalid approval token",
          expired: "Approval request has expired",
          not_found: "Approval request not found",
        };
        return {
          content: [
            {
              type: "text",
              text: `[APPROVAL FAILED] ${reasonMessages[validationResult.reason ?? "not_found"]}`,
            },
          ],
          isError: true,
        };
      }

      // Get the pending tool call
      const pending = pendingStore.get(requestId);
      if (!pending) {
        return {
          content: [
            {
              type: "text",
              text: `[ERROR] Pending request not found: ${requestId}`,
            },
          ],
          isError: true,
        };
      }

      // Remove from pending store
      pendingStore.remove(requestId);

      // Execute the original tool call
      try {
        const result = await proxyClient.callTool(pending.toolName, pending.args);

        // Handle different response formats
        if ("content" in result && Array.isArray(result.content)) {
          const originalContent = result.content as Array<{ type: "text"; text: string }>;
          return {
            content: [
              {
                type: "text" as const,
                text: `[APPROVED] Tool call executed successfully.\n\n---\n\n`,
              },
              ...originalContent,
            ],
            isError: result.isError === true ? true : undefined,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `[APPROVED]\n\n${JSON.stringify(result)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `[ERROR] Failed to execute approved tool: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // proxy_reject
  server.registerTool(
    "proxy_reject",
    {
      description: "Reject a pending tool call",
      inputSchema: z.object({
        requestId: z.string().describe("The pending request ID to reject"),
      }),
    },
    async (args) => {
      const { requestId } = args;

      const pending = pendingStore.get(requestId);
      if (!pending) {
        return {
          content: [
            {
              type: "text",
              text: `[ERROR] Pending request not found: ${requestId}`,
            },
          ],
          isError: true,
        };
      }

      // Remove from pending store and clear approval
      pendingStore.remove(requestId);
      clearApproval(requestId);

      return {
        content: [
          {
            type: "text",
            text: `[REJECTED] Tool call rejected: ${pending.toolName}`,
          },
        ],
      };
    }
  );
}
