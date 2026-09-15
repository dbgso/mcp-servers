/**
 * A minimal MCP server for the firewall to proxy.
 *
 * The integration suite spawns the built firewall as a child process, which
 * means v8 sees none of it. These fixtures let the firewall run in-process
 * instead, with only the target on the other end of a pipe -- so what is
 * measured is the code that decides whether a call is allowed.
 *
 * Two tools: one that answers, and one that fails, so the proxy's error path
 * has something real to forward.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "fixture-target", version: "0.0.0" },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  {
    name: "safe_read",
    description: "Reads something harmless",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
  },
  {
    name: "dangerous_write",
    description: "Writes something dangerous",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
  },
  {
    name: "always_throws",
    description: "Fails on every call",
    inputSchema: { type: "object", properties: {} },
  },
  // No description: the proxy's tool listing has to say something in its
  // place rather than print `undefined` into the agent's prompt.
  { name: "undocumented", inputSchema: { type: "object", properties: {} } },
  {
    name: "answers_with_error",
    description: "Returns an error result rather than throwing",
    inputSchema: { type: "object", properties: {} },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === "always_throws") {
    throw new Error("the target refused");
  }
  if (name === "answers_with_error") {
    return { content: [{ type: "text", text: "the tool failed" }], isError: true };
  }
  return {
    content: [{ type: "text", text: `${name} called with ${JSON.stringify(args ?? {})}` }],
  };
});

await server.connect(new StdioServerTransport());
