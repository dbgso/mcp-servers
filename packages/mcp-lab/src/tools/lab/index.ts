import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getActionRegistry, HANDLERS } from "./registry.js";
import type { LabContext } from "./types.js";
import type { SessionStore } from "../../session-store.js";

/**
 * One input schema covering every action.
 *
 * The MCP SDK forces `additionalProperties: false`, so a field any action
 * takes has to be declared on the tool. Built from the handlers rather than
 * restated, so adding a parameter to an action cannot leave the tool unable to
 * receive it.
 */
function buildInputSchema(): Record<string, z.ZodTypeAny> {
  const merged: Record<string, z.ZodTypeAny> = { action: z.string().optional() };

  for (const handler of HANDLERS) {
    const shape = (handler.schema as unknown as z.ZodObject<Record<string, z.ZodTypeAny>>).shape;
    for (const [key, value] of Object.entries(shape)) {
      if (key === "action") continue;
      if (!(key in merged)) merged[key] = value.optional();
    }
  }

  return merged;
}

export function buildDescribeText(): string {
  return `# mcp-lab

Run any MCP server in this repository, from any worktree, and talk to it until
you stop it. Nothing here needs the client restarted, and nothing needs
\`.mcp.json\` edited: this server is registered once, and every other server is
reached through it.

A server is started from \`src/index.ts\` through tsx, so **every \`start\`
reads the source as it is now**. Editing code and calling \`start\` again is the
whole reload story.

## Actions

${HANDLERS.map((handler) => `### ${handler.action}\n\n${handler.help}`).join("\n\n")}

## A session

\`\`\`
execute(action: "start", worktree: "/abs/path/to/a/worktree",
        package: "interactive-instruction-mcp",
        args: ["{{SCRATCH}}"],
        env: { IIMCP_LINT_MAX_LINES: "20" })
  -> session s1

execute(action: "call", session: "s1", tool: "instruction",
        params: { action: "add", id: "x", content: "...", description: "...", whenToUse: ["..."] })

execute(action: "stop", session: "s1")
\`\`\`

\`{{SCRATCH}}\` is a directory made for the session and removed with it, so a
server that writes files can be pointed somewhere harmless. \`{{WORKTREE}}\`
expands too.

Two sessions on the same worktree with different \`env\` is the way to compare
behaviour; two on different worktrees is the way to compare branches.`;
}

export function registerLabTools(params: { server: McpServer; store: SessionStore }): void {
  const { server, store } = params;
  const context: LabContext = { store };
  const registry = getActionRegistry();

  server.tool(
    "describe",
    "Explain how to use mcp-lab. Call this first.",
    {},
    () => ({ content: [{ type: "text" as const, text: buildDescribeText() }] })
  );

  server.tool(
    "execute",
    "Start MCP servers from any worktree and call their tools. Call without action to see the actions.",
    buildInputSchema(),
    async (rawParams) => {
      const action = typeof rawParams.action === "string" ? rawParams.action : undefined;

      if (action === undefined) {
        return {
          content: [
            {
              type: "text" as const,
              text: `# execute\n\nActions: ${registry.getActions().join(", ")}\n\nCall \`describe()\` for how to use them.`,
            },
          ],
        };
      }

      const handler = registry.getHandler(action);
      if (!handler) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown action: "${action}"\n\nAvailable: ${registry.getActions().join(", ")}`,
            },
          ],
          isError: true,
        };
      }

      const response = await handler.execute({ rawParams, context });
      return {
        content: response.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => ({ type: "text" as const, text: c.text })),
        isError: response.isError,
      };
    }
  );
}
