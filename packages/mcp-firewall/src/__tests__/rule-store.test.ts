import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdtempSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RuleStore } from "../rule-store.js";

describe("RuleStore", () => {
  let tempDir: string;
  let rulesFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mcp-proxy-test-"));
    rulesFile = join(tempDir, "rules.json");
  });

  afterEach(() => {
    if (existsSync(rulesFile)) {
      unlinkSync(rulesFile);
    }
    rmdirSync(tempDir);
  });

  describe("load", () => {
    test("should create empty rules file if not exists", async () => {
      const store = new RuleStore(rulesFile);
      await store.load();

      expect(existsSync(rulesFile)).toBe(true);
      expect(store.getRules()).toEqual([]);
      expect(store.getDefaultAction()).toBe("deny");
    });
  });

  describe("addRule", () => {
    test("should add rule with auto-generated ID", async () => {
      const store = new RuleStore(rulesFile);
      await store.load();

      const rule = await store.addRule({
        priority: 100,
        action: "allow",
        toolPattern: "browser_*",
        description: "Allow browser tools",
      });

      expect(rule.id).toBeDefined();
      expect(rule.id.length).toBeGreaterThan(0);
      expect(rule.priority).toBe(100);
      expect(rule.action).toBe("allow");
      expect(rule.toolPattern).toBe("browser_*");
    });

    test("should persist rule to file", async () => {
      const store = new RuleStore(rulesFile);
      await store.load();

      await store.addRule({
        priority: 100,
        action: "allow",
        toolPattern: "browser_*",
      });

      // Load fresh store
      const store2 = new RuleStore(rulesFile);
      await store2.load();

      expect(store2.getRules()).toHaveLength(1);
      expect(store2.getRules()[0].toolPattern).toBe("browser_*");
    });
  });

  describe("getRules", () => {
    test("should return rules sorted by priority descending", async () => {
      const store = new RuleStore(rulesFile);
      await store.load();

      await store.addRule({ priority: 10, action: "allow", toolPattern: "a" });
      await store.addRule({ priority: 100, action: "allow", toolPattern: "b" });
      await store.addRule({ priority: 50, action: "allow", toolPattern: "c" });

      const rules = store.getRules();

      expect(rules[0].toolPattern).toBe("b"); // priority 100
      expect(rules[1].toolPattern).toBe("c"); // priority 50
      expect(rules[2].toolPattern).toBe("a"); // priority 10
    });
  });

  describe("updateRule", () => {
    test("should update existing rule", async () => {
      const store = new RuleStore(rulesFile);
      await store.load();

      const rule = await store.addRule({
        priority: 100,
        action: "allow",
        toolPattern: "browser_*",
      });

      const updated = await store.updateRule(rule.id, {
        action: "deny",
        description: "Updated",
      });

      expect(updated?.action).toBe("deny");
      expect(updated?.description).toBe("Updated");
      expect(updated?.priority).toBe(100); // unchanged
    });

    test("should return undefined for non-existent rule", async () => {
      const store = new RuleStore(rulesFile);
      await store.load();

      const result = await store.updateRule("non-existent", { action: "deny" });

      expect(result).toBeUndefined();
    });
  });

  describe("removeRule", () => {
    test("should remove existing rule", async () => {
      const store = new RuleStore(rulesFile);
      await store.load();

      const rule = await store.addRule({
        priority: 100,
        action: "allow",
        toolPattern: "browser_*",
      });

      expect(store.count()).toBe(1);

      const removed = await store.removeRule(rule.id);

      expect(removed).toBe(true);
      expect(store.count()).toBe(0);
    });

    test("should return false for non-existent rule", async () => {
      const store = new RuleStore(rulesFile);
      await store.load();

      const removed = await store.removeRule("non-existent");

      expect(removed).toBe(false);
    });
  });

  describe("setDefaultAction", () => {
    test("should update and persist default action", async () => {
      const store = new RuleStore(rulesFile);
      await store.load();

      expect(store.getDefaultAction()).toBe("deny");

      await store.setDefaultAction("allow");

      expect(store.getDefaultAction()).toBe("allow");

      // Verify persistence
      const store2 = new RuleStore(rulesFile);
      await store2.load();
      expect(store2.getDefaultAction()).toBe("allow");
    });
  });

  describe("getRule", () => {
    test("should return rule by id", async () => {
      const store = new RuleStore(rulesFile);
      await store.load();

      const rule = await store.addRule({
        priority: 100,
        action: "allow",
        toolPattern: "browser_*",
      });

      const found = store.getRule(rule.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(rule.id);
      expect(found?.toolPattern).toBe("browser_*");
    });

    test("should return undefined for non-existent id", async () => {
      const store = new RuleStore(rulesFile);
      await store.load();

      const found = store.getRule("non-existent-id");
      expect(found).toBeUndefined();
    });
  });

  describe("getFilePath", () => {
    test("should return the rules file path", async () => {
      const store = new RuleStore(rulesFile);
      await store.load();

      expect(store.getFilePath()).toBe(rulesFile);
    });
  });
});
