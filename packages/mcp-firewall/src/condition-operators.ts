import type { Condition, ConditionOperator } from "./types.js";

/**
 * What each condition `operator` does with the argument it looks at, one class
 * per operator, so each can be tested on its own and an operator added to the
 * schema is a compile error here until it has one.
 */
interface ConditionOperatorImpl {
  test(params: { value: unknown; expected: Condition["value"] }): boolean;
}

/** A string argument, or any string in an array argument, passes `test`. */
function anyString(params: { value: unknown; test: (s: string) => boolean }): boolean {
  const { value, test } = params;
  if (typeof value === "string") return test(value);
  if (Array.isArray(value)) {
    return value.some((item) => typeof item === "string" && test(item));
  }
  return false;
}

class ExistsOperator implements ConditionOperatorImpl {
  test(params: { value: unknown }): boolean {
    return params.value !== undefined;
  }
}

class EqualsOperator implements ConditionOperatorImpl {
  test(params: { value: unknown; expected: Condition["value"] }): boolean {
    return params.value === params.expected;
  }
}

class ContainsOperator implements ConditionOperatorImpl {
  test(params: { value: unknown; expected: Condition["value"] }): boolean {
    const { value, expected } = params;
    if (typeof expected !== "string") return false;
    return anyString({ value, test: (s) => s.includes(expected) });
  }
}

/** A pattern that is not a valid regular expression matches nothing. */
class MatchesOperator implements ConditionOperatorImpl {
  test(params: { value: unknown; expected: Condition["value"] }): boolean {
    const { value, expected } = params;
    if (typeof expected !== "string") return false;
    try {
      const regex = new RegExp(expected);
      return anyString({ value, test: (s) => regex.test(s) });
    } catch {
      return false;
    }
  }
}

const OPERATORS: Record<ConditionOperator, ConditionOperatorImpl> = {
  exists: new ExistsOperator(),
  equals: new EqualsOperator(),
  contains: new ContainsOperator(),
  matches: new MatchesOperator(),
};

/** Whether `value` satisfies the condition. An operator this version does not know never does. */
export function testCondition(params: { condition: Condition; value: unknown }): boolean {
  const { condition, value } = params;
  if (!Object.hasOwn(OPERATORS, condition.operator)) return false;
  return OPERATORS[condition.operator].test({ value, expected: condition.value });
}
