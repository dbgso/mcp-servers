import { minimatch } from "minimatch";
import type { RuleStore } from "./rule-store.js";
import type { Condition, EvaluationResult, Rule } from "./types.js";

/**
 * Evaluates rules against tool calls
 */
export class RuleEngine {
  constructor(private readonly ruleStore: RuleStore) {}

  /**
   * Evaluate rules for a tool call
   */
  evaluate(
    toolName: string,
    args: Record<string, unknown>
  ): EvaluationResult {
    const rules = this.ruleStore.getRules();

    for (const rule of rules) {
      if (this.matchesRule(rule, toolName, args)) {
        return {
          action: rule.action,
          matchedRule: rule,
          reason: rule.description ?? `Matched rule: ${rule.id}`,
        };
      }
    }

    // No rule matched, use default action
    const defaultAction = this.ruleStore.getDefaultAction();
    return {
      action: defaultAction,
      reason: `No matching rule, using default action: ${defaultAction}`,
    };
  }

  /**
   * Check if a rule matches the tool call
   */
  private matchesRule(
    rule: Rule,
    toolName: string,
    args: Record<string, unknown>
  ): boolean {
    // Check tool pattern
    if (!this.matchesPattern(rule.toolPattern, toolName)) {
      return false;
    }

    // Check conditions (if any)
    if (rule.conditions && rule.conditions.length > 0) {
      return rule.conditions.every((condition) =>
        this.matchesCondition(condition, args)
      );
    }

    return true;
  }

  /**
   * Check if tool name matches the pattern
   */
  private matchesPattern(pattern: string, toolName: string): boolean {
    return minimatch(toolName, pattern);
  }

  /**
   * Check if args match a condition
   */
  private matchesCondition(
    condition: Condition,
    args: Record<string, unknown>
  ): boolean {
    const value = this.getNestedValue(args, condition.param);

    switch (condition.operator) {
      case "exists":
        return value !== undefined;

      case "equals":
        return value === condition.value;

      case "contains":
        if (typeof value === "string" && typeof condition.value === "string") {
          return value.includes(condition.value);
        }
        return false;

      case "matches":
        if (typeof value === "string" && typeof condition.value === "string") {
          try {
            const regex = new RegExp(condition.value);
            return regex.test(value);
          } catch {
            return false;
          }
        }
        return false;

      default:
        return false;
    }
  }

  /**
   * Get nested value from object using dot notation
   * e.g., "args.ref" -> obj.args.ref
   */
  private getNestedValue(
    obj: Record<string, unknown>,
    path: string
  ): unknown {
    const parts = path.split(".");
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current !== "object") {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Test a rule against a tool call (for debugging)
   */
  testRule(
    rule: Rule,
    toolName: string,
    args: Record<string, unknown>
  ): {
    matches: boolean;
    patternMatch: boolean;
    conditionResults: { condition: Condition; matches: boolean }[];
  } {
    const patternMatch = this.matchesPattern(rule.toolPattern, toolName);
    const conditionResults = (rule.conditions ?? []).map((condition) => ({
      condition,
      matches: this.matchesCondition(condition, args),
    }));

    return {
      matches: this.matchesRule(rule, toolName, args),
      patternMatch,
      conditionResults,
    };
  }
}
