import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root } from "mdast";
import { collectNodes, findNodeAt, spans } from "../handlers/mdast-walk.js";

const parse = (content: string) => unified().use(remarkParse).parse(content) as Root;

describe("collectNodes", () => {
  it("finds nodes of a type at any depth, in document order", () => {
    const root = parse("# One\n\n> ## Two\n\n- item with [a](a.md)\n\n[b](b.md)\n");

    expect(collectNodes({ root, type: "heading" }).map((h) => h.depth)).toEqual([1, 2]);
    expect(collectNodes({ root, type: "link" }).map((l) => l.url)).toEqual(["a.md", "b.md"]);
  });
});

describe("spans", () => {
  // `[link](x.md)` starts at column 5. remark's end column, 17, is one past its
  // last character; go_to_definition has always counted it as inside.
  const root = parse("See [link](x.md) here\n");
  const link = collectNodes({ root, type: "link" })[0];

  it.each([
    { line: 1, column: 4, inside: false },
    { line: 1, column: 5, inside: true },
    { line: 1, column: 17, inside: true },
    { line: 1, column: 18, inside: false },
    { line: 2, column: 1, inside: false },
  ])("line $line column $column is inside: $inside", ({ line, column, inside }) => {
    expect(spans({ node: link, line, column })).toBe(inside);
  });

  it("covers every column of a line strictly between start and end", () => {
    const multi = parse("```\na\nb\nc\n```\n");
    const code = collectNodes({ root: multi, type: "code" })[0];

    expect(spans({ node: code, line: 3, column: 99 })).toBe(true);
    expect(spans({ node: code, line: 1, column: 1 })).toBe(true);
  });

  it("says no for a node built by hand, which has no position", () => {
    expect(spans({ node: { type: "text", value: "x" }, line: 1, column: 1 })).toBe(false);
  });
});

describe("findNodeAt", () => {
  it("finds the link under a position, and nothing between links", () => {
    const root = parse("[a](a.md) and [b](b.md)\n");

    expect(findNodeAt({ root, type: "link", line: 1, column: 16 })?.url).toBe("b.md");
    expect(findNodeAt({ root, type: "link", line: 1, column: 12 })).toBeUndefined();
  });
});
