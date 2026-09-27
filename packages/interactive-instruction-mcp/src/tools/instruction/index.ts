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
 * The fields of a handler's schema, refinements and all.
 *
 * `.refine` returns a `ZodEffects` wrapping the object, and a `ZodEffects` has
 * no `.shape` -- so reading `.shape` directly meant an action could not state a
 * condition between two of its arguments without taking every other action's
 * parameters off the tool with it. It kept the conditions in prose: `backlinks`
 * needs `id`, `set_status` needs one of `id` or `ids`, `update` needs at least
 * one field to change. Each was enforced by hand inside `doExecute`, or in one
 * case not at all.
 *
 * The wrapper keeps what it wraps, so unwrapping recovers the shape while the
 * refinement stays where it belongs: `BaseActionHandler` validates with the
 * whole schema before dispatch.
 */
export function objectShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> | null {
  let current: z.ZodTypeAny = schema;

  // `.refine` can be applied more than once, and each one wraps again.
  while (current instanceof z.ZodEffects) {
    current = current.innerType() as z.ZodTypeAny;
  }

  return current instanceof z.ZodObject
    ? (current.shape as Record<string, z.ZodTypeAny>)
    : null;
}

/**
 * Values a caller could plausibly send, used to compare two declarations of one
 * field by what they accept rather than by their types.
 */
const PROBES: unknown[] = [null, "x", "", 1, true, [], ["x"], {}];

/** What every action says about one parameter name. */
export interface Declaration {
  action: string;
  field: z.ZodTypeAny;
  required: boolean;
}

/**
 * Whether two declarations of one name accept the same things.
 *
 * By behaviour, not by type: that is what a caller experiences, and it needs no
 * knowledge of how zod represents optionality or nullability.
 */
function agree(params: { a: z.ZodTypeAny; b: z.ZodTypeAny }): boolean {
  const { a, b } = params;
  return PROBES.every((probe) => a.safeParse(probe).success === b.safeParse(probe).success);
}

/**
 * What the one merged schema says about a parameter several actions declare.
 *
 * The merge used to keep the first declaration of each name and drop the rest,
 * which made two things untrue at once. `sizeExemption` was written nullable on
 * `update` and not on `add`, and because `add` is registered first,
 * `update(id, sizeExemption: null)` -- the documented way to remove the field --
 * was rejected at the tool boundary while every unit test passed. And `id`, which
 * 15 actions take as the document to act on, was advertised with `list`'s wording,
 * "Parent ID to list documents under", because `list` is registered first.
 *
 * So: a divergence is refused rather than resolved. Silently taking one of two
 * disagreeing contracts means the other is a fiction, and the tests cannot see it
 * because a unit test validates against the handler's own schema. Refusing at
 * startup puts the failure where the mistake is.
 *
 * What cannot be fixed here is the flattening itself. A discriminated union on
 * `action` would express all of this exactly -- and measured against SDK 1.26.0,
 * `registerTool` validates one correctly and then publishes
 * `{"type":"object","properties":{}}` for it, because the zod-to-JSON-Schema step
 * does not handle unions and emits nothing rather than failing. An agent reading
 * that sees a tool with no arguments, which is worse than a flat list. So the
 * shape stays flat and the description carries what the shape cannot.
 */
function describeSharing(params: { declarations: Declaration[] }): string {
  const { declarations } = params;

  const actions = declarations.map((d) => d.action);
  const required = declarations.filter((d) => d.required).map((d) => d.action);
  const mandatory = required.length === 0 ? "" : ` Required in: ${required.join(", ")}.`;

  if (declarations.length === 1) {
    const own = declarations[0].field.description;
    return own === undefined
      ? `Only \`${actions[0]}\` takes this.`
      : `${sentence(own)} \`${actions[0]}\` only.${mandatory}`;
  }

  // A wording is used only when every action that takes the name agrees on it.
  // Taking the first one is what made `id` advertise "Parent ID to list documents
  // under" as its meaning for all fifteen actions that take it, because `list` --
  // the one action that means the category to list inside -- is registered first.
  //
  // Where they disagree the schema says so and stops, rather than quoting six
  // paragraphs of prose into a tool list that is read on every session: repeating
  // each action's wording here doubled the descriptions, and `instruction_describe`
  // is both the place that already carries per-action detail and the one fetched
  // on demand.
  const wordings = new Set(
    declarations.map((declaration) => declaration.field.description).filter((d) => d !== undefined)
  );

  const shared = `Taken by: ${actions.join(", ")}.${mandatory}`;

  if (wordings.size === 0) return shared;
  if (wordings.size === 1) return `${sentence([...wordings][0])} ${shared}`;
  return `${shared} What it means differs between them; \`instruction_describe()\` says how.`;
}

