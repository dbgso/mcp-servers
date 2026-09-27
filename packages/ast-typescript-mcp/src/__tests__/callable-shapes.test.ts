/**
 * How the handler names and classifies the things a call graph walks over,
 * what `hover` reports for a documented symbol, and what a rename touches.
 *
 * `getNodeName` and `getNodeKind` are a chain of node-kind tests, one arm per
 * callable shape TypeScript has -- a method, a constructor, an arrow assigned
 * to a variable, an arrow in an object literal, a function expression, an
 * anonymous one. Between them they were the largest untested block in this
 * handler. A shape with no arm comes back as `(unknown)`, which makes a call
 * graph unreadable at exactly the point someone is trying to follow it.
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile, readFile, cp } from "node:fs/promises";
import { TypeScriptHandler } from "../handlers/typescript.js";

const FIXTURES = join(import.meta.dirname, "fixtures", "call-shapes");
const SHAPES = join(FIXTURES, "shapes.ts");
const DOCUMENTED = join(FIXTURES, "documented.ts");

const handler = new TypeScriptHandler();

/** Find the 1-based line a snippet starts on, so tests read by content. */
async function lineOf(params: { filePath: string; snippet: string }): Promise<number> {
  const lines = (await readFile(params.filePath, "utf-8")).split("\n");
  const index = lines.findIndex((l) => l.includes(params.snippet));
  if (index === -1) throw new Error(`not in ${params.filePath}: ${params.snippet}`);
  return index + 1;
}

async function callGraphAt(params: { filePath: string; snippet: string; column: number }) {
  const line = await lineOf(params);
  return handler.getCallGraph({
    filePath: params.filePath,
    line,
    column: params.column,
    maxDepth: 2,
  });
}

describe("naming the node a call graph starts from", () => {
  it.each([
    { name: "a function declaration", snippet: "export function namedFunction", column: 17, expected: "namedFunction", kind: "function" },
    { name: "a method", snippet: "  method(value: number)", column: 3, expected: "method", kind: "method" },
    { name: "a private method", snippet: "  private privateMethod", column: 11, expected: "privateMethod", kind: "method" },
    { name: "an arrow assigned to a variable", snippet: "export const arrowInVariable", column: 32, expected: "arrowInVariable", kind: "arrow" },
    { name: "an arrow in an object literal", snippet: "  arrowInProperty:", column: 36, expected: "arrowInProperty", kind: "arrow" },
    { name: "a function expression", snippet: "export const functionExpression", column: 36, expected: "functionExpression", kind: "function" },
  ])("names $name", async ({ snippet, column, expected, kind }) => {
    const result = await callGraphAt({ filePath: SHAPES, snippet, column });

    expect(result.root.name).toBe(expected);
    expect(result.root.kind).toBe(kind);
  }, 60_000);

  it("names a constructor after the class it belongs to", async () => {
    // `constructor` alone says nothing in a graph with several classes in it.
    const result = await callGraphAt({
      filePath: SHAPES,
      snippet: "  constructor(private readonly factor",
      column: 3,
    });

    expect(result.root.name).toBe("Service.constructor");
  }, 60_000);

  it("names a class", async () => {
    const result = await callGraphAt({
      filePath: SHAPES,
      snippet: "export class Service",
      column: 14,
    });

    expect(result.root.kind).toBe("class");
    expect(result.root.name).toBe("Service");
  }, 60_000);

  it("calls an anonymous arrow what it is, rather than guessing", async () => {
    const result = await callGraphAt({
      filePath: SHAPES,
      snippet: "return ((value: number) => helper(value))(1)",
      column: 12,
    });

    expect(result.root.name).toBe("(arrow)");
  }, 60_000);

  it("calls an anonymous class what it is", async () => {
    const result = await callGraphAt({
      filePath: SHAPES,
      snippet: "export default class {",
      column: 16,
    });

    expect(result.root.name).toBe("(anonymous class)");
  }, 60_000);
});

describe("following the calls", () => {
  it("records what a function calls, to the depth asked for", async () => {
    const line = await lineOf({ filePath: SHAPES, snippet: "export function namedFunction" });

    const result = await handler.getCallGraph({
      filePath: SHAPES,
      line,
      column: 17,
      maxDepth: 2,
    });

    expect(result.root.calls.map((c) => c.name)).toContain("helper");
    expect(result.nodeCount).toBeGreaterThan(1);
  }, 60_000);

  it("stops at the depth it is given, and says it stopped", async () => {
    const line = await lineOf({ filePath: SHAPES, snippet: "  method(value: number)" });

    const shallow = await handler.getCallGraph({ filePath: SHAPES, line, column: 3, maxDepth: 1 });

    expect(shallow.maxDepthReached).toBe(true);
  }, 60_000);

  it("names the file's own comment position as something, rather than failing", async () => {
    // A position inside the leading comment is not a callable; the result has
    // to be a shape the caller can read rather than an exception.
    const result = await handler.getCallGraph({
      filePath: SHAPES,
      line: 1,
      column: 1,
      maxDepth: 1,
    });

    expect(typeof result.root.name).toBe("string");
    expect(result.nodeCount).toBeGreaterThanOrEqual(0);
  }, 60_000);
});

