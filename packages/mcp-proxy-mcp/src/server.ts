import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { requestApproval, getApprovalRequestedMessage } from "mcp-shared";
import { z } from "zod";
import { PendingStore } from "./pending-store.js";
import { ProxyClient } from "./proxy-client.js";
import { RuleEngine } from "./rule-engine.js";
import { RuleStore } from "./rule-store.js";
import { registerRuleTools } from "./tools/index.js";
import type { TargetConfig } from "./types.js";

export interface CreateServerParams {
  target: TargetConfig;
  rulesFile: string;
  dryRun?: boolean;
}

export interface CreateServerResult {
  server: McpServer;
  proxyClient: ProxyClient;
}

export async function createServer(
  params: CreateServerParams
): Promise<CreateServerResult> {
  const { target, rulesFile, dryRun = false } = params;

  // Initialize components
  const proxyClient = new ProxyClient(target);
  const ruleStore = new RuleStore(rulesFile);
  const ruleEngine = new RuleEngine(ruleStore);
  const pendingStore = new PendingStore();

  // Load rules
  await ruleStore.load();

  // Connect to target MCP
  await proxyClient.connect();

  // Get tools from target
  const targetTools = await proxyClient.listTools();

  // Create proxy server
  const server = new McpServer({
    name: "mcp-proxy-mcp",
    version: "0.1.0",
  });

  // Register rule management tools
  registerRuleTools({ server, ruleStore, ruleEngine, proxyClient, pendingStore, dryRun });

  // Register single proxy_execute tool instead of individual tools
  registerProxyExecuteTool({
    server,
    targetTools: targetTools.tools,
    proxyClient,
    ruleEngine,
    pendingStore,
    dryRun,
  });

  return { server, proxyClient };
}

function registerProxyExecuteTool(params: {
  server: McpServer;
  targetTools: Tool[];
  proxyClient: ProxyClient;
  ruleEngine: RuleEngine;
  pendingStore: PendingStore;
  dryRun: boolean;
}): void {
  const { server, targetTools, proxyClient, ruleEngine, pendingStore, dryRun } = params;

  // Build tool list for description
  const toolList = targetTools.map((t) => `- ${t.name}: ${t.description ?? "(no description)"}`).join("\n");

  server.registerTool(
    "proxy_execute",
    {
      description: `Execute a tool through the proxy with rule-based filtering.\n\nAvailable tools:\n${toolList}`,
      inputSchema: z.object({
        toolName: z.string().describe("Name of the tool to execute"),
        args: z.record(z.unknown()).optional().describe("Arguments to pass to the tool"),
      }),
    },
    async (input) => {
      const { toolName, args = {} } = input;

      // Check if tool exists
      const tool = targetTools.find((t) => t.name === toolName);
      if (!tool) {
        return {
          content: [
            {
              type: "text",
              text: `[ERROR] Unknown tool: ${toolName}\n\nAvailable tools:\n${toolList}`,
            },
          ],
          isError: true,
        };
      }

      // Evaluate rules
      const evaluation = ruleEngine.evaluate(toolName, args);

      if (evaluation.action === "deny") {
        if (dryRun) {
          console.error(`[DRY-RUN] Would block: ${toolName} - ${evaluation.reason}`);
        } else {
          return {
            content: [
              {
                type: "text",
                text: `[BLOCKED] Tool call denied: ${evaluation.reason}`,
              },
            ],
            isError: true,
          };
        }
      }

      if (evaluation.action === "ask") {
        if (dryRun) {
          console.error(`[DRY-RUN] Would ask for approval: ${toolName} - ${evaluation.reason}`);
        } else {
          const pendingCall = pendingStore.add(toolName, args, evaluation.matchedRule!);

          const { fallbackPath } = await requestApproval({
            request: {
              id: pendingCall.id,
              operation: `proxy:${toolName}`,
              description: `Tool: ${toolName}\nRule: ${evaluation.reason}`,
            },
          });

          return {
            content: [
              {
                type: "text",
                text: `[APPROVAL REQUIRED] ${evaluation.reason}\n\nRequest ID: ${pendingCall.id}\n\n${getApprovalRequestedMessage(fallbackPath)}\n\nUse proxy_approve tool to approve this call.`,
              },
            ],
          };
        }
      }

      // Forward to target MCP
      try {
        const result = await proxyClient.callTool(toolName, args);

        if ("content" in result && Array.isArray(result.content)) {
          if (dryRun && evaluation.action === "deny") {
            const originalContent = result.content as Array<{ type: "text"; text: string }>;
            return {
              content: [
                {
                  type: "text" as const,
                  text: `[DRY-RUN NOTE] This call would be blocked: ${evaluation.reason}\n\n---\n\n`,
                },
                ...originalContent,
              ],
              isError: result.isError === true ? true : undefined,
            };
          }
          if (dryRun && evaluation.action === "ask") {
            const originalContent = result.content as Array<{ type: "text"; text: string }>;
            return {
              content: [
                {
                  type: "text" as const,
                  text: `[DRY-RUN NOTE] This call would require approval: ${evaluation.reason}\n\n---\n\n`,
                },
                ...originalContent,
              ],
              isError: result.isError === true ? true : undefined,
            };
          }
          return {
            content: result.content as Array<{ type: "text"; text: string }>,
            isError: result.isError === true ? true : undefined,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `[ERROR] Failed to call tool: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
