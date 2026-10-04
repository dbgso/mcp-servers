import { describe, it, expect } from "vitest";
import { anchorMatchesHeading, headingAnchor, normalizeAnchor } from "../handlers/anchor.js";

describe("headingAnchor", () => {
  it.each([
    { text: "Getting Started", fileType: "markdown", expected: "getting-started" },
    { text: "C++ & Rust!", fileType: "markdown", expected: "c-rust" },
    { text: "- Leading and trailing -", fileType: "markdown", expected: "leading-and-trailing" },
    { text: "詳細設計 の 概要", fileType: "markdown", expected: "詳細設計-の-概要" },
    { text: "Getting Started", fileType: "asciidoc", expected: "_getting_started" },
    { text: "API: v2 (beta)", fileType: "asciidoc", expected: "_api_v2_beta" },
    { text: "詳細設計", fileType: "asciidoc", expected: "_詳細設計" },
  ] as const)("gives $fileType heading '$text' the anchor $expected", ({ text, fileType, expected }) => {
    expect(headingAnchor({ text, fileType })).toBe(expected);
  });
});

describe("normalizeAnchor", () => {
  it("takes out case and the separator style", () => {
    expect(normalizeAnchor("_Section_One")).toBe("section-one");
    expect(normalizeAnchor("section-one")).toBe("section-one");
  });
});

describe("anchorMatchesHeading", () => {
  it.each([
    { anchor: "_section_one", fileType: "asciidoc", matches: true },
    { anchor: "section-one", fileType: "asciidoc", matches: true },
    { anchor: "Section-One", fileType: "markdown", matches: true },
    { anchor: "section-two", fileType: "markdown", matches: false },
  ] as const)("$anchor is the $fileType anchor of 'Section One': $matches", ({ anchor, fileType, matches }) => {
    expect(anchorMatchesHeading({ anchor, headingText: "Section One", fileType })).toBe(matches);
  });

  it("does not match one Japanese heading to another", () => {
    expect(anchorMatchesHeading({ anchor: "存在しない", headingText: "詳細設計", fileType: "markdown" })).toBe(false);
  });
});
