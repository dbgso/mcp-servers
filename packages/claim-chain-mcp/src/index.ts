#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseArgs, runCheck } from "./cli.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const invocation = parseArgs({ argv: process.argv.slice(2), cwd: process.cwd() });

  if (invocation.command === "check") {
    process.exitCode = await runCheck({ root: invocation.root, print: (text) => console.log(text) });
    return;
  }

  await createServer({ root: invocation.root }).connect(new StdioServerTransport());
  console.error(`claim-chain-mcp serving ${invocation.root}`);
}

main().catch((error: unknown) => {
  console.error("claim-chain-mcp failed:", error);
  process.exit(1);
});
