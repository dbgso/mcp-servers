import { describe, expect, it } from "vitest";
import { asOptionalText, asText } from "../sources/text.js";

describe("asText", () => {
  it.each([
    ["a string", "open", "open"],
    ["a number", 42, "42"],
    ["a boolean", true, "true"],
    ["undefined", undefined, "fb"],
    ["null", null, "fb"],
    ["an object, which would otherwise read as [object Object]", { a: 1 }, "fb"],
  ])("reads %s", (_label, value, want) => {
    expect(asText({ value, fallback: "fb" })).toBe(want);
  });
});

describe("asOptionalText", () => {
  it.each([
    ["a string", "U123", "U123"],
    ["an empty string", "", ""],
    ["a number", 7, "7"],
    ["undefined", undefined, undefined],
    ["an object", { a: 1 }, undefined],
  ])("reads %s", (_label, value, want) => {
    expect(asOptionalText(value)).toBe(want);
  });
});
