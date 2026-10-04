import { describe, it, expect } from "vitest";
import { testCondition } from "../condition-operators.js";
import type { Condition } from "../types.js";

const when = (operator: string, value?: Condition["value"]): Condition =>
  ({ param: "p", operator, value }) as Condition;

describe("testCondition", () => {
  it.each([
    ["exists", undefined, "x", true],
    ["exists", undefined, undefined, false],
    ["equals", "a", "a", true],
    ["equals", 1, "1", false],
    ["contains", "del", "delete", true],
    ["contains", "del", ["keep", "delete"], true],
    ["contains", "del", ["keep", 3], false],
    ["contains", 1, "1", false],
    ["contains", "del", 42, false],
    ["matches", "^de", "delete", true],
    ["matches", "^de", ["x", "delete"], true],
    ["matches", "^de", "undo", false],
    ["matches", "(", "anything", false],
    ["matches", true, "true", false],
  ] as const)("%s %j against %j is %s", (operator, expected, value, result) => {
    expect(testCondition({ condition: when(operator, expected), value })).toBe(result);
  });

  it("never passes an operator this version does not know", () => {
    expect(testCondition({ condition: when("startsWith", "a"), value: "abc" })).toBe(false);
  });
});
