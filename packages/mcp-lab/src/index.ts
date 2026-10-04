#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, installShutdown } from "./server.js";

async function main(): Promise<void> {
  const { server, store } = createServer();

  installShutdown({
    store,
    on: ({ signal, handler }) => {
      process.on(signal, handler);
    },
    exit: () => process.exit(0),
  });

  await server.connect(new StdioServerTransport());
  console.error("mcp-lab server started");
}

main().catch((error: unknown) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
