#!/usr/bin/env node
// Test dry-run mode
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("Testing DRY-RUN mode...\n");

  const transport = new StdioClientTransport({
    command: "node",
    args: [
      join(__dirname, "dist/index.js"),
      "--command", "node",
      "--args", join(__dirname, "../git-repo-explorer-mcp/dist/index.js"),
      "--rules-file", join(__dirname, "test-rules.json"),
      "--dry-run",  // Enable dry-run mode
    ],
    stderr: "inherit",
  });

  const client = new Client({ name: "test-client", version: "1.0.0" });

  try {
    await client.connect(transport);
    console.log("Connected to proxy (dry-run mode)\n");

    // Test: git_execute log (should be logged but NOT blocked)
    console.log("Test: git_execute log (should NOT be blocked in dry-run)");
    const result = await client.callTool({
      name: "git_execute",
      arguments: { operation: "log", params: { limit: 1 } },
    });
    console.log("Result:", result.content?.[0]?.text?.substring(0, 200));
    console.log("isError:", result.isError);
    console.log("");

    // Check status shows dryRun: true
    console.log("Test: proxy_status (should show dryRun: true)");
    const status = await client.callTool({ name: "proxy_status", arguments: {} });
    console.log("Result:", status.content?.[0]?.text);

  } finally {
    await transport.close();
  }
}

main().catch(console.error);
