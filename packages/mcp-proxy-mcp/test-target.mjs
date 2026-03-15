#!/usr/bin/env node
// Simple test MCP server for testing mcp-proxy-mcp
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "test-target",
  version: "1.0.0",
});

// Test tool 1: echo
server.registerTool(
  "echo",
  {
    description: "Echo the message back",
    inputSchema: z.object({
      message: z.string(),
    }),
  },
  async (args) => ({
    content: [{ type: "text", text: `Echo: ${args.message}` }],
  })
);

// Test tool 2: dangerous_delete
server.registerTool(
  "dangerous_delete",
  {
    description: "A dangerous delete operation",
    inputSchema: z.object({
      target: z.string(),
    }),
  },
  async (args) => ({
    content: [{ type: "text", text: `Deleted: ${args.target}` }],
  })
);

// Test tool 3: browser_click (simulating playwright)
server.registerTool(
  "browser_click",
  {
    description: "Click an element",
    inputSchema: z.object({
      ref: z.string(),
    }),
  },
  async (args) => ({
    content: [{ type: "text", text: `Clicked: ${args.ref}` }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
