import { describe, it, expect } from "vitest";
import { z } from "zod";
import { looseArray, looseBoolean, looseNumber, looseObject } from "../utils/untyped-args.js";

/**
 * A tool that publishes no argument types gets every value its client could not
 * type as a string (policy__mcp-tool-surface). These wrappers turn the string
 * spelling back into the type the handler declares -- and nothing looser.
 */

describe("looseBoolean", () => {
  const schema = looseBoolean(z.boolean().optional());

  it.each([
    ["true", true],
    ["false", false],
    [true, true],
    [undefined, undefined],
  ])("accepts %j as %j", (input, expected) => {
    expect(schema.parse(input)).toBe(expected);
  });

  it.each(["yes", "1", "TRUE", ""])("rejects %j", (input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });
});

describe("looseNumber", () => {
  const schema = looseNumber(z.number().optional());

  it.each([
    ["2", 2],
    ["1.5", 1.5],
    ["-3", -3],
    [4, 4],
  ])("accepts %j as %j", (input, expected) => {
    expect(schema.parse(input)).toBe(expected);
  });

  it.each(["", "two", "0x10", "1e3", " 2"])("rejects %j", (input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  it("keeps the inner schema's constraints", () => {
    const positive = looseNumber(z.number().int().min(1));

    expect(positive.safeParse("0").success).toBe(false);
  });
});

describe("looseArray", () => {
  const schema = looseArray(z.array(z.string()).optional());

  it.each([
    ['["a","b"]', ["a", "b"]],
    [' ["a"]', ["a"]],
    ["[]", []],
    [["a"], ["a"]],
  ])("accepts %j as %j", (input, expected) => {
    expect(schema.parse(input)).toEqual(expected);
  });

  it.each(["a", "[not json", "{}", '"a"'])("rejects %j", (input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  it("still checks the element type", () => {
    expect(schema.safeParse("[1, 2]").success).toBe(false);
  });
});

describe("looseObject", () => {
  const schema = looseObject(z.object({ kind: z.string(), deep: z.boolean().optional() }).optional());

  it.each([
    ['{"kind":"x"}', { kind: "x" }],
    [' {"kind":"x","deep":true}', { kind: "x", deep: true }],
    [{ kind: "x" }, { kind: "x" }],
    [undefined, undefined],
  ])("accepts %j as %j", (input, expected) => {
    expect(schema.parse(input)).toEqual(expected);
  });

  it.each(["kind", "{not json", '["x"]'])("rejects %j", (input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });
});
