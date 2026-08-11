import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { errorResponse } from "mcp-shared";
import { getToolRegistry } from "./tools/registry.js";
import { VERSION } from "./version.js";

export const SERVER_NAME = "duckdb-mcp";
export const SERVER_VERSION = VERSION;

export function createServer(): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  const registry = getToolRegistry();

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: registry.getAllTools() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = registry.getHandler(name);
    if (!handler) {
      return errorResponse(`Unknown tool: ${name}`);
    }
    return handler.execute(args);
  });

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} started`);
}
