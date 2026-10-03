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
 * The `instruction` tool's input schema, which deliberately says nothing.
 *
 * One tool serves sixteen actions, and MCP publishes one schema per tool. Every
 * way of squeezing sixteen contracts into one is a lie of some kind, and this
 * package tried two of them:
 *
 * - Merging the actions' fields and keeping the first declaration of each name.
 *   `id` is the document to act on for fifteen actions and the category to list
 *   inside for `list`, and because `list` is registered first the tool advertised
 *   "Parent ID to list documents under" as its meaning for all of them. Worse,
 *   `sizeExemption` was nullable on `update` and not on `add`, so
 *   `update(id, sizeExemption: null)` -- the documented way to remove the field --
 *   was rejected at the tool boundary while the handler that would have accepted
 *   it never ran.
 * - A discriminated union on `action`, which expresses it exactly and cannot be
 *   published: measured against SDK 1.26.0, `registerTool` validates one
 *   correctly and then emits `{"type":"object","properties":{}}`, because the
 *   conversion to JSON Schema does not handle unions and returns nothing rather
 *   than failing.
 *
 * So the schema carries no argument information at all, and `describe`
 * carries all of it. That is not a fallback: a schema that says nothing cannot be
 * wrong about anything, and the per-action detail is better in a document fetched
 * when it is needed than in a tool list read on every session -- the merged
 * version of it was 4,647 characters, about 1,150 tokens, of which the accurate
 * part was the field names.
 *
 * `passthrough` rather than an empty shape, and the difference matters: an empty
 * shape publishes `properties: {}` and the SDK then *discards every argument*
 * before the handler sees it, silently. `passthrough` publishes
 * `additionalProperties: true`, which says "this takes arbitrary arguments", and
 * hands them all over. Validation happens where the contract is: `BaseActionHandler`
 * parses against the handler's own schema before dispatch, and each action's
 * `help` and `describe` say what that schema wants.
 */
function buildInputSchema(): z.ZodTypeAny {
  return z.object({}).passthrough();
}

export function buildDescribeText(config: ReminderConfig): string {
  return `# instruction

This is the whole of what \`instruction\` takes. Its own input schema names no
argument on purpose -- one tool serves every action below, so a single schema
would be wrong about most of them -- which makes this document the only place
the arguments are written down.

## Available Actions

### Reading
- \`instruction(action: "list")\` - List all documents
- \`instruction(action: "list", recursive: true)\` - List all including nested
- \`instruction(action: "list", query: "<keyword>")\` - Search documents
- \`instruction(action: "list", missingMeta: "any")\` - Find docs with missing metadata
- \`instruction(action: "backlinks", id: "<id>")\` - Which documents reference this one
- \`instruction(action: "list", drafts: true)\` - List drafts, by the plain id every other action takes
- \`instruction(action: "read", id: "<id>")\` - Read a document

### Draft Operations
- \`instruction(action: "add", id: "<id>", content: "...", description: "...", whenToUse: [...], relatedDocs: [...])\` - Create draft (\`relatedDocs\` optional)
- \`instruction(action: "update", id: "<id>", content: "...")\` - Update draft (direct) or promoted doc (pending + apply/cancel)
- \`instruction(action: "update", id: "<id>", sizeExemption: "<why>")\` - Keep a long document whole, with the reason on the record (null removes it)
- \`instruction(action: "delete", id: "<id>")\` - Delete a draft (immediate)
- \`instruction(action: "delete", id: "<id>", explanation: "<what you told the user>")\` - Delete a promoted document (repeat the identical call twice more)
- \`instruction(action: "rename", id: "<id>", newId: "<new-id>")\` - Rename a draft (immediate)
- \`instruction(action: "rename", id: "<id>", newId: "<new-id>", explanation: "<what you told the user>")\` - Rename a promoted document (repeat the identical call twice more)

### Approval Workflow
- \`instruction(action: "approve", id: "<id>", notes: "<self-review>")\` - Complete self-review
- \`instruction(action: "approve", id: "<id>", explanation: "<what you told the user>")\` - Promote (repeat the identical call to go through)
- \`instruction(action: "approve", id: "<id>", targetId: "<target>", explanation: "...")\` - Promote onto a different ID
- \`instruction(action: "approve", ids: "id1,id2,id3", explanation: "...")\` - Promote several under one explanation

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

### The shape to aim for

\`relatedDocs\` is the corpus's skeleton: \`graph\`, \`backlinks\` and
\`orphaned-document\` all read it, and nothing else does.

- **Edges run parent to child.** A document lists the documents that sit under
  it, not the one it sits under.
- **Why that direction.** \`orphaned-document\` reports a document nothing links
  to. Parent to child leaves only the corpus's entry points unreferenced, which
  is worth being told; child to parent leaves every leaf unreferenced, and
  silencing that is how a corpus ends up with a document's parents among its own
  children.
- **A DAG, not a tree.** Two parents are allowed, and are a sign the document may
  belong one level up instead. Cycles are reported.
- **Directories are the other axis, and are not repeated here.** Ids carry the
  hierarchy (\`__\` separates levels) and \`graph\` draws it as node colour. Use
  \`relatedDocs\` for what to read next, not for where a document lives.

\`instruction(action: "link_add", id: "<parent>", relatedDocs: ["<child>"], explanation: "<what the link means>")\`

### The hub of a family

Two or more documents sharing a parent id are a **family**, and a family gets one
document that indexes it: the **hub**. Everything outside the family points at the
hub; only the hub names the members.

- **At two members, if anything outside needs to reach them.** One reference to
  one document is a citation -- it means that document and no other. The second
  turns the passage into a list, and a list written outside the family is a second
  copy of the index that nobody maintains. \`IIMCP_LINT_HUB_CHILDREN\` moves the
  number; where a corpus draws that line is a property of the corpus.
- **The hub is the document at the family's id.** \`coding-rules\`, not
  \`coding-rules__overview\`. An \`overview\`, \`index\` or \`readme\` inside the family
  is a sibling of what it indexes -- the id hierarchy makes it one, whatever the
  file is called -- so a reference to it is not a reference to the family, and
  nothing can check its list against what is actually there.
- **One line per member, and no more.** Enough to choose between them, which is
  all the hub is for. A summary of a member is a second account of it, and the two
  disagree the first time one is edited. Anything longer belongs in the member.
- **The hub's list is the thing that goes stale.** It is what everything else is
  sent to read, so a member it fails to name is a document nobody is sent to, and
  a name with no member behind it is a reader sent nowhere. Nothing else notices:
  the hub is the copy that is never reread.

Reported as \`prefer-hub-reference\` (a document naming members instead of the
hub, or a family with no hub at all), \`stale-hub-index\` (the hub's list and the
directory disagree) and \`misplaced-hub\` (an index living inside what it indexes).

## Reminder

Information from this MCP is only valid for ${config.infoValidSeconds} seconds.
Always re-read before each task to get the latest rules.`;
}

