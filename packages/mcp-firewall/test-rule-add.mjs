#!/usr/bin/env node
// Test rule add/remove
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { copyFileSync, unlinkSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Copy rules file to avoid modifying original
const tempRulesFile = join(__dirname, "test-rules-temp.json");
copyFileSync(join(__dirname, "test-rules.json"), tempRulesFile);

async function main() {
  console.log("Testing rule add/remove...\n");

  const transport = new StdioClientTransport({
    command: "node",
    args: [
      join(__dirname, "dist/index.js"),
      "--command", "node",
      "--args", join(__dirname, "../git-repo-explorer-mcp/dist/index.js"),
      "--rules-file", tempRulesFile,
    ],
    stderr: "inherit",
  });

  const client = new Client({ name: "test-client", version: "1.0.0" });

  try {
    await client.connect(transport);
    console.log("Connected\n");

    // 1. List current rules
    console.log("=== 1. Current rules ===");
    let list = await client.callTool({ name: "proxy_rule_list", arguments: {} });
    const parsed = JSON.parse(list.content?.[0]?.text);
    console.log(`Rules count: ${parsed.rulesCount}`);
    console.log("");

    // 2. Add a new deny rule
    console.log("=== 2. Add deny rule (block git_describe) ===");
    const addResult = await client.callTool({
      name: "proxy_rule_add",
      arguments: {
        priority: 200,
        action: "deny",
        toolPattern: "git_describe",
        description: "Temporarily block git_describe"
      }
    });
    console.log("Result:", addResult.content?.[0]?.text);
    console.log("");

    // 3. Test git_describe (should be BLOCKED now)
    console.log("=== 3. Test git_describe (should be BLOCKED) ===");
    const testResult = await client.callTool({ name: "git_describe", arguments: {} });
    console.log("Result:", testResult.content?.[0]?.text?.substring(0, 100));
    console.log("isError:", testResult.isError);
    console.log("");

    // 4. List rules again (should have 4 rules)
    console.log("=== 4. List rules (should have 4) ===");
    list = await client.callTool({ name: "proxy_rule_list", arguments: {} });
    const parsed2 = JSON.parse(list.content?.[0]?.text);
    console.log(`Rules count: ${parsed2.rulesCount}`);
    const newRule = parsed2.rules.find(r => r.description === "Temporarily block git_describe");
    console.log(`New rule ID: ${newRule?.id}`);
    console.log("");

    // 5. Remove the rule
    console.log("=== 5. Remove the rule ===");
    const removeResult = await client.callTool({
      name: "proxy_rule_remove",
      arguments: { id: newRule.id }
    });
    console.log("Result:", removeResult.content?.[0]?.text);
    console.log("");

    // 6. Test git_describe again (should be ALLOWED now)
    console.log("=== 6. Test git_describe (should be ALLOWED) ===");
    const testResult2 = await client.callTool({ name: "git_describe", arguments: {} });
    console.log("Result:", testResult2.content?.[0]?.text?.substring(0, 100));
    console.log("isError:", testResult2.isError);

  } finally {
    await transport.close();
    // Cleanup temp file
    try { unlinkSync(tempRulesFile); } catch {}
  }
}

main().catch(console.error);
