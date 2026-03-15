import { describe, test, expect, beforeEach, vi } from "vitest";
import { RuleEngine } from "../rule-engine.js";
import type { RuleStore } from "../rule-store.js";
import type { Rule, RuleAction } from "../types.js";

// Mock RuleStore
function createMockRuleStore(
  rules: Rule[],
  defaultAction: RuleAction = "deny"
): RuleStore {
  return {
    getRules: () => [...rules].sort((a, b) => b.priority - a.priority),
    getDefaultAction: () => defaultAction,
  } as RuleStore;
}

describe("RuleEngine", () => {
  describe("evaluate", () => {
    test("should return default action when no rules match", () => {
      const store = createMockRuleStore([], "deny");
      const engine = new RuleEngine(store);

      const result = engine.evaluate("some_tool", {});

      expect(result.action).toBe("deny");
      expect(result.matchedRule).toBeUndefined();
      expect(result.reason).toContain("default");
    });

    test("should match exact tool name", () => {
      const rule: Rule = {
        id: "rule1",
        priority: 0,
        action: "allow",
        toolPattern: "browser_click",
      };
      const store = createMockRuleStore([rule]);
      const engine = new RuleEngine(store);

      const result = engine.evaluate("browser_click", {});

      expect(result.action).toBe("allow");
      expect(result.matchedRule?.id).toBe("rule1");
    });

    test("should match glob pattern", () => {
      const rule: Rule = {
        id: "rule1",
        priority: 0,
        action: "allow",
        toolPattern: "browser_*",
      };
      const store = createMockRuleStore([rule]);
      const engine = new RuleEngine(store);

      expect(engine.evaluate("browser_click", {}).action).toBe("allow");
      expect(engine.evaluate("browser_navigate", {}).action).toBe("allow");
      expect(engine.evaluate("file_read", {}).action).toBe("deny"); // default
    });

    test("should match wildcard pattern", () => {
      const rule: Rule = {
        id: "rule1",
        priority: 0,
        action: "allow",
        toolPattern: "*",
      };
      const store = createMockRuleStore([rule]);
      const engine = new RuleEngine(store);

      expect(engine.evaluate("any_tool", {}).action).toBe("allow");
    });

    test("should evaluate rules by priority (higher first)", () => {
      const rules: Rule[] = [
        {
          id: "low-priority",
          priority: 10,
          action: "allow",
          toolPattern: "browser_*",
        },
        {
          id: "high-priority",
          priority: 100,
          action: "deny",
          toolPattern: "browser_click",
        },
      ];
      const store = createMockRuleStore(rules);
      const engine = new RuleEngine(store);

      // browser_click matches high-priority deny rule first
      const clickResult = engine.evaluate("browser_click", {});
      expect(clickResult.action).toBe("deny");
      expect(clickResult.matchedRule?.id).toBe("high-priority");

      // browser_navigate only matches low-priority allow rule
      const navResult = engine.evaluate("browser_navigate", {});
      expect(navResult.action).toBe("allow");
      expect(navResult.matchedRule?.id).toBe("low-priority");
    });

    describe("conditions", () => {
      test("should match equals condition", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "browser_click",
          conditions: [{ param: "ref", operator: "equals", value: "dangerous-button" }],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        expect(engine.evaluate("browser_click", { ref: "dangerous-button" }).action).toBe("deny");
        expect(engine.evaluate("browser_click", { ref: "safe-button" }).action).toBe("allow");
      });

      test("should match contains condition", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "browser_click",
          conditions: [{ param: "ref", operator: "contains", value: "delete" }],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        expect(engine.evaluate("browser_click", { ref: "delete-all-btn" }).action).toBe("deny");
        expect(engine.evaluate("browser_click", { ref: "btn-delete" }).action).toBe("deny");
        expect(engine.evaluate("browser_click", { ref: "safe-button" }).action).toBe("allow");
      });

      test("should match matches (regex) condition", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "browser_click",
          conditions: [{ param: "ref", operator: "matches", value: "^danger.*btn$" }],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        expect(engine.evaluate("browser_click", { ref: "danger-delete-btn" }).action).toBe("deny");
        expect(engine.evaluate("browser_click", { ref: "danger-btn" }).action).toBe("deny");
        expect(engine.evaluate("browser_click", { ref: "safe-danger-btn" }).action).toBe("allow");
      });

      test("should match exists condition", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "file_write",
          conditions: [{ param: "force", operator: "exists" }],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        expect(engine.evaluate("file_write", { force: true }).action).toBe("deny");
        expect(engine.evaluate("file_write", { force: false }).action).toBe("deny");
        expect(engine.evaluate("file_write", {}).action).toBe("allow");
      });

      test("should require all conditions to match (AND)", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "browser_click",
          conditions: [
            { param: "ref", operator: "contains", value: "delete" },
            { param: "force", operator: "equals", value: true },
          ],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        expect(engine.evaluate("browser_click", { ref: "delete-btn", force: true }).action).toBe("deny");
        expect(engine.evaluate("browser_click", { ref: "delete-btn", force: false }).action).toBe("allow");
        expect(engine.evaluate("browser_click", { ref: "safe-btn", force: true }).action).toBe("allow");
      });

      test("should handle nested params with dot notation", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "api_call",
          conditions: [{ param: "options.method", operator: "equals", value: "DELETE" }],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        expect(engine.evaluate("api_call", { options: { method: "DELETE" } }).action).toBe("deny");
        expect(engine.evaluate("api_call", { options: { method: "GET" } }).action).toBe("allow");
      });

      test("should handle invalid regex gracefully", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "browser_click",
          conditions: [{ param: "ref", operator: "matches", value: "[invalid(regex" }],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        // Invalid regex should not match, fall through to default action
        expect(engine.evaluate("browser_click", { ref: "any-value" }).action).toBe("allow");
      });

      test("should handle type mismatch for contains operator", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "api_call",
          conditions: [{ param: "count", operator: "contains", value: "5" }],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        // Number value with contains should not match (type mismatch)
        expect(engine.evaluate("api_call", { count: 5 }).action).toBe("allow");
        expect(engine.evaluate("api_call", { count: 123 }).action).toBe("allow");
        // String value should work
        expect(engine.evaluate("api_call", { count: "5" }).action).toBe("deny");
      });

      test("should handle type mismatch for matches operator", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "api_call",
          conditions: [{ param: "data", operator: "matches", value: "^test" }],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        // Object/array value with matches should not match (type mismatch)
        expect(engine.evaluate("api_call", { data: { name: "test" } }).action).toBe("allow");
        expect(engine.evaluate("api_call", { data: ["test"] }).action).toBe("allow");
        // String value should work
        expect(engine.evaluate("api_call", { data: "test123" }).action).toBe("deny");
      });

      test("should handle missing param value", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "api_call",
          conditions: [{ param: "missing.path", operator: "equals", value: "test" }],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        // Missing param should not match (undefined != "test")
        expect(engine.evaluate("api_call", {}).action).toBe("allow");
        expect(engine.evaluate("api_call", { missing: {} }).action).toBe("allow");
      });
    });
  });

  describe("testRule", () => {
    test("should return detailed match info", () => {
      const rule: Rule = {
        id: "rule1",
        priority: 0,
        action: "deny",
        toolPattern: "browser_*",
        conditions: [
          { param: "ref", operator: "contains", value: "delete" },
        ],
      };
      const store = createMockRuleStore([rule]);
      const engine = new RuleEngine(store);

      const result = engine.testRule(rule, "browser_click", { ref: "delete-btn" });

      expect(result.matches).toBe(true);
      expect(result.patternMatch).toBe(true);
      expect(result.conditionResults).toHaveLength(1);
      expect(result.conditionResults[0].matches).toBe(true);
    });
  });
});