/** The text with a full stop, so composing two of them does not run them together. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * The one schema the `instruction` tool advertises.
 *
 * Every field is optional here whatever the actions say, because a field
 * required by one action cannot be required of the tool that also serves the
 * fifteen others. `BaseActionHandler` re-validates against the handler's own
 * schema, so the requirement is enforced; this is what the caller is shown, and
 * the description is where "required in `add`" can still be said.
 */
/** The merged schema, for the test that holds this file to what it claims. */
export function buildInputSchemaForTesting(): Record<string, z.ZodTypeAny> {
  return buildInputSchema();
}

function buildInputSchema(): Record<string, z.ZodTypeAny> {
  const registry = getActionRegistry();
  const declarations = new Map<string, Declaration[]>();

  for (const action of registry.getActions()) {
    const handler = registry.getHandler(action);
    if (!handler || !("schema" in handler)) continue;
    const shape = objectShape((handler as { schema: z.ZodTypeAny }).schema);
    if (shape === null) continue;

    for (const [key, value] of Object.entries(shape)) {
      if (key === "action") continue;
      const field = value as z.ZodTypeAny;
      const entries = declarations.get(key) ?? [];
      entries.push({ action, field, required: !field.safeParse(undefined).success });
      declarations.set(key, entries);
    }
  }

  const merged: Record<string, z.ZodTypeAny> = {
    // Optional, because the tool's own description says "Call without action to
    // see available actions" and the handler answers a bare call with the list.
    // Marking it required would have the SDK reject that call before the handler
    // ever sees it -- which `registerTool` does do, unlike the deprecated
    // overload, since it publishes `required`.
    action: z
      .string()
      .optional()
      .describe("Which operation to perform. Omit it to list them."),
  };

  for (const [name, entries] of declarations) {
    merged[name] = resolveField({ name, declarations: entries });
  }

  return merged;
}

/**
 * One name's single published field, or a refusal.
 *
 * Separate from `buildInputSchema` so the refusal can be tested. With the real
 * registry there is nothing to refuse -- which is exactly how a guard comes to be
 * a check that cannot fail: it would pass whether or not it worked. This takes
 * the declarations as an argument, so a test can hand it a disagreeing pair.
 */
export function resolveField(params: { name: string; declarations: Declaration[] }): z.ZodTypeAny {
  const { name, declarations } = params;
  const first = declarations[0];

  const disagreeing = declarations.filter((entry) => !agree({ a: first.field, b: entry.field }));
  if (disagreeing.length > 0) {
    throw new Error(
      `\`${name}\` is declared differently by ${first.action} and ` +
      `${disagreeing.map((entry) => entry.action).join(", ")}. The tool publishes one ` +
      "schema for every action, so one of these contracts would be silently dropped " +
      "and the actions advertising it would be advertising a fiction. Declare the " +
      "field the same way in each, or give them different names."
    );
  }

  return first.field.optional().describe(describeSharing({ declarations }));
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
- **A category with two or more documents wants an index.** Without one, which
  document a new sibling hangs off is decided afresh every time.
- **Directories are the other axis, and are not repeated here.** Ids carry the
  hierarchy (\`__\` separates levels) and \`graph\` draws it as node colour. Use
  \`relatedDocs\` for what to read next, not for where a document lives.

\`instruction(action: "link_add", id: "<parent>", relatedDocs: ["<child>"], explanation: "<what the link means>")\`

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

  // `registerTool` rather than `tool`, which the SDK deprecates. It also
  // publishes `required`, which the deprecated overload's all-optional shape
  // could not express -- see `buildInputSchema` for why the merged schema keeps
  // every field optional anyway, and where the requirement is stated instead.
  server.registerTool(
    "instruction_describe",
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
      description: "Manage documentation. Call without action to see available actions.",
      inputSchema: buildInputSchema(),
    },
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
