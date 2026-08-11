import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { wrapResponse } from "../../utils/response-wrapper.js";
import type { MarkdownReader } from "../../services/markdown-reader.js";
import type { ReminderConfig, ToolResult } from "../../types/index.js";
import type { ToolResponse } from "mcp-shared";
import { getActionRegistry } from "./registry.js";
import type { InstructionContext } from "./types.js";

/**
 * Convert ToolResponse to ToolResult.
 * ToolResponse allows ImageContent, but we only use text content.
 */
function toToolResult(response: ToolResponse): ToolResult {
  return {
    content: response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => ({ type: "text" as const, text: c.text })),
    isError: response.isError,
  };
}

/**
 * Build tool inputSchema from all handler schemas.
 * MCP SDK forces additionalProperties: false via objectFromShape(),
 * so all handler fields must be declared here.
 * This auto-generates from registry - no manual sync needed.
 */
function buildInputSchema(): Record<string, z.ZodTypeAny> {
  const registry = getActionRegistry();
  const merged: Record<string, z.ZodTypeAny> = {
    action: z.string().optional(),
  };

  for (const action of registry.getActions()) {
    const handler = registry.getHandler(action);
    if (!handler || !("schema" in handler)) continue;
    const shape = (handler as { schema: z.ZodObject<Record<string, z.ZodTypeAny>> }).schema.shape;
    for (const [key, value] of Object.entries(shape)) {
      if (key === "action") continue;
      if (!(key in merged)) {
        merged[key] = (value as z.ZodTypeAny).optional();
      }
    }
  }

  return merged;
}

function buildDescribeText(config: ReminderConfig): string {
  return `# instruction_describe

This tool explains how to use the instruction tool.

## Available Actions

### Reading
- \`instruction(action: "list")\` - List all documents
- \`instruction(action: "list", recursive: true)\` - List all including nested
- \`instruction(action: "list", query: "<keyword>")\` - Search documents
- \`instruction(action: "list", missingMeta: "any")\` - Find docs with missing metadata
- \`instruction(action: "list", backlinks: true)\` - Show backlinks
- \`instruction(action: "read", id: "<id>")\` - Read a document

### Draft Operations
- \`instruction(action: "add", id: "<id>", content: "...", description: "...", whenToUse: [...])\` - Create draft
- \`instruction(action: "update", id: "<id>", content: "...")\` - Update draft (direct) or promoted doc (pending + apply/cancel)
- \`instruction(action: "delete", id: "<id>")\` - Delete draft (no approval) or promoted doc (approval required)
- \`instruction(action: "rename", id: "<id>", newId: "<new-id>")\` - Rename draft (no approval) or promoted doc (approval required)

### Approval Workflow
- \`instruction(action: "approve", id: "<id>", notes: "<self-review>")\` - Complete self-review
- \`instruction(action: "approve", id: "<id>", confirmed: true)\` - User confirms, request token
- \`instruction(action: "approve", id: "<id>", approvalToken: "<token>")\` - Apply with token
- \`instruction(action: "approve", id: "<id>", targetId: "<target>", approvalToken: "<token>")\` - Apply to different ID
- \`instruction(action: "approve", ids: "id1,id2,id3", confirmed: true)\` - Batch confirm
- \`instruction(action: "approve", id: "<id>", confirmed: true, force: true)\` - Skip consecutive approval warning

### Pending Update Operations
- \`instruction(action: "apply", id: "<doc-id>")\` - Apply pending update (from update on promoted doc)
- \`instruction(action: "cancel", id: "<doc-id>")\` - Cancel pending update

### Metadata & Quality
- \`instruction(action: "link_add", id: "<id>", relatedDocs: ["doc1", "doc2"])\` - Add related docs
- \`instruction(action: "link_remove", id: "<id>", relatedDocs: ["doc1"])\` - Remove related docs
- \`instruction(action: "lint")\` - Check document quality
- \`instruction(action: "set_status", id: "<id>", status: "<status>")\` - Set draft status (single)
- \`instruction(action: "set_status", ids: "id1,id2", status: "<status>")\` - Set draft status (batch)
- \`instruction(action: "update_meta", id: "<id>")\` - Generate metadata update prompt

## Reminder

Information from this MCP is only valid for ${config.infoValidSeconds} seconds.
Always re-read before each task to get the latest rules.`;
}

function buildHelpText(): string {
  const registry = getActionRegistry();
  const actions = registry.getActions();

  if (actions.length === 0) {
    return `# instruction

No actions available yet. Use \`instruction_describe()\` to see usage.`;
  }

  return `# instruction

Available actions: ${actions.join(", ")}

Use \`instruction_describe()\` for detailed usage of each action.`;
}

export function registerInstructionTools(params: {
  server: McpServer;
  reader: MarkdownReader;
  config: ReminderConfig;
}): void {
  const { server, reader, config } = params;
  const context: InstructionContext = { reader, config };
  const registry = getActionRegistry();

  // Register instruction_describe tool
  server.tool(
    "instruction_describe",
    "Show detailed usage instructions for the instruction tool. Call this first to understand how to use this MCP.",
    {},
    async () => {
      return wrapResponse({
        result: {
          content: [{ type: "text" as const, text: buildDescribeText(config) }],
        },
        config,
      });
    }
  );

  // Register instruction tool
  server.tool(
    "instruction",
    "Manage documentation. Call without action to see available actions.",
    buildInputSchema(),
    async (rawParams) => {
      const action = typeof rawParams.action === "string" ? rawParams.action : undefined;

      // No action specified - show help
      if (!action) {
        return wrapResponse({
          result: {
            content: [{ type: "text" as const, text: buildHelpText() }],
          },
          config,
        });
      }

      // Find and execute handler
      const handler = registry.getHandler(action);
      if (!handler) {
        return wrapResponse({
          result: {
            content: [
              {
                type: "text" as const,
                text: `Unknown action: "${action}"\n\nAvailable actions: ${registry.getActions().join(", ")}\n\nUse \`instruction_describe()\` for help.`,
              },
            ],
            isError: true,
          },
          config,
        });
      }

      const result = await handler.execute({ rawParams, context });
      return wrapResponse({ result: toToolResult(result), config });
    }
  );
}
