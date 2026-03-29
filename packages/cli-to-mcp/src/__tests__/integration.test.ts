import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const DIST_DIR = join(import.meta.dirname, "../../dist");

describe("cli-to-mcp Integration Tests", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: "node",
      args: [join(DIST_DIR, "index.js")],
      stderr: "pipe",
    });

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await transport.close();
  });

  describe("Tool listing", () => {
    it("should list cli_execute, cli_help, and cli_status tools", async () => {
      const result = await client.listTools();
      const toolNames = result.tools.map((t) => t.name);

      expect(toolNames).toContain("cli_execute");
      expect(toolNames).toContain("cli_help");
      expect(toolNames).toContain("cli_status");
    });
  });

  describe("cli_execute", () => {
    it("should execute echo command with string args", async () => {
      const result = await client.callTool({
        name: "cli_execute",
        arguments: { command: "echo", args: "hello world" },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).toContain("hello world");
      expect(text).toContain("Exit code: 0");
    });

    it("should execute echo command with array args", async () => {
      const result = await client.callTool({
        name: "cli_execute",
        arguments: { command: "echo", args: ["hello", "world"] },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).toContain("hello world");
    });

    it("should execute ls command", async () => {
      const result = await client.callTool({
        name: "cli_execute",
        arguments: { command: "ls", args: "-la" },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).toContain("Exit code: 0");
    });

    it("should execute command without args", async () => {
      const result = await client.callTool({
        name: "cli_execute",
        arguments: { command: "pwd" },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).toContain("Exit code: 0");
    });

    it("should return error for non-existent command", async () => {
      const result = await client.callTool({
        name: "cli_execute",
        arguments: { command: "nonexistent-command-12345" },
      });

      expect(result.isError).toBeTruthy();
    });

    it("should handle options parameter", async () => {
      const result = await client.callTool({
        name: "cli_execute",
        arguments: {
          command: "echo",
          args: ["hello"],
          options: { n: true }  // -n flag for echo (no newline)
        },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).toContain("-n");
    });

    it("should handle long options", async () => {
      const result = await client.callTool({
        name: "cli_execute",
        arguments: {
          command: "ls",
          args: ["/tmp"],
          options: { all: true, "human-readable": true }
        },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).toContain("--all");
      expect(text).toContain("--human-readable");
    });

    it("should handle options with values", async () => {
      const result = await client.callTool({
        name: "cli_execute",
        arguments: {
          command: "echo",
          options: { e: "hello world" }  // This won't work with echo but tests the format
        },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).toContain("-e");
      expect(text).toContain("hello world");
    });

    it("should handle array options (repeatable)", async () => {
      const result = await client.callTool({
        name: "cli_execute",
        arguments: {
          command: "echo",
          options: { e: ["value1", "value2"] }
        },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).toContain("-e value1 -e value2");
    });
  });

  describe("cli_help", () => {
    it("should get help for ls command", async () => {
      const result = await client.callTool({
        name: "cli_help",
        arguments: { command: "ls" },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text.length).toBeGreaterThan(0);
    });

    it("should get help for git subcommand", async () => {
      const result = await client.callTool({
        name: "cli_help",
        arguments: { command: "git", subcommand: "status" },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text.length).toBeGreaterThan(0);
    });

    it("should return error for non-existent command", async () => {
      const result = await client.callTool({
        name: "cli_help",
        arguments: { command: "nonexistent-command-xyz-12345" },
      });

      expect(result.isError).toBeTruthy();
    });
  });

  describe("cli_status", () => {
    it("should return status", async () => {
      const result = await client.callTool({
        name: "cli_status",
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      const status = JSON.parse(text);

      expect(status.timeout).toBe(30000);
      expect(status.cwd).toBeDefined();
    });
  });
});

describe("cli-to-mcp with --cwd option", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: "node",
      args: [join(DIST_DIR, "index.js"), "--cwd", "/tmp"],
      stderr: "pipe",
    });

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await transport.close();
  });

  it("should use specified cwd", async () => {
    const result = await client.callTool({
      name: "cli_execute",
      arguments: { command: "pwd" },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toContain("/tmp");
  });
});

describe("cli-to-mcp with --config option", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let configPath: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "cli-to-mcp-test-"));
    configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ cwd: "/tmp", timeout: 5000 }));

    transport = new StdioClientTransport({
      command: "node",
      args: [join(DIST_DIR, "index.js"), "--config", configPath],
      stderr: "pipe",
    });

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await transport.close();
    unlinkSync(configPath);
  });

  it("should use config file settings", async () => {
    const result = await client.callTool({
      name: "cli_status",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    const status = JSON.parse(text);

    expect(status.cwd).toBe("/tmp");
    expect(status.timeout).toBe(5000);
  });
});
