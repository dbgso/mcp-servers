import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { errorResponse } from "mcp-shared";
import { getToolRegistry } from "./tools/index.js";

const server = new Server(
  {
    name: "ast-file-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const registry = getToolRegistry();
  return {
    tools: registry.getAllTools(),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const registry = getToolRegistry();
  const handler = registry.getHandler(name);

  if (!handler) {
    return errorResponse(`Unknown tool: ${name}`);
  }

  return handler.execute(args);
});

export async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ast-file-mcp server started");
}
