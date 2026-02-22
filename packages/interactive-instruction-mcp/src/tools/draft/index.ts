import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MarkdownReader } from "../../services/markdown-reader.js";
import { wrapResponse } from "../../utils/response-wrapper.js";
import type { ReminderConfig, DraftActionHandler } from "../../types/index.js";
import {
  ListHandler,
  ReadHandler,
  AddHandler,
  UpdateHandler,
  DeleteHandler,
  RenameHandler,
  ApproveHandler,
} from "./handlers/index.js";

const DRAFT_HELP = `# Draft Tool

Manage temporary documentation drafts. AI can freely create, update, and delete drafts without permission.

## IMPORTANT RULES

### New information = New file
- **Different topic = always create new draft** (use "add", not "update")
- **"update" is ONLY for refining the same topic** (fixing typos, improving wording)
- If you can describe the content with a different "about X" phrase, it's a separate topic

### Use hierarchy to express relationships
Group related topics with prefixes:
\`\`\`
coding__params-style    ← About argument format
coding__shared-code     ← About code sharing
coding__testing         ← About testing rules
\`\`\`

### Granularity guide
- If you can say "This is about X" in one phrase → 1 topic
- If multiple "about X" are mixed → split into separate files

## Actions

- \`draft()\` - Show this help
- \`draft(action: "list")\` - List all drafts
- \`draft(action: "read", id: "<id>")\` - Read a draft
- \`draft(action: "add", id: "<id>", content: "<content>")\` - Create new draft
- \`draft(action: "update", id: "<id>", content: "<content>")\` - Update existing draft (same topic only!)
- \`draft(action: "delete", id: "<id>")\` - Delete a draft
- \`draft(action: "rename", id: "<oldId>", newId: "<newId>")\` - Rename/move a draft (safe reorganization)
- \`draft(action: "approve", id: "<id>", notes: "<self-review>")\` - Complete self-review, then explain to user
- \`draft(action: "approve", id: "<id>", confirmed: true)\` - After user confirms explanation, show diff/summary and request approval
- \`draft(action: "approve", id: "<id>", approvalToken: "<token>")\` - Approve and promote with token
- \`draft(action: "approve", ids: "id1,id2,id3", approvalToken: "<token>")\` - Batch approve multiple drafts with single token

## Approval Workflow

Before a draft can be applied, the AI must:
1. **Self-review** the content (provide \`notes\`)
2. **Explain to user** what the draft contains **in your own words** (tool does NOT show content)
3. **User confirms** they understand, then call with \`confirmed: true\`
4. Tool shows diff/summary + sends notification
5. **User approves** with the token from desktop notification

## Examples

User says: "Use params object for function arguments"
\`\`\`
draft(action: "add", id: "coding__params-style", content: "# Params Style\\n\\nAll function arguments must use object format.")
\`\`\`

User then says: "Always write unit tests for services"
\`\`\`
draft(action: "add", id: "coding__testing", content: "# Testing Rules\\n\\nService classes must have unit tests.")
\`\`\`
Note: This is a NEW topic, so use "add" not "update"!

Drafts are stored under \`_mcp_drafts/\` directory. Use \`apply\` tool to promote to confirmed docs.

**[IMPORTANT]** After creating a draft, you MUST explain the content to the user and wait for their approval before applying.`;

const actionHandlers: Record<string, DraftActionHandler> = {
  list: new ListHandler(),
  read: new ReadHandler(),
  add: new AddHandler(),
  update: new UpdateHandler(),
  delete: new DeleteHandler(),
  rename: new RenameHandler(),
  approve: new ApproveHandler(),
};

export function registerDraftTool(params: {
  server: McpServer;
  reader: MarkdownReader;
  config: ReminderConfig;
}): void {
  const { server, reader, config } = params;

  server.registerTool(
    "draft",
    {
      description:
        "Manage documentation drafts. Call without args for help.",
      inputSchema: {
        help: z
          .boolean()
          .optional()
          .describe("Show help"),
        action: z
          .enum(["list", "read", "add", "update", "delete", "rename", "approve"])
          .optional()
          .describe("Action to perform. Omit to show help."),
        id: z
          .string()
          .optional()
          .describe("Draft ID (without '_mcp_drafts__' prefix)"),
        ids: z
          .string()
          .optional()
          .describe("Comma-separated draft IDs for batch approve"),
        content: z
          .string()
          .optional()
          .describe("Markdown content for add/update actions"),
        newId: z
          .string()
          .optional()
          .describe("New draft ID for rename action"),
        targetId: z
          .string()
          .optional()
          .describe("Target ID for approve action (if different from draft ID)"),
        approvalToken: z
          .string()
          .optional()
          .describe("Approval token from desktop notification (for approve action)"),
        notes: z
          .string()
          .optional()
          .describe("Self-review notes (required for approve action)"),
        confirmed: z
          .boolean()
          .optional()
          .describe("Confirm user has seen AI's explanation (required after explaining to user)"),
      },
    },
    async ({ help, action, id, ids, content, newId, targetId, approvalToken, notes, confirmed }) => {
      if (help || !action) {
        return wrapResponse({
          result: {
            content: [{ type: "text" as const, text: DRAFT_HELP }],
          },
          config,
        });
      }

      const handler = actionHandlers[action];
      if (!handler) {
        return wrapResponse({
          result: {
            content: [
              { type: "text" as const, text: `Error: Unknown action "${action}"` },
            ],
            isError: true,
          },
          config,
        });
      }

      const result = await handler.execute({
        actionParams: { id, ids, content, newId, targetId, approvalToken, notes, confirmed },
        context: { reader, config },
      });
      return wrapResponse({ result, config });
    }
  );
}
