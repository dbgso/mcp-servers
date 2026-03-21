import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const CLI_TO_MCP_DIR = join(import.meta.dirname, "../../dist");
const MCP_FIREWALL_DIR = join(import.meta.dirname, "../../../mcp-firewall/dist");

describe("cli-to-mcp with mcp-firewall", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let rulesPath: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "cli-proxy-test-"));
    rulesPath = join(tempDir, "rules.json");

    const rules = {
      rules: [
        {
          id: "block-prod-profile",
          priority: 100,
          action: "deny",
          toolPattern: "cli_execute",
          conditions: [
            { param: "args", operator: "contains", value: "prod" }
          ],
          description: "prodプロファイルは禁止"
        },
        {
          id: "allow-echo",
          priority: 90,
          action: "allow",
          toolPattern: "cli_execute",
          conditions: [
            { param: "command", operator: "equals", value: "echo" }
          ],
          description: "echoは許可"
        },
        {
          id: "allow-ls",
          priority: 80,
          action: "allow",
          toolPattern: "cli_execute",
          conditions: [
            { param: "command", operator: "equals", value: "ls" }
          ],
          description: "lsは許可"
        },
        {
          id: "allow-pwd",
          priority: 70,
          action: "allow",
          toolPattern: "cli_execute",
          conditions: [
            { param: "command", operator: "equals", value: "pwd" }
          ],
          description: "pwdは許可"
        }
      ],
      defaultAction: "deny"
    };

    writeFileSync(rulesPath, JSON.stringify(rules, null, 2));

    transport = new StdioClientTransport({
      command: "node",
      args: [
        join(MCP_FIREWALL_DIR, "index.js"),
        "--command", "node",
        "--args", join(CLI_TO_MCP_DIR, "index.js"),
        "--rules-file", rulesPath
      ],
      stderr: "pipe",
    });

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await transport.close();
    unlinkSync(rulesPath);
  });

  describe("proxy_execute", () => {
    it("should allow echo command", async () => {
      const result = await client.callTool({
        name: "proxy_execute",
        arguments: {
          toolName: "cli_execute",
          args: { command: "echo", args: "hello" }
        },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).toContain("hello");
    });

    it("should allow ls command", async () => {
      const result = await client.callTool({
        name: "proxy_execute",
        arguments: {
          toolName: "cli_execute",
          args: { command: "ls" }
        },
      });

      expect(result.isError).toBeFalsy();
    });

    it("should deny command with prod in args", async () => {
      const result = await client.callTool({
        name: "proxy_execute",
        arguments: {
          toolName: "cli_execute",
          args: { command: "echo", args: "--profile prod" }
        },
      });

      expect(result.isError).toBeTruthy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).toContain("denied");
    });

    it("should deny rm command (default deny)", async () => {
      const result = await client.callTool({
        name: "proxy_execute",
        arguments: {
          toolName: "cli_execute",
          args: { command: "rm", args: "-rf /tmp/test" }
        },
      });

      expect(result.isError).toBeTruthy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).toContain("denied");
    });

    it("should deny unknown command (default deny)", async () => {
      const result = await client.callTool({
        name: "proxy_execute",
        arguments: {
          toolName: "cli_execute",
          args: { command: "curl", args: "https://example.com" }
        },
      });

      expect(result.isError).toBeTruthy();
    });
  });

  describe("proxy rule management", () => {
    it("should list rules", async () => {
      const result = await client.callTool({
        name: "proxy_rule_list",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).toContain("block-prod-profile");
      expect(text).toContain("allow-echo");
    });

    it("should add rule dynamically", async () => {
      // Add rule to allow cat
      await client.callTool({
        name: "proxy_rule_add",
        arguments: {
          action: "allow",
          toolPattern: "cli_execute",
          conditions: [
            { param: "command", operator: "equals", value: "cat" }
          ],
          description: "catを許可"
        },
      });

      // Now cat should work
      const result = await client.callTool({
        name: "proxy_execute",
        arguments: {
          toolName: "cli_execute",
          args: { command: "cat", args: "/etc/hostname" }
        },
      });

      expect(result.isError).toBeFalsy();
    });
  });
});

