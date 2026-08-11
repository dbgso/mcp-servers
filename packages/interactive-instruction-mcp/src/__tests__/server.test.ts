/**
 * Server Unit Tests
 *
 * Tests for the createServer factory function.
 */

import { describe, it, expect } from "vitest";
import { createServer } from "../server.js";
import type { ReminderConfig } from "../types/index.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// mcp-shared is mocked globally in vitest-setup.ts

const tempBase = path.join(process.cwd(), "src/__tests__/temp-server");

describe("createServer", () => {
  it("should create a server with default config", async () => {
    await fs.mkdir(tempBase, { recursive: true });
    try {
      const server = createServer({ markdownDir: tempBase });
      expect(server).toBeDefined();
      // McpServer doesn't expose name directly on server.server
      // We just verify the server was created successfully
      expect(typeof server.connect).toBe("function");
    } finally {
      await fs.rm(tempBase, { recursive: true, force: true });
    }
  });

  it("should create a server with custom config", async () => {
    await fs.mkdir(tempBase, { recursive: true });
    const customConfig: ReminderConfig = {
      remindMcp: true,
      remindOrganize: true,
      customReminders: ["Test reminder"],
      topicForEveryTask: "test-topic",
      infoValidSeconds: 120,
    };
    try {
      const server = createServer({
        markdownDir: tempBase,
        config: customConfig,
      });
      expect(server).toBeDefined();
      expect(typeof server.connect).toBe("function");
    } finally {
      await fs.rm(tempBase, { recursive: true, force: true });
    }
  });
});
