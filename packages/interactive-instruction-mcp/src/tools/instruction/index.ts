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

export function buildDescribeText(config: ReminderConfig): string {
  return `# instruction_describe

This tool explains how to use the instruction tool.

## Available Actions

### Reading
- \`instruction(action: "list")\` - List all documents
- \`instruction(action: "list", recursive: true)\` - List all including nested
- \`instruction(action: "list", query: "<keyword>")\` - Search documents
- \`instruction(action: "list", missingMeta: "any")\` - Find docs with missing metadata
- \`instruction(action: "list", id: "<id>", backlinks: true)\` - Which documents reference this one (needs \`id\`)
- \`instruction(action: "list", drafts: true)\` - List drafts, by the plain id every other action takes
- \`instruction(action: "read", id: "<id>")\` - Read a document

### Draft Operations
- \`instruction(action: "add", id: "<id>", content: "...", description: "...", whenToUse: [...], relatedDocs: [...])\` - Create draft (\`relatedDocs\` optional)
- \`instruction(action: "update", id: "<id>", content: "...")\` - Update draft (direct) or promoted doc (pending + apply/cancel)
- \`instruction(action: "delete", id: "<id>")\` - Delete a draft (immediate)
- \`instruction(action: "delete", id: "<id>", explanation: "<what you told the user>")\` - Delete a promoted document (repeat the identical call twice more)
- \`instruction(action: "rename", id: "<id>", newId: "<new-id>")\` - Rename a draft (immediate)
- \`instruction(action: "rename", id: "<id>", newId: "<new-id>", explanation: "<what you told the user>")\` - Rename a promoted document (repeat the identical call twice more)

### Approval Workflow
- \`instruction(action: "approve", id: "<id>", notes: "<self-review>")\` - Complete self-review
- \`instruction(action: "approve", id: "<id>", explanation: "<what you told the user>")\` - Promote (repeat the identical call to go through)
- \`instruction(action: "approve", id: "<id>", targetId: "<target>", explanation: "...")\` - Promote onto a different ID
- \`instruction(action: "approve", ids: "id1,id2,id3", explanation: "...")\` - Promote several under one explanation
- \`instruction(action: "approve", id: "<id>", explanation: "...", force: true)\` - Skip consecutive approval warning

### Pending Update Operations
- \`instruction(action: "apply", id: "<doc-id>", explanation: "<what you told the user>")\` - Apply pending update (repeat the identical call to go through)
- \`instruction(action: "cancel", id: "<doc-id>")\` - Cancel pending update

### Metadata & Quality
- \`instruction(action: "link_add", id: "<id>", relatedDocs: ["doc1", "doc2"], explanation: "<what you told the user>")\` - Add related docs (repeat the identical call to go through)
- \`instruction(action: "link_remove", id: "<id>", relatedDocs: ["doc1"], explanation: "<what you told the user>")\` - Remove related docs (repeat the identical call to go through)
- \`instruction(action: "lint")\` - Check document quality. A draft is held to the rules it can answer on its own; orphans, similarity and cycles wait until it is promoted
- \`instruction(action: "set_status", id: "<id>", status: "editing")\` - Reset a draft to \`editing\`, discarding its workflow state
- \`instruction(action: "set_status", ids: "id1,id2", status: "editing")\` - The same for several drafts
- \`instruction(action: "read_meta", id: "<id>")\` - Review a document's metadata against its neighbours

### Seeing the corpus
- \`instruction(action: "graph")\` - Render the relatedDocs graph of the promoted corpus as an interactive page (drafts are not in it)
- \`instruction(action: "graph", id: "<id>", depth: 2)\` - Draw one document's neighbourhood
- \`instruction(action: "graph", format: "text")\` - The same graph as an adjacency list, which is the form to read here
- \`instruction(action: "graph", layout: "fcose", direction: "LR", spacing: 1.5, edgeStyle: "taxi", includeUnlinked: true, outputPath: "<file>")\` - How the page is drawn and where it goes

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