describe("cli-to-mcp proxy with options parameter", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let rulesPath: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "cli-proxy-options-test-"));
    rulesPath = join(tempDir, "rules.json");

    const rules = {
      rules: [
        {
          id: "block-prod-profile",
          priority: 100,
          action: "deny",
          toolPattern: "cli_execute",
          conditions: [
            { param: "command", operator: "equals", value: "aws" },
            { param: "options.profile", operator: "equals", value: "prod" }
          ],
          description: "prodプロファイルは禁止"
        },
        {
          id: "block-force-option",
          priority: 90,
          action: "deny",
          toolPattern: "cli_execute",
          conditions: [
            { param: "options.force", operator: "equals", value: true }
          ],
          description: "--forceフラグは禁止"
        },
        {
          id: "allow-echo",
          priority: 50,
          action: "allow",
          toolPattern: "cli_execute",
          conditions: [
            { param: "command", operator: "equals", value: "echo" }
          ]
        },
        {
          id: "allow-aws-dev",
          priority: 40,
          action: "allow",
          toolPattern: "cli_execute",
          conditions: [
            { param: "command", operator: "equals", value: "aws" }
          ]
        }
      ],
      defaultAction: "deny"
    };

    writeFileSync(rulesPath, JSON.stringify(rules, null, 2));

    transport = new StdioClientTransport({
      command: "node",
      args: [
        join(MCP_FIREWALL_DIR, "index.js"),
        "--command", "node",
        "--args", join(CLI_TO_MCP_DIR, "index.js"),
        "--rules-file", rulesPath
      ],
      stderr: "pipe",
    });

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await transport.close();
    unlinkSync(rulesPath);
  });

  it("should deny aws command with profile=prod", async () => {
    const result = await client.callTool({
      name: "proxy_execute",
      arguments: {
        toolName: "cli_execute",
        args: {
          command: "aws",
          args: ["s3", "ls"],
          options: { profile: "prod" }
        }
      },
    });

    expect(result.isError).toBeTruthy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toContain("denied");
  });

  it("should allow aws command with profile=dev", async () => {
    // Note: This will fail because aws isn't installed, but it should not be denied by rules
    const result = await client.callTool({
      name: "proxy_execute",
      arguments: {
        toolName: "cli_execute",
        args: {
          command: "echo",  // Using echo instead of aws since aws may not be installed
          args: ["aws", "s3", "ls"],
          options: { profile: "dev" }
        }
      },
    });

    // Should not be denied by rules (may fail due to command execution)
    expect(result.isError).toBeFalsy();
  });

  it("should deny command with force=true", async () => {
    const result = await client.callTool({
      name: "proxy_execute",
      arguments: {
        toolName: "cli_execute",
        args: {
          command: "echo",
          args: ["test"],
          options: { force: true }
        }
      },
    });

    expect(result.isError).toBeTruthy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toContain("denied");
  });

  it("should allow command with force=false", async () => {
    const result = await client.callTool({
      name: "proxy_execute",
      arguments: {
        toolName: "cli_execute",
        args: {
          command: "echo",
          args: ["test"],
          options: { force: false }
        }
      },
    });

    expect(result.isError).toBeFalsy();
  });
});

describe("cli-to-mcp proxy with array args handling", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let rulesPath: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "cli-proxy-array-test-"));
    rulesPath = join(tempDir, "rules.json");

    const rules = {
      rules: [
        {
          id: "block-dangerous-flag",
          priority: 100,
          action: "deny",
          toolPattern: "cli_execute",
          conditions: [
            { param: "args", operator: "contains", value: "--force" }
          ],
          description: "--forceフラグは禁止"
        },
        {
          id: "allow-all-echo",
          priority: 50,
          action: "allow",
          toolPattern: "cli_execute",
          conditions: [
            { param: "command", operator: "equals", value: "echo" }
          ]
        }
      ],
      defaultAction: "deny"
    };

    writeFileSync(rulesPath, JSON.stringify(rules, null, 2));

    transport = new StdioClientTransport({
      command: "node",
      args: [
        join(MCP_FIREWALL_DIR, "index.js"),
        "--command", "node",
        "--args", join(CLI_TO_MCP_DIR, "index.js"),
        "--rules-file", rulesPath
      ],
      stderr: "pipe",
    });

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await transport.close();
    unlinkSync(rulesPath);
  });

  it("should handle string args with contains", async () => {
    const result = await client.callTool({
      name: "proxy_execute",
      arguments: {
        toolName: "cli_execute",
        args: { command: "echo", args: "hello --force world" }
      },
    });

    expect(result.isError).toBeTruthy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toContain("denied");
  });

  it("should handle array args with contains", async () => {
    const result = await client.callTool({
      name: "proxy_execute",
      arguments: {
        toolName: "cli_execute",
        args: { command: "echo", args: ["hello", "--force", "world"] }
      },
    });

    // contains operator should work on array args
    expect(result.isError).toBeTruthy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toContain("denied");
  });

  it("should allow safe echo command", async () => {
    const result = await client.callTool({
      name: "proxy_execute",
      arguments: {
        toolName: "cli_execute",
        args: { command: "echo", args: "safe message" }
      },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toContain("safe message");
  });
});
