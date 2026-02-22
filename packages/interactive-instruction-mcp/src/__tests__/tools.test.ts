/**
 * Tool Registration Unit Tests
 *
 * Tests for description, help, and stderr-test tool registration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { registerDescriptionTool } from "../tools/description.js";
import { registerHelpTool } from "../tools/help.js";
import { registerStderrTestTool } from "../tools/stderr-test.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import type { ReminderConfig } from "../types/index.js";

// Import mocked functions from mcp-shared (mocked globally in vitest-setup.ts)
import { requestApproval, validateApproval, resendApprovalNotification } from "mcp-shared";

// Get references to the mocked functions
const mockRequestApproval = vi.mocked(requestApproval);
const mockValidateApproval = vi.mocked(validateApproval);
const mockResendApprovalNotification = vi.mocked(resendApprovalNotification);

const tempBase = path.join(process.cwd(), "src/__tests__/temp-tools");

// Mock McpServer
interface RegisteredTool {
  name: string;
  options: { description: string; inputSchema: object };
  handler: (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
}

function createMockServer(): {
  registerTool: (
    name: string,
    options: { description: string; inputSchema: object },
    handler: (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>
  ) => void;
  getRegisteredTools: () => RegisteredTool[];
  getTool: (name: string) => RegisteredTool | undefined;
} {
  const tools: RegisteredTool[] = [];
  return {
    registerTool: (
      name: string,
      options: { description: string; inputSchema: object },
      handler: (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>
    ) => {
      tools.push({ name, options, handler });
    },
    getRegisteredTools: () => tools,
    getTool: (name: string) => tools.find((t) => t.name === name),
  };
}

describe("registerDescriptionTool", () => {
  const defaultConfig: ReminderConfig = {
    remindMcp: false,
    remindOrganize: false,
    customReminders: [],
    topicForEveryTask: null,
    infoValidSeconds: 60,
  };

  it("should register description tool", () => {
    const mockServer = createMockServer();
    registerDescriptionTool({
      server: mockServer as unknown as Parameters<typeof registerDescriptionTool>[0]["server"],
      config: defaultConfig,
    });

    const tools = mockServer.getRegisteredTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("description");
  });

  it("should return description content when called", async () => {
    const mockServer = createMockServer();
    registerDescriptionTool({
      server: mockServer as unknown as Parameters<typeof registerDescriptionTool>[0]["server"],
      config: defaultConfig,
    });

    const tool = mockServer.getTool("description");
    expect(tool).toBeDefined();

    const result = await tool!.handler({});
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toContain("MCP Interactive Instruction");
    expect(result.content[0].text).toContain("60 seconds");
  });

  it("should use custom infoValidSeconds from config", async () => {
    const customConfig: ReminderConfig = {
      ...defaultConfig,
      infoValidSeconds: 120,
    };

    const mockServer = createMockServer();
    registerDescriptionTool({
      server: mockServer as unknown as Parameters<typeof registerDescriptionTool>[0]["server"],
      config: customConfig,
    });

    const tool = mockServer.getTool("description");
    const result = await tool!.handler({});
    expect(result.content[0].text).toContain("120 seconds");
  });
});

describe("registerHelpTool", () => {
  let reader: MarkdownReader;
  const defaultConfig: ReminderConfig = {
    remindMcp: false,
    remindOrganize: false,
    customReminders: [],
    topicForEveryTask: null,
    infoValidSeconds: 60,
  };

  beforeEach(async () => {
    await fs.mkdir(tempBase, { recursive: true });
    reader = new MarkdownReader(tempBase);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempBase, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should register help tool", () => {
    const mockServer = createMockServer();
    registerHelpTool({
      server: mockServer as unknown as Parameters<typeof registerHelpTool>[0]["server"],
      reader,
      config: defaultConfig,
    });

    const tools = mockServer.getRegisteredTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("help");
  });

  it("should list documents when called without id", async () => {
    // Create a test document
    await fs.writeFile(path.join(tempBase, "test-doc.md"), "# Test Document\n\nContent.");

    const mockServer = createMockServer();
    registerHelpTool({
      server: mockServer as unknown as Parameters<typeof registerHelpTool>[0]["server"],
      reader,
      config: defaultConfig,
    });

    const tool = mockServer.getTool("help");
    const result = await tool!.handler({});
    expect(result.content[0].text).toContain("test-doc");
  });

  it("should read specific document when called with id", async () => {
    await fs.writeFile(path.join(tempBase, "specific-doc.md"), "# Specific Document\n\nThis is the content.");

    const mockServer = createMockServer();
    registerHelpTool({
      server: mockServer as unknown as Parameters<typeof registerHelpTool>[0]["server"],
      reader,
      config: defaultConfig,
    });

    const tool = mockServer.getTool("help");
    const result = await tool!.handler({ id: "specific-doc" });
    expect(result.content[0].text).toContain("Specific Document");
    expect(result.content[0].text).toContain("This is the content");
  });

  it("should return error for non-existent document", async () => {
    const mockServer = createMockServer();
    registerHelpTool({
      server: mockServer as unknown as Parameters<typeof registerHelpTool>[0]["server"],
      reader,
      config: defaultConfig,
    });

    const tool = mockServer.getTool("help");
    const result = await tool!.handler({ id: "non-existent" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("should list category contents when id is a category", async () => {
    // Create a category with documents
    await fs.mkdir(path.join(tempBase, "category"), { recursive: true });
    await fs.writeFile(path.join(tempBase, "category", "doc1.md"), "# Doc 1");
    await fs.writeFile(path.join(tempBase, "category", "doc2.md"), "# Doc 2");

    const mockServer = createMockServer();
    registerHelpTool({
      server: mockServer as unknown as Parameters<typeof registerHelpTool>[0]["server"],
      reader,
      config: defaultConfig,
    });

    const tool = mockServer.getTool("help");
    const result = await tool!.handler({ id: "category" });
    expect(result.content[0].text).toContain("category__doc1");
    expect(result.content[0].text).toContain("category__doc2");
  });

  it("should support recursive listing", async () => {
    await fs.mkdir(path.join(tempBase, "nested", "deep"), { recursive: true });
    await fs.writeFile(path.join(tempBase, "root.md"), "# Root");
    await fs.writeFile(path.join(tempBase, "nested", "level1.md"), "# Level 1");
    await fs.writeFile(path.join(tempBase, "nested", "deep", "level2.md"), "# Level 2");

    const mockServer = createMockServer();
    registerHelpTool({
      server: mockServer as unknown as Parameters<typeof registerHelpTool>[0]["server"],
      reader,
      config: defaultConfig,
    });

    const tool = mockServer.getTool("help");
    const result = await tool!.handler({ recursive: true });
    expect(result.content[0].text).toContain("root");
    expect(result.content[0].text).toContain("nested__level1");
    expect(result.content[0].text).toContain("nested__deep__level2");
  });

  it("should exclude draft directory from listings", async () => {
    await fs.mkdir(path.join(tempBase, "_mcp_drafts"), { recursive: true });
    await fs.writeFile(path.join(tempBase, "public.md"), "# Public");
    await fs.writeFile(path.join(tempBase, "_mcp_drafts", "draft.md"), "# Draft");

    const mockServer = createMockServer();
    registerHelpTool({
      server: mockServer as unknown as Parameters<typeof registerHelpTool>[0]["server"],
      reader,
      config: defaultConfig,
    });

    const tool = mockServer.getTool("help");
    const result = await tool!.handler({});
    expect(result.content[0].text).toContain("public");
    expect(result.content[0].text).not.toContain("_mcp_drafts");
  });
});

describe("registerStderrTestTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestApproval.mockResolvedValue({
      token: "mock-token",
      fallbackPath: "/tmp/mock-pending.txt",
    });
  });

  it("should register stderr_test tool", () => {
    const mockServer = createMockServer();
    registerStderrTestTool({
      server: mockServer as unknown as Parameters<typeof registerStderrTestTool>[0]["server"],
    });

    const tools = mockServer.getRegisteredTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("stderr_test");
  });

  it("should request approval by default", async () => {
    const mockServer = createMockServer();
    registerStderrTestTool({
      server: mockServer as unknown as Parameters<typeof registerStderrTestTool>[0]["server"],
    });

    const tool = mockServer.getTool("stderr_test");
    const result = await tool!.handler({});
    expect(mockRequestApproval).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain("Approval requested");
  });

  it("should request approval with action: request", async () => {
    const mockServer = createMockServer();
    registerStderrTestTool({
      server: mockServer as unknown as Parameters<typeof registerStderrTestTool>[0]["server"],
    });

    const tool = mockServer.getTool("stderr_test");
    const result = await tool!.handler({ action: "request" });
    expect(mockRequestApproval).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain("Approval requested");
  });

  it("should validate token with action: confirm", async () => {
    mockValidateApproval.mockReturnValue({ valid: true });

    const mockServer = createMockServer();
    registerStderrTestTool({
      server: mockServer as unknown as Parameters<typeof registerStderrTestTool>[0]["server"],
    });

    const tool = mockServer.getTool("stderr_test");
    const result = await tool!.handler({ action: "confirm", token: "valid-token" });
    expect(mockValidateApproval).toHaveBeenCalledWith({
      requestId: "stderr-test-001",
      providedToken: "valid-token",
    });
    expect(result.content[0].text).toContain("Approval confirmed");
  });

  it("should return error for invalid token", async () => {
    mockValidateApproval.mockReturnValue({ valid: false, reason: "Token expired" });

    const mockServer = createMockServer();
    registerStderrTestTool({
      server: mockServer as unknown as Parameters<typeof registerStderrTestTool>[0]["server"],
    });

    const tool = mockServer.getTool("stderr_test");
    const result = await tool!.handler({ action: "confirm", token: "invalid" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Token expired");
  });

  it("should resend notification with action: resend", async () => {
    mockResendApprovalNotification.mockReturnValue(true);

    const mockServer = createMockServer();
    registerStderrTestTool({
      server: mockServer as unknown as Parameters<typeof registerStderrTestTool>[0]["server"],
    });

    const tool = mockServer.getTool("stderr_test");
    const result = await tool!.handler({ action: "resend" });
    expect(mockResendApprovalNotification).toHaveBeenCalledWith("stderr-test-001");
    expect(result.content[0].text).toContain("Notification resent");
  });

  it("should return error when no pending approval to resend", async () => {
    mockResendApprovalNotification.mockReturnValue(false);

    const mockServer = createMockServer();
    registerStderrTestTool({
      server: mockServer as unknown as Parameters<typeof registerStderrTestTool>[0]["server"],
    });

    const tool = mockServer.getTool("stderr_test");
    const result = await tool!.handler({ action: "resend" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No pending approval");
  });

  it("should return error for unknown action", async () => {
    const mockServer = createMockServer();
    registerStderrTestTool({
      server: mockServer as unknown as Parameters<typeof registerStderrTestTool>[0]["server"],
    });

    const tool = mockServer.getTool("stderr_test");
    // Cast to bypass type checking since this tests an edge case
    const result = await tool!.handler({ action: "unknown" as "request" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown action");
  });
});
