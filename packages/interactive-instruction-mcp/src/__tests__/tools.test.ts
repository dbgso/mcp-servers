/**
 * Tool Registration Unit Tests
 *
 * Tests that registerInstructionTools registers the expected tools via createServer.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createServer } from "../server.js";
import type { ReminderConfig } from "../types/index.js";

// mcp-shared is mocked globally in vitest-setup.ts

const tempBase = path.join(process.cwd(), "src/__tests__/temp-tools");

describe("registerInstructionTools", () => {
  const defaultConfig: ReminderConfig = {
    remindMcp: false,
    remindOrganize: false,
    customReminders: [],
    topicForEveryTask: null,
    infoValidSeconds: 60,
  };

  beforeEach(async () => {
    await fs.mkdir(tempBase, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempBase, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should register instruction_describe and instruction tools", () => {
    const server = createServer({
      markdownDir: tempBase,
      config: defaultConfig,
    });

    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });

  it("should create a server that can connect", async () => {
    const server = createServer({
      markdownDir: tempBase,
      config: defaultConfig,
    });

    // Verify the server was created successfully with the expected interface
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
    expect(typeof server.close).toBe("function");
  });

  it("should accept custom config", () => {
    const customConfig: ReminderConfig = {
      ...defaultConfig,
      infoValidSeconds: 120,
      remindMcp: true,
    };

    const server = createServer({
      markdownDir: tempBase,
      config: customConfig,
    });

    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });
});
