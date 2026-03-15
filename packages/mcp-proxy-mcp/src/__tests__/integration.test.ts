import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";

const DIST_DIR = join(import.meta.dirname, "../../dist");
const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

// Test rules file content
const TEST_RULES = {
  rules: [
    {
      id: "allow-describe",
      priority: 100,
      action: "allow",
      toolPattern: "git_describe",
      description: "Allow git_describe",
    },
    {
      id: "block-log",
      priority: 90,
      action: "deny",
      toolPattern: "git_execute",
      conditions: [{ param: "operation", operator: "equals", value: "log" }],
      description: "Block git log operation",
    },
    {
      id: "allow-git-execute",
      priority: 50,
      action: "allow",
      toolPattern: "git_execute",
      description: "Allow other git operations",
    },
  ],
  defaultAction: "deny",
};

describe("mcp-proxy-mcp Integration Tests", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let rulesFilePath: string;

  beforeAll(async () => {
    // Create fixtures directory if not exists
    if (!existsSync(FIXTURES_DIR)) {
      const { mkdirSync } = await import("node:fs");
      mkdirSync(FIXTURES_DIR, { recursive: true });
    }

    // Write test rules file
    rulesFilePath = join(FIXTURES_DIR, "test-rules.json");
    writeFileSync(rulesFilePath, JSON.stringify(TEST_RULES, null, 2));

    // Setup transport and client
    transport = new StdioClientTransport({
      command: "node",
      args: [
        join(DIST_DIR, "index.js"),
        "--command",
        "node",
        "--args",
        join(import.meta.dirname, "../../../git-repo-explorer-mcp/dist/index.js"),
        "--rules-file",
        rulesFilePath,
      ],
      stderr: "pipe",
    });

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await transport.close();
    // Cleanup rules file
    if (existsSync(rulesFilePath)) {
      unlinkSync(rulesFilePath);
    }
  });

  describe("Tool listing", () => {
    it("should list proxy management tools and proxy_execute", async () => {
      const result = await client.listTools();
      const toolNames = result.tools.map((t) => t.name);

      // Proxy management tools
      expect(toolNames).toContain("proxy_rule_list");
      expect(toolNames).toContain("proxy_rule_add");
      expect(toolNames).toContain("proxy_rule_remove");
      expect(toolNames).toContain("proxy_rule_update");
      expect(toolNames).toContain("proxy_rule_test");
      expect(toolNames).toContain("proxy_status");
      expect(toolNames).toContain("proxy_set_default");

      // Single proxy_execute tool instead of individual tools
      expect(toolNames).toContain("proxy_execute");

      // Should NOT contain individual proxied tools
      expect(toolNames).not.toContain("git_describe");
      expect(toolNames).not.toContain("git_execute");
    });
  });

  describe("Rule evaluation", () => {
    it("should allow tool when rule matches with allow action", async () => {
      const result = await client.callTool({
        name: "proxy_execute",
        arguments: { toolName: "git_describe", args: {} },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).toContain("Git Operations");
    });

    it("should block tool when rule matches with deny action", async () => {
      const result = await client.callTool({
        name: "proxy_execute",
        arguments: { toolName: "git_execute", args: { operation: "log" } },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).toContain("[BLOCKED]");
      expect(text).toContain("Block git log operation");
    });

    it("should allow tool when condition does not match deny rule", async () => {
      const result = await client.callTool({
        name: "proxy_execute",
        arguments: { toolName: "git_execute", args: { operation: "diff" } },
      });

      // Should not be blocked (may error from git-repo-explorer if params missing, but not [BLOCKED])
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).not.toContain("[BLOCKED]");
    });
  });

  describe("proxy_rule_list", () => {
    it("should return current rules", async () => {
      const result = await client.callTool({
        name: "proxy_rule_list",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      const parsed = JSON.parse(text);

      expect(parsed.defaultAction).toBe("deny");
      expect(parsed.rulesCount).toBe(3);
      expect(parsed.rules[0].id).toBe("allow-describe");
    });
  });

  describe("proxy_rule_add and proxy_rule_remove", () => {
    it("should add and remove rules dynamically", async () => {
      // Add a new deny rule
      const addResult = await client.callTool({
        name: "proxy_rule_add",
        arguments: {
          priority: 200,
          action: "deny",
          toolPattern: "git_describe",
          description: "Temporarily block git_describe",
        },
      });

      expect(addResult.isError).toBeFalsy();
      const addText = (addResult.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(addText).toContain("Rule created");

      // Extract the new rule ID
      const match = addText.match(/"id":\s*"([^"]+)"/);
      const newRuleId = match?.[1];
      expect(newRuleId).toBeDefined();

      // Verify git_describe is now blocked
      const blockedResult = await client.callTool({
        name: "proxy_execute",
        arguments: { toolName: "git_describe", args: {} },
      });
      expect(blockedResult.isError).toBe(true);
      const blockedText = (blockedResult.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(blockedText).toContain("[BLOCKED]");

      // Remove the rule
      const removeResult = await client.callTool({
        name: "proxy_rule_remove",
        arguments: { id: newRuleId },
      });
      expect(removeResult.isError).toBeFalsy();
      const removeText = (removeResult.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(removeText).toContain("Rule removed");

      // Verify git_describe is allowed again
      const allowedResult = await client.callTool({
        name: "proxy_execute",
        arguments: { toolName: "git_describe", args: {} },
      });
      expect(allowedResult.isError).toBeFalsy();
      const allowedText = (allowedResult.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(allowedText).toContain("Git Operations");
    });
  });

  describe("proxy_rule_update", () => {
    it("should update an existing rule", async () => {
      // Add a rule first
      const addResult = await client.callTool({
        name: "proxy_rule_add",
        arguments: {
          priority: 150,
          action: "allow",
          toolPattern: "git_*",
          description: "Allow all git operations",
        },
      });

      const addText = (addResult.content as Array<{ type: string; text: string }>)[0]?.text;
      const match = addText.match(/"id":\s*"([^"]+)"/);
      const ruleId = match?.[1];
      expect(ruleId).toBeDefined();

      // Update the rule to deny
      const updateResult = await client.callTool({
        name: "proxy_rule_update",
        arguments: {
          id: ruleId,
          action: "deny",
          description: "Changed to deny all git operations",
        },
      });

      expect(updateResult.isError).toBeFalsy();
      const updateText = (updateResult.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(updateText).toContain("Rule updated");
      expect(updateText).toContain("deny");
      expect(updateText).toContain("Changed to deny all git operations");

      // Verify the rule list shows updated values
      const listResult = await client.callTool({
        name: "proxy_rule_list",
        arguments: {},
      });
      const listText = (listResult.content as Array<{ type: string; text: string }>)[0]?.text;
      const parsed = JSON.parse(listText);
      const updatedRule = parsed.rules.find((r: { id: string }) => r.id === ruleId);
      expect(updatedRule.action).toBe("deny");
      expect(updatedRule.description).toBe("Changed to deny all git operations");

      // Cleanup: remove the rule
      await client.callTool({
        name: "proxy_rule_remove",
        arguments: { id: ruleId },
      });
    });

    it("should return error for non-existent rule", async () => {
      const updateResult = await client.callTool({
        name: "proxy_rule_update",
        arguments: {
          id: "non-existent-rule-id",
          action: "deny",
        },
      });

      expect(updateResult.isError).toBe(true);
      const text = (updateResult.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).toContain("Rule not found");
    });
  });

  describe("proxy_rule_test", () => {
    it("should test rule evaluation without executing", async () => {
      const result = await client.callTool({
        name: "proxy_rule_test",
        arguments: {
          toolName: "git_execute",
          args: { operation: "log" },
        },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      const parsed = JSON.parse(text);

      expect(parsed.action).toBe("deny");
      expect(parsed.matchedRule.id).toBe("block-log");
    });
  });

  describe("proxy_status", () => {
    it("should return proxy status", async () => {
      const result = await client.callTool({
        name: "proxy_status",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      const parsed = JSON.parse(text);

      expect(parsed.connected).toBe(true);
      expect(parsed.dryRun).toBe(false);
      expect(parsed.rulesCount).toBeGreaterThanOrEqual(3);
      expect(parsed.defaultAction).toBe("deny");
    });
  });
});

describe("mcp-proxy-mcp Dry-run Mode", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let rulesFilePath: string;

  beforeAll(async () => {
    // Write test rules file
    rulesFilePath = join(FIXTURES_DIR, "test-rules-dryrun.json");
    writeFileSync(rulesFilePath, JSON.stringify(TEST_RULES, null, 2));

    // Setup transport with --dry-run flag
    transport = new StdioClientTransport({
      command: "node",
      args: [
        join(DIST_DIR, "index.js"),
        "--command",
        "node",
        "--args",
        join(import.meta.dirname, "../../../git-repo-explorer-mcp/dist/index.js"),
        "--rules-file",
        rulesFilePath,
        "--dry-run",
      ],
      stderr: "pipe",
    });

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await transport.close();
    if (existsSync(rulesFilePath)) {
      unlinkSync(rulesFilePath);
    }
  });

  it("should not block in dry-run mode but add note", async () => {
    const result = await client.callTool({
      name: "proxy_execute",
      arguments: { toolName: "git_execute", args: { operation: "log", params: { limit: 1 } } },
    });

    // Should NOT be an error (not blocked)
    expect(result.isError).toBeFalsy();

    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toContain("[DRY-RUN NOTE]");
    expect(text).toContain("would be blocked");
  });

  it("should show dryRun: true in status", async () => {
    const result = await client.callTool({
      name: "proxy_status",
      arguments: {},
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    const parsed = JSON.parse(text);

    expect(parsed.dryRun).toBe(true);
  });
});

// Test rules with ask action
const ASK_RULES = {
  rules: [
    {
      id: "ask-git-log",
      priority: 100,
      action: "ask",
      toolPattern: "git_execute",
      conditions: [{ param: "operation", operator: "equals", value: "log" }],
      description: "Ask before git log",
    },
    {
      id: "allow-git",
      priority: 50,
      action: "allow",
      toolPattern: "git_*",
      description: "Allow other git operations",
    },
  ],
  defaultAction: "deny",
};

describe("mcp-proxy-mcp Ask Action", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let rulesFilePath: string;

  beforeAll(async () => {
    // Write test rules file
    rulesFilePath = join(FIXTURES_DIR, "test-rules-ask.json");
    writeFileSync(rulesFilePath, JSON.stringify(ASK_RULES, null, 2));

    // Setup transport
    transport = new StdioClientTransport({
      command: "node",
      args: [
        join(DIST_DIR, "index.js"),
        "--command",
        "node",
        "--args",
        join(import.meta.dirname, "../../../git-repo-explorer-mcp/dist/index.js"),
        "--rules-file",
        rulesFilePath,
      ],
      stderr: "pipe",
    });

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await transport.close();
    if (existsSync(rulesFilePath)) {
      unlinkSync(rulesFilePath);
    }
  });

  it("should require approval when ask rule matches", async () => {
    const result = await client.callTool({
      name: "proxy_execute",
      arguments: { toolName: "git_execute", args: { operation: "log", params: { limit: 1 } } },
    });

    // Should not be an error, but require approval
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toContain("[APPROVAL REQUIRED]");
    expect(text).toContain("Request ID:");
    expect(text).toContain("proxy_approve");
  });

  it("should list pending approvals with proxy_pending", async () => {
    // First, trigger an ask rule
    await client.callTool({
      name: "proxy_execute",
      arguments: { toolName: "git_execute", args: { operation: "log", params: { limit: 2 } } },
    });

    // List pending
    const result = await client.callTool({
      name: "proxy_pending",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    const parsed = JSON.parse(text);

    expect(parsed.count).toBeGreaterThanOrEqual(1);
    expect(parsed.pending[0].toolName).toBe("git_execute");
  });

  it("should reject pending call with proxy_reject", async () => {
    // Trigger an ask rule
    const askResult = await client.callTool({
      name: "proxy_execute",
      arguments: { toolName: "git_execute", args: { operation: "log", params: { limit: 3 } } },
    });

    // Extract request ID
    const askText = (askResult.content as Array<{ type: string; text: string }>)[0]?.text;
    const match = askText.match(/Request ID:\s*(\S+)/);
    const requestId = match?.[1];
    expect(requestId).toBeDefined();

    // Reject the request
    const rejectResult = await client.callTool({
      name: "proxy_reject",
      arguments: { requestId },
    });

    expect(rejectResult.isError).toBeFalsy();
    const rejectText = (rejectResult.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(rejectText).toContain("[REJECTED]");
  });

  it("should fail approval with invalid token", async () => {
    // Trigger an ask rule
    const askResult = await client.callTool({
      name: "proxy_execute",
      arguments: { toolName: "git_execute", args: { operation: "log", params: { limit: 4 } } },
    });

    // Extract request ID
    const askText = (askResult.content as Array<{ type: string; text: string }>)[0]?.text;
    const match = askText.match(/Request ID:\s*(\S+)/);
    const requestId = match?.[1];

    // Try to approve with wrong token
    const approveResult = await client.callTool({
      name: "proxy_approve",
      arguments: { requestId, approvalToken: "9999" },
    });

    expect(approveResult.isError).toBe(true);
    const approveText = (approveResult.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(approveText).toContain("[APPROVAL FAILED]");
  });

  it("should list proxy management tools including ask-related tools", async () => {
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);

    expect(toolNames).toContain("proxy_pending");
    expect(toolNames).toContain("proxy_approve");
    expect(toolNames).toContain("proxy_reject");
  });
});
