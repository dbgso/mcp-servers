import { minimatch } from "minimatch";
import type { RuleStore } from "./rule-store.js";
import { testCondition } from "./condition-operators.js";
import type { Condition, EvaluationResult, Rule } from "./types.js";

/**
 * Evaluates rules against tool calls
 */
export class RuleEngine {
  constructor(private readonly ruleStore: RuleStore) {}

  /**
   * Evaluate rules for a tool call
   */
  evaluate(params: {
    toolName: string;
    args: Record<string, unknown>;
  }): EvaluationResult {
    const { toolName, args } = params;
    const matched = this.ruleStore.getRules().find((rule) => this.matchesRule({ rule, toolName, args }));
    return this.resultFor(matched);
  }

  /**
   * The decision for the first matching rule, or the default action when no
   * rule matched.
   */
  private resultFor(rule: Rule | undefined): EvaluationResult {
    if (!rule) {
      const defaultAction = this.ruleStore.getDefaultAction();
      return {
        action: defaultAction,
        reason: `No matching rule, using default action: ${defaultAction}`,
      };
    }
    return {
      action: rule.action,
      matchedRule: rule,
      reason: rule.description ?? `Matched rule: ${rule.id}`,
    };
  }

  /**
   * Check if a rule matches the tool call: the pattern, then every condition
   * (a rule without conditions matches on the pattern alone)
   */
  private matchesRule(params: {
    rule: Rule;
    toolName: string;
    args: Record<string, unknown>;
  }): boolean {
    const { rule, toolName, args } = params;
    return (
      this.matchesPattern({ pattern: rule.toolPattern, toolName }) &&
      (rule.conditions ?? []).every((condition) => this.matchesCondition({ condition, args }))
    );
  }

  /**
   * Check if tool name matches the pattern
   */
  private matchesPattern(params: { pattern: string; toolName: string }): boolean {
    return minimatch(params.toolName, params.pattern);
  }

  /**
   * Check if args match a condition
   */
  private matchesCondition(params: {
    condition: Condition;
    args: Record<string, unknown>;
  }): boolean {
    return this.inspectCondition(params).matches;
  }

  /**
   * A condition's verdict together with the value it looked at
   */
  private inspectCondition(params: {
    condition: Condition;
    args: Record<string, unknown>;
  }): ConditionInspection {
    const { condition, args } = params;
    const actualValue = this.getNestedValue({ obj: args, path: condition.param });
    return { condition, matches: testCondition({ condition, value: actualValue }), actualValue };
  }

  /**
   * Get nested value from object using dot notation and array index
   * e.g., "args.ref" -> obj.args.ref
   * e.g., "args[0]" -> obj.args[0]
   * e.g., "options.volume[1]" -> obj.options.volume[1]
   */
  private getNestedValue(params: {
    obj: Record<string, unknown>;
    path: string;
  }): unknown {
    const { obj, path } = params;
    // Parse path into segments, handling both dot notation and array indices
    // e.g., "args[0]" -> ["args", 0]
    // e.g., "options.profile" -> ["options", "profile"]
    // e.g., "options.volume[1]" -> ["options", "volume", 1]
    const segments: (string | number)[] = [];
    const regex = /([^.\[\]]+)|\[(\d+)\]/g;
    let match;
    while ((match = regex.exec(path)) !== null) {
      // The pattern matches one group or the other: a name, or a bracketed index.
      segments.push(match[1] ?? parseInt(match[2], 10));
    }

    let current: unknown = obj;

    for (const segment of segments) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof segment === "number") {
        if (!Array.isArray(current)) {
          return undefined;
        }
        current = current[segment];
      } else {
        if (typeof current !== "object") {
          return undefined;
        }
        current = (current as Record<string, unknown>)[segment];
      }
    }

    return current;
  }

  /**
   * Test a rule against a tool call (for debugging)
   */
  testRule(params: {
    rule: Rule;
    toolName: string;
    args: Record<string, unknown>;
  }): RuleInspection {
    const { rule, toolName, args } = params;
    const patternMatch = this.matchesPattern({ pattern: rule.toolPattern, toolName });
    // Every condition is inspected, even after a failing pattern, so the
    // result explains each of them
    const conditionResults = (rule.conditions ?? []).map((condition) =>
      this.inspectCondition({ condition, args })
    );

    return {
      matches: patternMatch && conditionResults.every((result) => result.matches),
      patternMatch,
      conditionResults,
    };
  }

  /**
   * Evaluate all rules and return detailed results for each
   * Useful for debugging and understanding rule evaluation order
   */
  evaluateAll(params: {
    toolName: string;
    args: Record<string, unknown>;
  }): {
    finalAction: EvaluationResult;
    evaluatedRules: Array<RuleInspection & { rule: Rule; order: number; wouldApply: boolean }>;
  } {
    const { toolName, args } = params;
    const inspected = this.ruleStore
      .getRules()
      .map((rule, index) => ({ rule, order: index + 1, ...this.testRule({ rule, toolName, args }) }));

    // The first matching rule is the one that would apply
    const applied = inspected.find((entry) => entry.matches);
    const evaluatedRules = inspected.map((entry) => ({ ...entry, wouldApply: entry === applied }));

    return { finalAction: this.resultFor(applied?.rule), evaluatedRules };
  }
}

/** A condition's verdict and the argument value it was decided on. */
interface ConditionInspection {
  condition: Condition;
  matches: boolean;
  actualValue: unknown;
}

/** How a rule fares against a tool call, part by part. */
interface RuleInspection {
  matches: boolean;
  patternMatch: boolean;
  conditionResults: ConditionInspection[];
}
