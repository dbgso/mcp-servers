import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { errorResponse } from "mcp-shared";
import { ChainManager } from "./chain-manager.js";
import type { ChainConfig } from "./types.js";
import { createToolRegistry } from "./tools/index.js";

export function createServer(config: ChainConfig) {
  const manager = new ChainManager(config);
  const registry = createToolRegistry(manager);

  const server = new Server(
    {
      name: "mcp-traceable-chain",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

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

  return server;
}

export async function startServer(config: ChainConfig) {
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-traceable-chain server started");
}
