import { describe, expect, it } from "vitest";

import {
  charWidthEm,
  estimateTextWidth,
  isWideChar,
  measureNode,
  MIN_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  tokenize,
  elideToWidth,
  wrapLabel,
} from "../measure.js";
import type { MeasureLabel } from "../types.js";

/** One unit per character, so expectations read as character counts. */
const unitMeasure: MeasureLabel = ({ text }) => [...text].length;

describe("isWideChar", () => {
  type Case = { char: string; expected: boolean };
  const cases: Case[] = [
    { char: "漢", expected: true },
    { char: "あ", expected: true },
    { char: "ア", expected: true },
    { char: "한", expected: true },
    { char: "Ａ", expected: true },
    { char: "a", expected: false },
    { char: " ", expected: false },
    { char: "!", expected: false },
    { char: "—", expected: false },
  ];

  it.each(cases)("$char -> $expected", ({ char, expected }) => {
    expect(isWideChar({ char })).toBe(expected);
  });

  it("returns false for an empty string", () => {
    expect(isWideChar({ char: "" })).toBe(false);
  });
});

describe("charWidthEm", () => {
  type Case = { name: string; char: string; expected: number };
  const cases: Case[] = [
    { name: "wide characters take a full em", char: "図", expected: 1.0 },
    { name: "narrow characters take less", char: "i", expected: 0.32 },
    { name: "spaces are narrow", char: " ", expected: 0.32 },
    { name: "regular latin sits in between", char: "m", expected: 0.58 },
  ];

  it.each(cases)("$name", ({ char, expected }) => {
    expect(charWidthEm({ char })).toBe(expected);
  });
});

describe("estimateTextWidth", () => {
  it("scales with font size", () => {
    const small = estimateTextWidth({ text: "hello", fontSize: 10 });
    const large = estimateTextWidth({ text: "hello", fontSize: 20 });
    expect(large).toBeCloseTo(small * 2);
  });

  it("counts CJK wider than latin of the same length", () => {
    const cjk = estimateTextWidth({ text: "日本語表示", fontSize: 13 });
    const latin = estimateTextWidth({ text: "abcde", fontSize: 13 });
    expect(cjk).toBeGreaterThan(latin);
  });

  it("measures empty text as zero", () => {
    expect(estimateTextWidth({ text: "", fontSize: 13 })).toBe(0);
  });
});

describe("tokenize", () => {
  type Case = { name: string; text: string; expected: string[] };
  const cases: Case[] = [
    { name: "splits after spaces", text: "a b", expected: ["a ", "b"] },
    { name: "splits after hyphens", text: "mcp-tool", expected: ["mcp-", "tool"] },
    { name: "splits after slashes and underscores", text: "a/b_c", expected: ["a/", "b_", "c"] },
    { name: "splits CJK per character", text: "図示", expected: ["図", "示"] },
    { name: "separates mixed runs", text: "ab図", expected: ["ab", "図"] },
    { name: "handles empty text", text: "", expected: [] },
  ];

  it.each(cases)("$name", ({ text, expected }) => {
    expect(tokenize({ text })).toEqual(expected);
  });
});

describe("wrapLabel", () => {
  it("returns a single empty line for empty text", () => {
    expect(wrapLabel({ text: "", maxWidth: 10, fontSize: 1, measure: unitMeasure })).toEqual([""]);
  });

  it("keeps short text on one line", () => {
    expect(wrapLabel({ text: "abc", maxWidth: 10, fontSize: 1, measure: unitMeasure })).toEqual(["abc"]);
  });

  it("breaks on word boundaries", () => {
    expect(
      wrapLabel({ text: "alpha beta gamma", maxWidth: 11, fontSize: 1, measure: unitMeasure }),
    ).toEqual(["alpha beta", "gamma"]);
  });

  it("keeps an oversized single token rather than dropping it", () => {
    expect(wrapLabel({ text: "abcdefghij", maxWidth: 3, fontSize: 1, measure: unitMeasure })).toEqual([
      "abcdefghij",
    ]);
  });

  it("truncates the last line once the line budget is spent", () => {
    const lines = wrapLabel({
      text: "one two three four five six seven",
      maxWidth: 9,
      fontSize: 1,
      measure: unitMeasure,
      maxLines: 2,
    });
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });

  it("wraps CJK per character", () => {
    expect(wrapLabel({ text: "図示対象", maxWidth: 2, fontSize: 1, measure: unitMeasure })).toEqual([
      "図示",
      "対象",
    ]);
  });
});

describe("elideToWidth", () => {
  type Case = { name: string; text: string; maxWidth: number; expected: string };
  const cases: Case[] = [
    { name: "appends an ellipsis when there is room", text: "abc", maxWidth: 5, expected: "abc…" },
    { name: "drops characters to make room", text: "abcdef", maxWidth: 4, expected: "abc…" },
    { name: "falls back to just the ellipsis", text: "abcdef", maxWidth: 1, expected: "…" },
  ];

  it.each(cases)("$name", ({ text, maxWidth, expected }) => {
    expect(elideToWidth({ text, maxWidth, fontSize: 1, measure: unitMeasure })).toBe(expected);
  });
});

describe("measureNode", () => {
  it("never goes below the minimum size", () => {
    const measured = measureNode({ label: "a", fontSize: 4, measure: estimateTextWidth });
    expect(measured.width).toBe(MIN_NODE_WIDTH);
    expect(measured.height).toBe(MIN_NODE_HEIGHT);
  });

  it("grows with the label", () => {
    const short = measureNode({ label: "a", fontSize: 13, measure: estimateTextWidth });
    const long = measureNode({
      label: "a considerably longer label",
      fontSize: 13,
      measure: estimateTextWidth,
    });
    expect(long.width).toBeGreaterThan(short.width);
  });

  it("grows taller when the label wraps", () => {
    const measured = measureNode({
      label: "a label long enough that it has to wrap over several lines",
      fontSize: 13,
      measure: estimateTextWidth,
    });
    expect(measured.lines.length).toBeGreaterThan(1);
    expect(measured.height).toBeGreaterThan(MIN_NODE_HEIGHT);
  });

  it("honours explicit dimensions", () => {
    const measured = measureNode({
      label: "anything",
      fontSize: 13,
      measure: estimateTextWidth,
      explicitWidth: 300,
      explicitHeight: 20,
    });
    expect(measured).toMatchObject({ width: 300, height: 20 });
  });
});
