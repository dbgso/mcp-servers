import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { errorResponse } from "mcp-shared";
import { getToolRegistry } from "./tools/index.js";
import { VERSION } from "./version.js";

/**
 * Exported so the tool routing can be driven over an in-memory transport.
 * `startServer` is the only other way in, and it binds this process's stdin.
 */
export const server = new Server(
  {
    name: "ast-typescript-mcp",
    version: VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const registry = getToolRegistry();

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: registry.getAllTools(),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const handler = registry.getHandler(name);
  if (!handler) {
    return errorResponse(`Unknown tool: ${name}`);
  }

  return handler.execute(args);
});

export async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ast-typescript-mcp server started");
}
