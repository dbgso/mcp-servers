import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { QueryAstHandler } from "../tools/handlers/query-ast.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures", "query-ast");

describe("QueryAstHandler", () => {
  let handler: QueryAstHandler;

  beforeAll(() => {
    handler = new QueryAstHandler();
  });

  describe("preset: instanceof", () => {
    it("should find instanceof checks", async () => {
      const testFile = join(FIXTURES_DIR, "instanceof.ts");

      const result = await handler.execute({
        path: testFile,
        preset: "instanceof",
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(2);
      expect(data.matches[0].text).toContain("instanceof Error");
      expect(data.matches[1].text).toContain("instanceof Array");
    });
  });

  describe("preset: console_log", () => {
    it("should find console.log calls", async () => {
      const testFile = join(FIXTURES_DIR, "console-log.ts");

      const result = await handler.execute({
        path: testFile,
        preset: "console_log",
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(2);
      expect(data.matches[0].text).toContain("console.log");
      expect(data.matches[1].text).toContain("console.log");
    });
  });

  describe("preset: await_then", () => {
    it("should find await promise.then() anti-pattern", async () => {
      const testFile = join(FIXTURES_DIR, "await-then.ts");

      const result = await handler.execute({
        path: testFile,
        preset: "await_then",
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(1);
      expect(data.matches[0].text).toContain("await fetch");
      expect(data.matches[0].text).toContain(".then");
    });
  });

  describe("preset: non_null_assertion", () => {
    it("should find non-null assertions", async () => {
      const testFile = join(FIXTURES_DIR, "non-null.ts");

      const result = await handler.execute({
        path: testFile,
        preset: "non_null_assertion",
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(2);
      expect(data.matches[0].text).toContain("!");
    });
  });

  describe("preset: type_assertion", () => {
    it("should find type assertions", async () => {
      const testFile = join(FIXTURES_DIR, "type-assertion.ts");

      const result = await handler.execute({
        path: testFile,
        preset: "type_assertion",
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(2);
      expect(data.matches[0].text).toContain("as string");
      expect(data.matches[1].text).toContain("as number");
    });
  });

  describe("preset: any_type", () => {
    it("should find any type usage", async () => {
      const testFile = join(FIXTURES_DIR, "any-type.ts");

      const result = await handler.execute({
        path: testFile,
        preset: "any_type",
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      // Should find multiple 'any' type references
      expect(data.matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("custom query", () => {
    it("should find nodes by kind", async () => {
      const testFile = join(FIXTURES_DIR, "arrow-function.ts");

      const result = await handler.execute({
        path: testFile,
        query: { kind: "ArrowFunction" },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(1);
      expect(data.matches[0].kind).toBe("ArrowFunction");
    });

    it("should support $text regex matching", async () => {
      const testFile = join(FIXTURES_DIR, "variables.ts");

      const result = await handler.execute({
        path: testFile,
        query: {
          kind: "Identifier",
          $text: "^API_",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches.length).toBeGreaterThanOrEqual(1);
      expect(data.matches[0].text).toContain("API_");
    });

    it("should support $capture", async () => {
      const testFile = join(FIXTURES_DIR, "capture.ts");

      const result = await handler.execute({
        path: testFile,
        query: {
          kind: "BinaryExpression",
          operatorToken: { kind: "InstanceOfKeyword" },
          right: { kind: "Identifier", $capture: "className" },
        },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(1);
      expect(data.matches[0].captures).toBeDefined();
      expect(data.matches[0].captures?.className.text).toBe("CustomError");
      expect(typeof data.matches[0].captures?.className.line).toBe("number");
      expect(typeof data.matches[0].captures?.className.column).toBe("number");
    });

    it("should support $any wildcard matching", async () => {
      const testFile = join(FIXTURES_DIR, "instanceof.ts");

      const result = await handler.execute({
        path: testFile,
        query: {
          kind: "BinaryExpression",
          operatorToken: { kind: "InstanceOfKeyword" },
          right: { $any: true, $capture: "type" },
        },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(2);
      expect(data.matches[0].captures?.type).toBeDefined();
    });
  });

  describe("directory search", () => {
    it("should search multiple files in directory", async () => {
      // Search the entire fixtures directory
      const result = await handler.execute({
        path: FIXTURES_DIR,
        preset: "console_log",
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      // console-log.ts has 2, many-logs.ts has 5
      expect(data.matches.length).toBeGreaterThanOrEqual(7);
      expect(data.filesWithMatches).toBeGreaterThanOrEqual(2);
    });
  });

  describe("limit", () => {
    it("should respect limit parameter", async () => {
      const testFile = join(FIXTURES_DIR, "many-logs.ts");

      const result = await handler.execute({
        path: testFile,
        preset: "console_log",
        limit: 3,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(3);
      expect(data.truncated).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should require either query or preset", async () => {
      const testFile = join(FIXTURES_DIR, "clean.ts");

      const result = await handler.execute({
        path: testFile,
      } as Parameters<typeof handler.execute>[0]);

      expect(result.isError).toBeTruthy();
    });

    it("should handle non-existent file gracefully", async () => {
      const result = await handler.execute({
        path: "/non/existent/file.ts",
        preset: "instanceof",
      });

      expect(result.isError).toBeTruthy();
    });

    it("should handle invalid SyntaxKind in query", async () => {
      const testFile = join(FIXTURES_DIR, "clean.ts");

      const result = await handler.execute({
        path: testFile,
        query: { kind: "InvalidSyntaxKindThatDoesNotExist" },
      });

      // Should not error, just return no matches
      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.matches).toHaveLength(0);
    });
  });

  describe("no matches", () => {
    it("should return empty array when no matches found", async () => {
      const testFile = join(FIXTURES_DIR, "clean.ts");

      const result = await handler.execute({
        path: testFile,
        preset: "instanceof",
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(0);
      expect(data.filesWithMatches).toBe(0);
    });
  });

  describe("result structure", () => {
    it("should include file, line, column, text, and kind", async () => {
      const testFile = join(FIXTURES_DIR, "instanceof.ts");

      const result = await handler.execute({
        path: testFile,
        preset: "instanceof",
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      const match = data.matches[0];
      expect(match.file).toBe(testFile);
      expect(typeof match.line).toBe("number");
      expect(typeof match.column).toBe("number");
      expect(typeof match.text).toBe("string");
      expect(match.kind).toBe("BinaryExpression");
    });

    it("should include totalFiles and filesWithMatches", async () => {
      const testFile = join(FIXTURES_DIR, "instanceof.ts");

      const result = await handler.execute({
        path: testFile,
        preset: "instanceof",
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.totalFiles).toBe(1);
      expect(data.filesWithMatches).toBe(1);
      expect(data.preset).toBe("instanceof");
    });

    it("should truncate long match text to 200 characters", async () => {
      const testFile = join(FIXTURES_DIR, "long-text.ts");

      const result = await handler.execute({
        path: testFile,
        preset: "instanceof",
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      // Long instanceof expression should be truncated
      if (data.matches.length > 0) {
        expect(data.matches[0].text.length).toBeLessThanOrEqual(203); // 200 + "..."
        expect(data.matches[0].text).toMatch(/\.\.\.$/);
      }
    });
  });

  describe("include/exclude options", () => {
    it("should respect include patterns", async () => {
      const result = await handler.execute({
        path: FIXTURES_DIR,
        preset: "console_log",
        include: ["**/console-log.ts"],
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      // Should only search console-log.ts (2 matches)
      expect(data.totalFiles).toBe(1);
      expect(data.matches).toHaveLength(2);
    });

    it("should respect exclude patterns", async () => {
      const result = await handler.execute({
        path: FIXTURES_DIR,
        preset: "console_log",
        include: ["**/console-log.ts", "**/many-logs.ts"],
        exclude: ["**/many-logs.ts"],
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      // Should exclude many-logs.ts, leaving only console-log.ts (2 matches)
      expect(data.matches).toHaveLength(2);
    });
  });

  describe("nested property matching", () => {
    it("should match left property of BinaryExpression", async () => {
      const testFile = join(FIXTURES_DIR, "binary-ops.ts");

      const result = await handler.execute({
        path: testFile,
        query: {
          kind: "BinaryExpression",
          left: { kind: "NumericLiteral", $text: "^1$" },
        },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(1);
      expect(data.matches[0].text).toBe("1 + 2");
    });

    it("should match right property of BinaryExpression", async () => {
      const testFile = join(FIXTURES_DIR, "binary-ops.ts");

      const result = await handler.execute({
        path: testFile,
        query: {
          kind: "BinaryExpression",
          right: { kind: "Identifier", $text: "^y$" },
        },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(1);
      expect(data.matches[0].text).toBe("x === y");
    });

    it("should match arguments property of CallExpression", async () => {
      const testFile = join(FIXTURES_DIR, "call-args.ts");

      const result = await handler.execute({
        path: testFile,
        query: {
          kind: "CallExpression",
          arguments: { kind: "StringLiteral", $text: "warning" },
        },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(1);
      expect(data.matches[0].text).toContain("console.warn");
    });
  });

  describe("multiple captures", () => {
    it("should capture multiple nodes in same query", async () => {
      const testFile = join(FIXTURES_DIR, "multi-capture.ts");

      const result = await handler.execute({
        path: testFile,
        query: {
          kind: "BinaryExpression",
          operatorToken: { kind: "InstanceOfKeyword" },
          left: { $any: true, $capture: "variable" },
          right: { $any: true, $capture: "type" },
        },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(2);
      expect(data.matches[0].captures?.variable).toBeDefined();
      expect(data.matches[0].captures?.type).toBeDefined();
      expect(data.matches[0].captures?.variable.text).toBe("error");
      expect(data.matches[0].captures?.type.text).toBe("TypeError");
      expect(data.matches[1].captures?.variable.text).toBe("value");
      expect(data.matches[1].captures?.type.text).toBe("CustomClass");
    });
  });

  describe("tsx file support", () => {
    it("should search .tsx files", async () => {
      const testFile = join(FIXTURES_DIR, "component.tsx");

      const result = await handler.execute({
        path: testFile,
        preset: "console_log",
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(1);
      expect(data.matches[0].text).toContain("console.log");
    });

    it("should include .tsx files in directory search", async () => {
      const result = await handler.execute({
        path: FIXTURES_DIR,
        query: { kind: "JsxElement" },
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches.length).toBeGreaterThanOrEqual(1);
      expect(data.matches[0].file).toContain(".tsx");
    });
  });

  describe("empty directory", () => {
    it("should return zero matches for empty directory", async () => {
      const emptyDir = join(FIXTURES_DIR, "empty-dir");

      const result = await handler.execute({
        path: emptyDir,
        preset: "instanceof",
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(0);
      expect(data.totalFiles).toBe(0);
      expect(data.filesWithMatches).toBe(0);
      expect(data.truncated).toBe(false);
    });
  });

  describe("cross-file limit truncation", () => {
    it("should truncate across multiple files", async () => {
      // console-log.ts has 2, many-logs.ts has 5, call-args.ts has 1, component.tsx has 1 = 9 total
      const result = await handler.execute({
        path: FIXTURES_DIR,
        preset: "console_log",
        limit: 4,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(4);
      expect(data.truncated).toBe(true);
      // Should have searched at least 2 files before hitting limit
      expect(data.filesWithMatches).toBeGreaterThanOrEqual(1);
    });

    it("should stop searching files after limit reached", async () => {
      const result = await handler.execute({
        path: FIXTURES_DIR,
        preset: "console_log",
        limit: 2,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.matches).toHaveLength(2);
      expect(data.truncated).toBe(true);
    });
  });
});
