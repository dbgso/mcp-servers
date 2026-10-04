#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseCli } from "./cli.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const { outputDir } = parseCli({ argv: process.argv.slice(2) });
  await createServer({ outputDir }).connect(new StdioServerTransport());
  console.error(`report-mcp started; reports go to ${outputDir}`);
}

main().catch((error: unknown) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
