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

        // Object value with matches should not match (type mismatch)
        expect(engine.evaluate("api_call", { data: { name: "test" } }).action).toBe("allow");
        // String value should work
        expect(engine.evaluate("api_call", { data: "test123" }).action).toBe("deny");
      });

      test("should handle array value for contains operator", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "cli_execute",
          conditions: [{ param: "args", operator: "contains", value: "--force" }],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        // Array with matching element should match
        expect(engine.evaluate("cli_execute", { args: ["hello", "--force", "world"] }).action).toBe("deny");
        expect(engine.evaluate("cli_execute", { args: ["--force-push"] }).action).toBe("deny");
        // Array without matching element should not match
        expect(engine.evaluate("cli_execute", { args: ["hello", "world"] }).action).toBe("allow");
        // String value should still work
        expect(engine.evaluate("cli_execute", { args: "hello --force world" }).action).toBe("deny");
      });

      test("should handle array value for matches operator", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "cli_execute",
          conditions: [{ param: "args", operator: "matches", value: "^--profile$" }],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        // Array with matching element should match
        expect(engine.evaluate("cli_execute", { args: ["s3", "ls", "--profile", "prod"] }).action).toBe("deny");
        // Array without matching element should not match
        expect(engine.evaluate("cli_execute", { args: ["s3", "ls"] }).action).toBe("allow");
        // Partial match should not work with exact regex
        expect(engine.evaluate("cli_execute", { args: ["--profile-name"] }).action).toBe("allow");
      });

      test("should handle array index access args[N]", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "cli_execute",
          conditions: [
            { param: "args[0]", operator: "equals", value: "push" },
            { param: "args[2]", operator: "equals", value: "main" },
          ],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        // git push origin main should be denied
        expect(engine.evaluate("cli_execute", { args: ["push", "origin", "main"] }).action).toBe("deny");
        // git push origin feature should be allowed
        expect(engine.evaluate("cli_execute", { args: ["push", "origin", "feature"] }).action).toBe("allow");
        // git pull origin main should be allowed (args[0] != "push")
        expect(engine.evaluate("cli_execute", { args: ["pull", "origin", "main"] }).action).toBe("allow");
      });

      test("should handle nested array index access options.volume[0]", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "cli_execute",
          conditions: [
            { param: "options.volume[0]", operator: "contains", value: "/etc" },
          ],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        // First volume mounting /etc should be denied
        expect(engine.evaluate("cli_execute", {
          options: { volume: ["/etc:/etc", "/var:/var"] }
        }).action).toBe("deny");
        // First volume not mounting /etc should be allowed
        expect(engine.evaluate("cli_execute", {
          options: { volume: ["/tmp:/tmp", "/etc:/etc"] }
        }).action).toBe("allow");
      });

      test("should handle options.profile access", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "cli_execute",
          conditions: [
            { param: "command", operator: "equals", value: "aws" },
            { param: "options.profile", operator: "equals", value: "prod" },
          ],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        // aws with profile=prod should be denied
        expect(engine.evaluate("cli_execute", {
          command: "aws",
          args: ["s3", "ls"],
          options: { profile: "prod" }
        }).action).toBe("deny");
        // aws with profile=dev should be allowed
        expect(engine.evaluate("cli_execute", {
          command: "aws",
          args: ["s3", "ls"],
          options: { profile: "dev" }
        }).action).toBe("allow");
      });

      test("should handle boolean options", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "cli_execute",
          conditions: [
            { param: "options.force", operator: "equals", value: true },
          ],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        // force=true should be denied
        expect(engine.evaluate("cli_execute", {
          options: { force: true }
        }).action).toBe("deny");
        // force=false should be allowed
        expect(engine.evaluate("cli_execute", {
          options: { force: false }
        }).action).toBe("allow");
        // no force option should be allowed
        expect(engine.evaluate("cli_execute", {
          options: {}
        }).action).toBe("allow");
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

      test("should handle unknown operator gracefully", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "api_call",
          conditions: [{ param: "value", operator: "unknown_op" as "equals", value: "test" }],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        // Unknown operator should not match
        expect(engine.evaluate("api_call", { value: "test" }).action).toBe("allow");
      });

      test("should handle array index on non-array", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "cli_execute",
          conditions: [{ param: "args[0]", operator: "equals", value: "push" }],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        // args is a string, not an array - should not match
        expect(engine.evaluate("cli_execute", { args: "push origin main" }).action).toBe("allow");
      });

      test("should handle dot notation on non-object", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "cli_execute",
          conditions: [{ param: "options.profile", operator: "equals", value: "prod" }],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        // options is a string, not an object - should not match
        expect(engine.evaluate("cli_execute", { options: "some-string" }).action).toBe("allow");
      });

      test("should handle non-string value in contains condition", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "api_call",
          // Cast to test non-string value edge case
          conditions: [{ param: "data", operator: "contains", value: 123 as unknown as string }],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        // Non-string condition value should not match
        expect(engine.evaluate("api_call", { data: "123" }).action).toBe("allow");
      });

      test("should handle non-string value in matches condition", () => {
        const rule: Rule = {
          id: "rule1",
          priority: 0,
          action: "deny",
          toolPattern: "api_call",
          // Cast to test non-string value edge case
          conditions: [{ param: "data", operator: "matches", value: 123 as unknown as string }],
        };
        const store = createMockRuleStore([rule], "allow");
        const engine = new RuleEngine(store);

        // Non-string condition value should not match
        expect(engine.evaluate("api_call", { data: "123" }).action).toBe("allow");
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

  describe("evaluateAll", () => {
    test("should return all rules with evaluation details", () => {
      const rules: Rule[] = [
        { id: "rule1", priority: 100, action: "deny", toolPattern: "browser_click", conditions: [{ param: "ref", operator: "contains", value: "delete" }] },
        { id: "rule2", priority: 50, action: "allow", toolPattern: "browser_*" },
        { id: "rule3", priority: 10, action: "deny", toolPattern: "*" },
      ];
      const store = createMockRuleStore(rules);
      const engine = new RuleEngine(store);

      const result = engine.evaluateAll("browser_click", { ref: "submit-btn" });

      expect(result.evaluatedRules).toHaveLength(3);
      // rule1 doesn't match (condition fails)
      expect(result.evaluatedRules[0].matches).toBe(false);
      expect(result.evaluatedRules[0].patternMatch).toBe(true);
      expect(result.evaluatedRules[0].wouldApply).toBe(false);
      // rule2 matches and would apply (first match)
      expect(result.evaluatedRules[1].matches).toBe(true);
      expect(result.evaluatedRules[1].wouldApply).toBe(true);
      // rule3 matches but wouldn't apply (rule2 matched first)
      expect(result.evaluatedRules[2].matches).toBe(true);
      expect(result.evaluatedRules[2].wouldApply).toBe(false);

      expect(result.finalAction.action).toBe("allow");
      expect(result.finalAction.matchedRule?.id).toBe("rule2");
    });

    test("should show actual values in condition results", () => {
      const rules: Rule[] = [
        { id: "rule1", priority: 100, action: "deny", toolPattern: "cli_execute", conditions: [{ param: "options.profile", operator: "equals", value: "prod" }] },
      ];
      const store = createMockRuleStore(rules);
      const engine = new RuleEngine(store);

      const result = engine.evaluateAll("cli_execute", { options: { profile: "dev" } });

      expect(result.evaluatedRules[0].conditionResults[0].actualValue).toBe("dev");
      expect(result.evaluatedRules[0].conditionResults[0].matches).toBe(false);
    });

    test("should use default action when no rules match", () => {
      const rules: Rule[] = [
        { id: "rule1", priority: 100, action: "allow", toolPattern: "browser_*" },
      ];
      const store = createMockRuleStore(rules, "deny");
      const engine = new RuleEngine(store);

      const result = engine.evaluateAll("cli_execute", {});

      expect(result.finalAction.action).toBe("deny");
      expect(result.finalAction.matchedRule).toBeUndefined();
      expect(result.evaluatedRules[0].matches).toBe(false);
      expect(result.evaluatedRules[0].wouldApply).toBe(false);
    });

    test("should include order number for each rule", () => {
      const rules: Rule[] = [
        { id: "high", priority: 100, action: "deny", toolPattern: "*" },
        { id: "medium", priority: 50, action: "allow", toolPattern: "*" },
        { id: "low", priority: 10, action: "ask", toolPattern: "*" },
      ];
      const store = createMockRuleStore(rules);
      const engine = new RuleEngine(store);

      const result = engine.evaluateAll("any_tool", {});

      expect(result.evaluatedRules[0].order).toBe(1);
      expect(result.evaluatedRules[0].rule.id).toBe("high");
      expect(result.evaluatedRules[1].order).toBe(2);
      expect(result.evaluatedRules[2].order).toBe(3);
    });
  });
});
