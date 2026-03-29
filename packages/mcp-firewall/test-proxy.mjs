#!/usr/bin/env node
// Test script for mcp-firewall
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("Starting proxy test...\n");

  // Connect to the proxy server
  const transport = new StdioClientTransport({
    command: "node",
    args: [
      join(__dirname, "dist/index.js"),
      "--command", "node",
      "--args", join(__dirname, "../git-repo-explorer-mcp/dist/index.js"),
      "--rules-file", join(__dirname, "test-rules.json"),
    ],
    stderr: "inherit",
  });

  const client = new Client({ name: "test-client", version: "1.0.0" });

  try {
    await client.connect(transport);
    console.log("Connected to proxy\n");

    // List tools
    const tools = await client.listTools();
    console.log("Available tools:", tools.tools.map(t => t.name).join(", "));
    console.log("");

    // Test 1: git_describe (should be allowed)
    console.log("Test 1: git_describe (should be ALLOWED)");
    const result1 = await client.callTool({ name: "git_describe", arguments: {} });
    console.log("Result:", result1.content?.[0]?.text?.substring(0, 100) + "...");
    console.log("");

    // Test 2: git_execute with status (should be allowed)
    console.log("Test 2: git_execute status (should be ALLOWED)");
    const result2 = await client.callTool({
      name: "git_execute",
      arguments: { operation: "status" },
    });
    console.log("Result:", result2.content?.[0]?.text?.substring(0, 100) + "...");
    console.log("");

    // Test 3: git_execute with log (should be BLOCKED)
    console.log("Test 3: git_execute log (should be BLOCKED)");
    const result3 = await client.callTool({
      name: "git_execute",
      arguments: { operation: "log" },
    });
    console.log("Result:", result3.content?.[0]?.text);
    console.log("isError:", result3.isError);
    console.log("");

    // Test 4: proxy_rule_list
    console.log("Test 4: proxy_rule_list");
    const result4 = await client.callTool({ name: "proxy_rule_list", arguments: {} });
    console.log("Result:", result4.content?.[0]?.text);

  } finally {
    await transport.close();
  }
}

main().catch(console.error);
