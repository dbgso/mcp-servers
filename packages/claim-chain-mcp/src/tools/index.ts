import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ActionRegistry, type ToolResponse } from "mcp-shared";
import { z } from "zod";
import { DEFAULT_KINDS, CONFIG_FILE } from "../kinds.js";
import type { ClaimChain } from "../chain.js";
import {
  AddHandler,
  CheckHandler,
  GapsHandler,
  ListHandler,
  ReadHandler,
  TraceHandler,
  UnblockedHandler,
  UpdateHandler,
} from "./handlers/index.js";
import { errorResponse, textResponse, type ChainContext } from "./types.js";

/**
 * Every action, in one place. `describe` reads the actions off these, so an
 * action cannot be documented into existence or renamed in only one place.
 */
export const HANDLERS = [
  new AddHandler(),
  new UpdateHandler(),
  new ReadHandler(),
  new ListHandler(),
  new CheckHandler(),
  new GapsHandler(),
  new UnblockedHandler(),
  new TraceHandler(),
] as const;

function kindsTable(): string {
  const rows = DEFAULT_KINDS.kinds.map((rule) => {
    const refs = rule.refs.map((ref) => `${ref.kind} (${ref.min}..${ref.max ?? "n"})`).join(", ");
    const fields = rule.fields.map((field) => field.name).join(", ");
    return `| ${rule.kind} | ${rule.description} | ${refs || "—"} | ${fields} | ${rule.coveredBy ?? "—"} |`;
  });
  return ["| kind | what | cites | fields | needs below |", "|---|---|---|---|---|", ...rows].join("\n");
}

export function buildDescribeText(): string {
  return `# claim-chain

**Downstream can only say what upstream has decided.** Each decision is a claim
with an id, and a claim is written only if it cites the claims its kind has to
cite. What makes a claim correct is the kind of what it cites -- never what its
text says.

When a claim cannot be written because what it has to cite does not exist, that
is upstream missing a decision. Pass \`want\` and it is recorded as a gap. When
the missing claim is added upstream, \`add\` lists the gaps it answers, and the
drafts waiting on them can be written.

This tool's input schema names no argument on purpose; this document is where
they are written down.

## Kinds

${kindsTable()}

A root replaces these with \`${CONFIG_FILE}\`.

## Actions

${HANDLERS.map((handler) => `### ${handler.action}\n\n${handler.help}`).join("\n\n")}

## The loop

\`\`\`
execute(action: "add", kind: "S", fields: { behavior: "..." }, refs: [],
        want: "what may be known when a hidden name is used inside an expression")
  -> not written; GAP-0001 needs a C

execute(action: "add", kind: "C", fields: { condition: "..." }, refs: ["P-0001"])
  -> C-0002 added; GAP-0001 is now writable:
     execute(action: "add", kind: "S", ..., refs: ["C-0002"], resolves: "GAP-0001")
\`\`\``;
}

export function registerTools(params: { server: McpServer; chain: ClaimChain }): void {
  const { server, chain } = params;
  const context: ChainContext = { chain };
  const registry = new ActionRegistry<ChainContext>().registerAll([...HANDLERS]);

  server.registerTool(
    "describe",
    { description: "Explain how to use claim-chain. Call this first." },
    () => textResponse(buildDescribeText()) as { content: { type: "text"; text: string }[] }
  );

  server.registerTool(
    "execute",
    {
      description: "Write and check claims that can only cite what upstream has decided. Call describe for the actions.",
      // policy__mcp-tool-surface: no argument information here; describe has it.
      inputSchema: z.object({}).passthrough(),
    },
    async (rawParams) => toResult(await dispatch({ registry, rawParams, context }))
  );
}

async function dispatch(params: {
  registry: ActionRegistry<ChainContext>;
  rawParams: Record<string, unknown>;
  context: ChainContext;
}): Promise<ToolResponse> {
  const { registry, rawParams, context } = params;
  const action = typeof rawParams.action === "string" ? rawParams.action : undefined;
  const handler = action === undefined ? undefined : registry.getHandler(action);
  if (handler === undefined) {
    return errorResponse(`Unknown action: "${String(action)}". Actions: ${registry.getActions().join(", ")}. Call describe() for what each takes.`);
  }
  return handler.execute({ rawParams, context });
}

function toResult(response: ToolResponse): { content: { type: "text"; text: string }[]; isError?: boolean } {
  return {
    content: response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => ({ type: "text" as const, text: c.text })),
    isError: response.isError,
  };
}
