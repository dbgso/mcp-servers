import { describe, it, expect } from "vitest";
import {
  parsePattern,
  findMatches,
  transform,
  applyCaptures,
} from "../codemod/index.js";
import { TsCodemodDescribeHandler } from "../tools/handlers/ts-codemod-describe.js";

describe("Codemod", () => {
  describe("parsePattern", () => {
    it("should parse simple pattern without placeholders", () => {
      const result = parsePattern("hello world");
      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0]).toEqual({ type: "literal", value: "hello world" });
      expect(result.placeholderNames).toEqual([]);
    });

    it("should parse pattern with single placeholder", () => {
      const result = parsePattern("hello :[name]");
      expect(result.tokens).toHaveLength(2);
      expect(result.tokens[0]).toEqual({ type: "literal", value: "hello " });
      expect(result.tokens[1]).toEqual({
        type: "placeholder",
        value: ":[name]",
        name: "name",
      });
      expect(result.placeholderNames).toEqual(["name"]);
    });

    it("should parse pattern with multiple placeholders", () => {
      const result = parsePattern("query(:[file], :[type])");
      expect(result.tokens).toHaveLength(5);
      expect(result.placeholderNames).toEqual(["file", "type"]);
    });

    it("should parse anonymous placeholder", () => {
      const result = parsePattern("console.log(:[_])");
      expect(result.tokens).toHaveLength(3);
      expect(result.placeholderNames).toEqual([]);
    });
  });

  describe("findMatches", () => {
    it("should find simple literal match", () => {
      const result = findMatches({
        source: "hello world hello",
        pattern: "hello",
      });
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].fullMatch).toBe("hello");
      expect(result.matches[0].start).toBe(0);
      expect(result.matches[1].start).toBe(12);
    });

    it("should find match with placeholder", () => {
      const result = findMatches({
        source: 'query(filePath, "headings")',
        pattern: "query(:[file], :[type])",
      });
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].captures.get("file")).toBe("filePath");
      expect(result.matches[0].captures.get("type")).toBe('"headings"');
    });

    it("should find multiple matches with placeholders", () => {
      const source = `
        handler.query(file1, "headings");
        handler.query(file2, "links");
      `;
      const result = findMatches({
        source,
        pattern: "handler.query(:[file], :[type])",
      });
      expect(result.matches).toHaveLength(2);
    });

    it("should handle nested parentheses", () => {
      const result = findMatches({
        source: "foo(bar(baz), qux)",
        pattern: "foo(:[a], :[b])",
      });
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].captures.get("a")).toBe("bar(baz)");
      expect(result.matches[0].captures.get("b")).toBe("qux");
    });
  });

  describe("applyCaptures", () => {
    it("should apply captures to target pattern", () => {
      const captures = new Map([
        ["file", "filePath"],
        ["type", '"headings"'],
      ]);
      const result = applyCaptures({
        target: "query({ filePath: :[file], queryType: :[type] })",
        captures,
      });
      expect(result).toBe('query({ filePath: filePath, queryType: "headings" })');
    });
  });

  describe("transform", () => {
    it("should transform simple pattern", () => {
      const result = transform({
        source: 'handler.query(filePath, "headings")',
        sourcePattern: "handler.query(:[file], :[type])",
        targetPattern: "handler.query({ filePath: :[file], queryType: :[type] })",
      });
      expect(result.result).toBe(
        'handler.query({ filePath: filePath, queryType: "headings" })'
      );
      expect(result.changes).toHaveLength(1);
    });

    it("should transform multiple occurrences", () => {
      const source = `
query(a, b);
query(c, d);
`;
      const result = transform({
        source,
        sourcePattern: "query(:[x], :[y])",
        targetPattern: "query({ x: :[x], y: :[y] })",
      });
      expect(result.result).toContain("query({ x: a, y: b })");
      expect(result.result).toContain("query({ x: c, y: d })");
      expect(result.changes).toHaveLength(2);
    });

    it("should delete pattern when target is empty", () => {
      const result = transform({
        source: 'console.log("debug"); doSomething();',
        sourcePattern: 'console.log(:[_]); ',
        targetPattern: "",
      });
      expect(result.result).toBe("doSomething();");
    });

    it("should handle no matches", () => {
      const result = transform({
        source: "no match here",
        sourcePattern: "foo(:[x])",
        targetPattern: "bar(:[x])",
      });
      expect(result.result).toBe("no match here");
      expect(result.changes).toHaveLength(0);
    });
  });

  describe("TsCodemodDescribeHandler", () => {
    const handler = new TsCodemodDescribeHandler();

    it("should return overview when no task is provided", async () => {
      const result = await handler.execute({});
      expect(result.content[0].type).toBe("text");
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("ts_codemod");
      expect(text).toContain(":[name]");
      expect(text).toContain("適用可能");
      expect(text).toContain("適用できない");
    });

    it("should identify applicable task: console.log removal", async () => {
      const result = await handler.execute({ task: "console.logを全て削除したい" });
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("✅ 適用可能");
      expect(text).toContain("console.log(:[_])");
    });

    it("should identify applicable task: pattern replacement", async () => {
      const result = await handler.execute({ task: "関数呼び出しを一括置換したい" });
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("適用可能");
    });

    it("should identify non-applicable task: type-based", async () => {
      const result = await handler.execute({ task: "型がstringの変数だけ変換したい" });
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("❌ 適用不可");
      expect(text).toContain("型");
    });

    it("should identify non-applicable task: rename with references", async () => {
      const result = await handler.execute({ task: "関数名をリネームして参照も更新" });
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("❌ 適用不可");
      expect(text).toContain("rename_symbol");
    });

    it("should suggest alternatives for non-applicable tasks", async () => {
      const result = await handler.execute({ task: "スコープ内の変数だけ変更" });
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("代替手段");
    });

    it("should handle ambiguous tasks with low confidence", async () => {
      const result = await handler.execute({ task: "何かを変更したい" });
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("low");
      expect(text).toContain("詳細");
    });
  });
});