type Registry = ReturnType<typeof getActionRegistry>;

/** The action name, or nothing -- which is the caller asking for the help text. */
function requestedAction(action: unknown): string | undefined {
  return typeof action === "string" ? action : undefined;
}

function unknownActionText(params: { action: string; registry: Registry }): string {
  const { action, registry } = params;
  return `Unknown action: "${action}"\n\nAvailable actions: ${registry.getActions().join(", ")}\n\nUse \`describe()\` for help.`;
}

function buildHelpText(): string {
  const registry = getActionRegistry();
  const actions = registry.getActions();

  if (actions.length === 0) {
    return `# instruction

No actions available yet. Use \`describe()\` to see usage.`;
  }

  return `# instruction

Available actions: ${actions.join(", ")}

Use \`describe()\` for detailed usage of each action.`;
}

export function registerInstructionTools(params: {
  server: McpServer;
  reader: MarkdownReader;
  config: ReminderConfig;
}): void {
  const { server, reader, config } = params;
  const context: InstructionContext = { reader, config };
  const registry = getActionRegistry();

  // `registerTool` rather than `tool`, which the SDK deprecates. It also
  // publishes `required`, which the deprecated overload's all-optional shape
  // could not express -- see `buildInputSchema` for why the merged schema keeps
  // every field optional anyway, and where the requirement is stated instead.
  server.registerTool(
    "describe",
    {
      description:
        "Show detailed usage instructions for the instruction tool. Call this first to understand how to use this MCP.",
    },
    async () => {
      return wrapResponse({
        result: {
          content: [{ type: "text" as const, text: buildDescribeText(config) }],
        },
        config,
      });
    }
  );

  server.registerTool(
    "instruction",
    {
      description:
        "Manage documentation. This tool's arguments are not described here -- call " +
        "`describe()` for the actions and what each one takes. Calling " +
        "`instruction` with no action lists them too.",
      inputSchema: buildInputSchema(),
    },
    async (rawParams) => {
      const action = requestedAction(rawParams.action);

      // No action specified - show help
      if (!action) {
        return wrapResponse({
          result: { content: [{ type: "text" as const, text: buildHelpText() }] },
          config,
        });
      }

      // Find and execute handler
      const handler = registry.getHandler(action);
      if (!handler) {
        return wrapResponse({
          result: {
            content: [{ type: "text" as const, text: unknownActionText({ action, registry }) }],
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
