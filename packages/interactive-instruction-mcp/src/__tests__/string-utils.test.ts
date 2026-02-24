import { describe, it, expect } from "vitest";
import { trimString, formatDocumentListItem } from "../utils/string-utils.js";

describe("trimString", () => {
  it.each<{
    name: string;
    value: string;
    collapseSpaces?: boolean;
    expected: string;
  }>([
    {
      name: "trims leading whitespace",
      value: "   hello",
      expected: "hello",
    },
    {
      name: "trims trailing whitespace",
      value: "hello   ",
      expected: "hello",
    },
    {
      name: "trims both leading and trailing whitespace",
      value: "   hello   ",
      expected: "hello",
    },
    {
      name: "returns empty string when only whitespace",
      value: "     ",
      expected: "",
    },
    {
      name: "preserves internal spaces by default",
      value: "  hello   world  ",
      expected: "hello   world",
    },
    {
      name: "collapses internal spaces when collapseSpaces is true",
      value: "  hello   world  ",
      collapseSpaces: true,
      expected: "hello world",
    },
    {
      name: "handles tabs and newlines",
      value: "\t\nhello\t\n",
      expected: "hello",
    },
    {
      name: "collapses tabs and newlines when collapseSpaces is true",
      value: "hello\t\n\nworld",
      collapseSpaces: true,
      expected: "hello world",
    },
    {
      name: "returns empty string for empty input",
      value: "",
      expected: "",
    },
  ])("$name", ({ value, collapseSpaces, expected }) => {
    const result = trimString({ value, collapseSpaces });
    expect(result).toBe(expected);
  });
});

describe("formatDocumentListItem", () => {
  it("formats document with description only", () => {
    const result = formatDocumentListItem({
      id: "coding__test",
      description: "Test description",
    });
    expect(result).toBe("- **coding__test**: Test description");
  });

  it("formats document with description and whenToUse", () => {
    const result = formatDocumentListItem({
      id: "coding__test",
      description: "Test description",
      whenToUse: ["Situation A", "Situation B"],
    });
    expect(result).toBe(
      "- **coding__test**: Test description\n  - When to use: Situation A, Situation B"
    );
  });

  it("formats document with empty whenToUse array", () => {
    const result = formatDocumentListItem({
      id: "coding__test",
      description: "Test description",
      whenToUse: [],
    });
    expect(result).toBe("- **coding__test**: Test description");
  });

  it("formats document with single whenToUse item", () => {
    const result = formatDocumentListItem({
      id: "coding__test",
      description: "Test description",
      whenToUse: ["Only one situation"],
    });
    expect(result).toBe(
      "- **coding__test**: Test description\n  - When to use: Only one situation"
    );
  });
});
