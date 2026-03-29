import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { TransformAstHandler } from "../tools/handlers/transform-ast.js";

const TEST_DIR = join(import.meta.dirname, "fixtures", "transform-ast-test");

describe("TransformAstHandler", () => {
  let handler: TransformAstHandler;

  beforeAll(() => {
    handler = new TransformAstHandler();
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up test files
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
      mkdirSync(TEST_DIR, { recursive: true });
    } catch {
      // ignore
    }
  });

  describe("query-based transformation", () => {
    it("should find and replace patterns in dry-run mode", async () => {
      const testFile = join(TEST_DIR, "test1.ts");
      writeFileSync(testFile, `
function handle(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  return msg;
}
`);

      const result = await handler.execute({
        path: testFile,
        query_preset: "instanceof_error_ternary",
        replacement: "getErrorMessage(${errorVar})",
        dry_run: true,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.mode).toBe("query");
      expect(data.dryRun).toBe(true);
      expect(data.changes.length).toBeGreaterThanOrEqual(1);
      expect(data.changes[0].replacement).toBe("getErrorMessage(error)");

      // File should not be modified in dry-run
      const content = readFileSync(testFile, "utf-8");
      expect(content).toContain("instanceof Error");
    });

    it("should actually modify files when dry_run is false", async () => {
      const testFile = join(TEST_DIR, "test2.ts");
      writeFileSync(testFile, `
function handle(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
`);

      const result = await handler.execute({
        path: testFile,
        query_preset: "instanceof_error_ternary",
        replacement: "getErrorMessage(${errorVar})",
        dry_run: false,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.dryRun).toBe(false);
      expect(data.filesModified).toBe(1);

      // File should be modified
      const content = readFileSync(testFile, "utf-8");
      expect(content).toContain("getErrorMessage(e)");
      expect(content).not.toContain("instanceof Error");
    });

    it("should add imports when specified", async () => {
      const testFile = join(TEST_DIR, "test3.ts");
      writeFileSync(testFile, `
function handle(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
`);

      const result = await handler.execute({
        path: testFile,
        query_preset: "instanceof_error_ternary",
        replacement: "getErrorMessage(${errorVar})",
        add_imports: [{ from: "mcp-shared", named: ["getErrorMessage"] }],
        dry_run: false,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.importsAdded.length).toBe(1);
      expect(data.importsAdded[0].imports[0].from).toBe("mcp-shared");

      const content = readFileSync(testFile, "utf-8");
      expect(content).toContain('import { getErrorMessage } from "mcp-shared"');
    });

    it("should handle custom queries with captures", async () => {
      const testFile = join(TEST_DIR, "test4.ts");
      writeFileSync(testFile, `
const x = console.log("hello");
const y = console.log("world");
`);

      const result = await handler.execute({
        path: testFile,
        query: {
          kind: "CallExpression",
          expression: {
            kind: "PropertyAccessExpression",
            expression: { $text: "^console$" },
            name: { $text: "^log$" },
          },
          arguments: { $any: true, $capture: "arg" },
        },
        replacement: "logger.info(${arg})",
        dry_run: true,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.changes.length).toBe(2);
      expect(data.changes[0].replacement).toContain("logger.info");
    });

    it("should return empty result when no matches", async () => {
      const testFile = join(TEST_DIR, "test5.ts");
      writeFileSync(testFile, `
function clean() {
  return "no patterns here";
}
`);

      const result = await handler.execute({
        path: testFile,
        query_preset: "instanceof_error_ternary",
        replacement: "getErrorMessage(${errorVar})",
        dry_run: true,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.changes).toHaveLength(0);
      expect(data.totalMatches).toBe(0);
    });
  });

  describe("preset-based transformation (class_to_object)", () => {
    it("should support class_to_object preset", async () => {
      const testFile = join(TEST_DIR, "test6.ts");
      writeFileSync(testFile, `
class MyHandler {
  readonly name = "test";

  execute(args: unknown) {
    return args;
  }
}
`);

      const result = await handler.execute({
        path: testFile,
        preset: "class_to_object",
        dry_run: true,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.mode).toBe("preset");
      expect(data.preset).toBe("class_to_object");
    });
  });

  describe("error handling", () => {
    it("should require query, query_preset, or preset", async () => {
      const testFile = join(TEST_DIR, "test7.ts");
      writeFileSync(testFile, "const x = 1;");

      const result = await handler.execute({
        path: testFile,
        replacement: "something",
      } as Parameters<typeof handler.execute>[0]);

      expect(result.isError).toBeTruthy();
    });

    it("should require replacement for query-based transform", async () => {
      const testFile = join(TEST_DIR, "test8.ts");
      writeFileSync(testFile, "const x = 1;");

      const result = await handler.execute({
        path: testFile,
        query_preset: "instanceof",
      } as Parameters<typeof handler.execute>[0]);

      expect(result.isError).toBeTruthy();
    });

    it("should handle non-existent file gracefully", async () => {
      const result = await handler.execute({
        path: "/non/existent/path.ts",
        query_preset: "instanceof_error_ternary",
        replacement: "getErrorMessage(${errorVar})",
        dry_run: true,
      });

      // Non-existent single file should error (glob for directory returns empty)
      expect(result.isError).toBeTruthy();
    });

    it("should handle empty directory gracefully", async () => {
      const emptyDir = join(TEST_DIR, "empty");
      mkdirSync(emptyDir, { recursive: true });

      const result = await handler.execute({
        path: emptyDir,
        query_preset: "instanceof_error_ternary",
        replacement: "getErrorMessage(${errorVar})",
        dry_run: true,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);
      expect(data.changes).toHaveLength(0);
    });
  });

  describe("directory and multiple files", () => {
    it("should transform multiple files in directory", async () => {
      const file1 = join(TEST_DIR, "multi1.ts");
      const file2 = join(TEST_DIR, "multi2.ts");
      writeFileSync(file1, `
function a(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
`);
      writeFileSync(file2, `
function b(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
`);

      const result = await handler.execute({
        path: TEST_DIR,
        query_preset: "instanceof_error_ternary",
        replacement: "getErrorMessage(${errorVar})",
        dry_run: true,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.filesModified).toBe(2);
      expect(data.totalMatches).toBe(2);
    });

    it("should respect include patterns", async () => {
      const file1 = join(TEST_DIR, "included.ts");
      const file2 = join(TEST_DIR, "excluded.tsx");
      writeFileSync(file1, `const x = e instanceof Error ? e.message : String(e);`);
      writeFileSync(file2, `const y = e instanceof Error ? e.message : String(e);`);

      const result = await handler.execute({
        path: TEST_DIR,
        query_preset: "instanceof_error_ternary",
        replacement: "getErrorMessage(${errorVar})",
        include: ["**/*.ts"],
        exclude: ["**/*.tsx"],
        dry_run: true,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.filesModified).toBe(1);
      expect(data.changes[0].file).toContain("included.ts");
    });
  });

  describe("multiple captures and replacements", () => {
    it("should support multiple captures in replacement template", async () => {
      const testFile = join(TEST_DIR, "multi-capture.ts");
      writeFileSync(testFile, `
const result = a + b;
const sum = x + y;
`);

      const result = await handler.execute({
        path: testFile,
        query: {
          kind: "BinaryExpression",
          left: { kind: "Identifier", $capture: "left" },
          operatorToken: { kind: "PlusToken" },
          right: { kind: "Identifier", $capture: "right" },
        },
        replacement: "add(${left}, ${right})",
        dry_run: true,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.changes).toHaveLength(2);
      // Changes are sorted by position descending (for replacement order)
      // So later positions come first
      const replacements = data.changes.map((c: { replacement: string }) => c.replacement).sort();
      expect(replacements).toContain("add(a, b)");
      expect(replacements).toContain("add(x, y)");
    });

    it("should handle multiple replacements in same file", async () => {
      const testFile = join(TEST_DIR, "same-file.ts");
      writeFileSync(testFile, `
function a(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
function b(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
function c(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
`);

      const result = await handler.execute({
        path: testFile,
        query_preset: "instanceof_error_ternary",
        replacement: "getErrorMessage(${errorVar})",
        dry_run: false,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.totalMatches).toBe(3);
      expect(data.filesModified).toBe(1);

      const content = readFileSync(testFile, "utf-8");
      expect(content).toContain("getErrorMessage(e)");
      expect(content).toContain("getErrorMessage(err)");
      expect(content).toContain("getErrorMessage(error)");
      expect(content).not.toContain("instanceof Error");
    });
  });

  describe("import handling", () => {
    it("should merge into existing import", async () => {
      const testFile = join(TEST_DIR, "existing-import.ts");
      writeFileSync(testFile, `
import { errorResponse } from "mcp-shared";

function handle(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
`);

      const result = await handler.execute({
        path: testFile,
        query_preset: "instanceof_error_ternary",
        replacement: "getErrorMessage(${errorVar})",
        add_imports: [{ from: "mcp-shared", named: ["getErrorMessage"] }],
        dry_run: false,
      });

      expect(result.isError).toBeFalsy();

      const content = readFileSync(testFile, "utf-8");
      // Should have merged, not duplicated
      expect(content).toContain("errorResponse");
      expect(content).toContain("getErrorMessage");
      // Should only have one import from mcp-shared
      const importMatches = content.match(/from "mcp-shared"/g);
      expect(importMatches).toHaveLength(1);
    });

    it("should add default import", async () => {
      const testFile = join(TEST_DIR, "default-import.ts");
      writeFileSync(testFile, `
function handle(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
`);

      const result = await handler.execute({
        path: testFile,
        query_preset: "instanceof_error_ternary",
        replacement: "utils.getErrorMessage(${errorVar})",
        add_imports: [{ from: "./utils", default: "utils" }],
        dry_run: false,
      });

      expect(result.isError).toBeFalsy();

      const content = readFileSync(testFile, "utf-8");
      expect(content).toContain('import utils from "./utils"');
    });
  });

  describe("class_to_object with options", () => {
    it("should support property mappings", async () => {
      const testFile = join(TEST_DIR, "class-props.ts");
      writeFileSync(testFile, `
class TestHandler {
  readonly name = "test";
  readonly description = "Test handler";

  execute(args: unknown) {
    return args;
  }
}
`);

      const result = await handler.execute({
        path: testFile,
        preset: "class_to_object",
        property_mappings: [{ from: "name", to: "id" }],
        dry_run: true,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as { text: string }[])[0].text);

      expect(data.mode).toBe("preset");
      // The classToObject implementation should handle the mapping
    });
  });
});
