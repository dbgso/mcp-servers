import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditLogger } from "../audit-logger.js";
import type { Rule } from "../types.js";

describe("AuditLogger", () => {
  let tempDir: string;
  let logFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mcp-proxy-audit-test-"));
    logFile = join(tempDir, "audit.log");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    test("should create parent directory if not exists", () => {
      const nestedPath = join(tempDir, "nested", "dir", "audit.log");
      new AuditLogger(nestedPath);

      expect(existsSync(join(tempDir, "nested", "dir"))).toBe(true);
    });
  });

  describe("log", () => {
    test("should write JSON Lines format", () => {
      const logger = new AuditLogger(logFile);

      logger.log({
        toolName: "browser_click",
        args: { ref: "btn-1" },
        action: "allow",
        reason: "Allowed by rule",
        result: "executed",
      });

      const content = readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(1);

      const entry = JSON.parse(lines[0]);
      expect(entry.toolName).toBe("browser_click");
      expect(entry.args).toEqual({ ref: "btn-1" });
      expect(entry.action).toBe("allow");
      expect(entry.reason).toBe("Allowed by rule");
      expect(entry.result).toBe("executed");
      expect(entry.timestamp).toBeDefined();
    });

    test("should append multiple entries", () => {
      const logger = new AuditLogger(logFile);

      logger.log({
        toolName: "tool1",
        args: {},
        action: "allow",
        reason: "reason1",
      });

      logger.log({
        toolName: "tool2",
        args: {},
        action: "deny",
        reason: "reason2",
      });

      const content = readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);

      expect(JSON.parse(lines[0]).toolName).toBe("tool1");
      expect(JSON.parse(lines[1]).toolName).toBe("tool2");
    });
  });

  describe("logAllow", () => {
    test("should log allow action with rule", () => {
      const logger = new AuditLogger(logFile);
      const rule: Rule = {
        id: "rule-1",
        priority: 100,
        action: "allow",
        toolPattern: "browser_*",
      };

      logger.logAllow("browser_click", { ref: "btn-1" }, rule, "Matched rule-1");

      const content = readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.toolName).toBe("browser_click");
      expect(entry.args).toEqual({ ref: "btn-1" });
      expect(entry.action).toBe("allow");
      expect(entry.ruleId).toBe("rule-1");
      expect(entry.reason).toBe("Matched rule-1");
      expect(entry.result).toBe("executed");
    });

    test("should log allow action without rule (default action)", () => {
      const logger = new AuditLogger(logFile);

      logger.logAllow("browser_click", { ref: "btn-1" }, undefined, "Default action");

      const content = readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.action).toBe("allow");
      expect(entry.ruleId).toBeUndefined();
      expect(entry.reason).toBe("Default action");
    });
  });

  describe("logDeny", () => {
    test("should log deny action", () => {
      const logger = new AuditLogger(logFile);
      const rule: Rule = {
        id: "block-rule",
        priority: 100,
        action: "deny",
        toolPattern: "browser_click",
        conditions: [{ param: "ref", operator: "contains", value: "delete" }],
      };

      logger.logDeny("browser_click", { ref: "delete-btn" }, rule, "Matched block-rule");

      const content = readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.toolName).toBe("browser_click");
      expect(entry.action).toBe("deny");
      expect(entry.ruleId).toBe("block-rule");
      expect(entry.result).toBe("blocked");
    });
  });

  describe("logAsk", () => {
    test("should log ask action", () => {
      const logger = new AuditLogger(logFile);
      const rule: Rule = {
        id: "ask-rule",
        priority: 100,
        action: "ask",
        toolPattern: "browser_click",
      };

      logger.logAsk("browser_click", { ref: "submit-btn" }, rule, "Requires approval");

      const content = readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.toolName).toBe("browser_click");
      expect(entry.action).toBe("ask");
      expect(entry.ruleId).toBe("ask-rule");
      expect(entry.reason).toBe("Requires approval");
      expect(entry.result).toBe("pending");
    });
  });

  describe("logError", () => {
    test("should log error", () => {
      const logger = new AuditLogger(logFile);

      logger.logError("browser_click", { ref: "btn-1" }, "Connection timeout");

      const content = readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.toolName).toBe("browser_click");
      expect(entry.action).toBe("error");
      expect(entry.reason).toBe("Tool execution failed");
      expect(entry.result).toBe("error");
      expect(entry.error).toBe("Connection timeout");
    });
  });
});