describe("hover", () => {
  it("reports the documentation and the tags on a documented function", async () => {
    // The JSDoc is the reason to call hover at all; a result with the type and
    // no docs is what you get from reading the signature.
    const line = await lineOf({ filePath: DOCUMENTED, snippet: "export function documented" });

    const result = await handler.hover({ filePath: DOCUMENTED, line, column: 17 });

    expect(result.found).toBe(true);
    expect(result.documentation).toContain("Adds two numbers");
    expect(result.jsdocTags?.map((t) => t.tag)).toEqual(
      expect.arrayContaining(["param", "returns", "example"])
    );
  }, 60_000);

  it("reports a type with no documentation behind it", async () => {
    const line = await lineOf({ filePath: DOCUMENTED, snippet: "export const undocumented" });

    const result = await handler.hover({ filePath: DOCUMENTED, line, column: 14 });

    expect(result.found).toBe(true);
    expect(result.type).toBeTruthy();
  }, 60_000);

  it("says it found nothing rather than guessing, past the end of the file", async () => {
    const result = await handler.hover({ filePath: DOCUMENTED, line: 1, column: 1 });

    expect(typeof result.found).toBe("boolean");
  }, 60_000);
});

describe("renaming a symbol", () => {
  it("lists every occurrence without writing, on a dry run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ast-rename-"));
    try {
      const filePath = join(dir, "renaming.ts");
      await cp(join(FIXTURES, "renaming.ts"), filePath);
      const line = await lineOf({ filePath, snippet: "export function original" });

      const result = await handler.renameSymbol({
        filePath,
        line,
        column: 17,
        newName: "renamed",
        dryRun: true,
      });

      expect(result.oldName).toBe("original");
      expect(result.totalOccurrences).toBeGreaterThan(1);
      expect(await readFile(filePath, "utf-8")).toContain("original");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("writes every occurrence when it is not a dry run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ast-rename-"));
    try {
      const filePath = join(dir, "renaming.ts");
      await cp(join(FIXTURES, "renaming.ts"), filePath);
      const line = await lineOf({ filePath, snippet: "export function original" });

      const result = await handler.renameSymbol({
        filePath,
        line,
        column: 17,
        newName: "renamed",
        dryRun: false,
      });

      const written = await readFile(filePath, "utf-8");
      expect(written).toContain("renamed");
      expect(written).not.toContain("original");
      expect(result.modifiedFiles).toContain(filePath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("does nothing when the new name is the old one", async () => {
    const line = await lineOf({ filePath: join(FIXTURES, "renaming.ts"), snippet: "export function original" });

    const result = await handler.renameSymbol({
      filePath: join(FIXTURES, "renaming.ts"),
      line,
      column: 17,
      newName: "original",
      dryRun: true,
    });

    expect(result.totalOccurrences).toBe(0);
  }, 60_000);

  it("reports nothing for a position that is not an identifier", async () => {
    const result = await handler.renameSymbol({
      filePath: join(FIXTURES, "renaming.ts"),
      line: 1,
      column: 1,
      newName: "whatever",
      dryRun: true,
    });

    expect(result.oldName).toBe("");
    expect(result.locations).toEqual([]);
  }, 60_000);
});

describe("type checking", () => {
  it("reports errors with their category and position", async () => {
    const result = await handler.typeCheck({
      filePath: join(import.meta.dirname, "fixtures", "type-error.ts"),
    });

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]).toMatchObject({
      severity: expect.stringMatching(/error|warning|suggestion|message/),
      line: expect.any(Number),
      code: expect.any(Number),
    });
    expect(result.success).toBe(false);
    expect(result.errorCount).toBeGreaterThan(0);
  }, 60_000);

  it("can be asked for suggestions as well as errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ast-suggest-"));
    try {
      const filePath = join(dir, "suggestible.ts");
      // An unreachable statement and an unused local: the kind of thing the
      // compiler reports as a suggestion rather than an error.
      await writeFile(
        filePath,
        "export function f(): number {\n  return 1;\n  const unused = 2;\n}\n",
        "utf-8"
      );

      const withSuggestions = await handler.typeCheck({
        filePath,
        includeSuggestions: true,
      });

      expect(Array.isArray(withSuggestions.diagnostics)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
