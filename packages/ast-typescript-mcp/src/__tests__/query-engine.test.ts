/**
 * The shared query engine behind `transform_ast`.
 *
 * It carries its own copy of the same child-navigation switch `query_ast` has,
 * and the same matching rules -- so the arms had the same problem: a query
 * naming a child the engine does not handle finds nothing, which reads as
 * "your code has none". Driven here directly, over the fixture that carries
 * one of every shape.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { QueryEngine, QUERY_PRESETS } from "../query/engine.js";
import type { AstQuery } from "../query/engine.js";

const NAVIGATION = join(import.meta.dirname, "fixtures", "query-ast", "navigation.ts");
let dir: string;

function engine(): QueryEngine {
  return new QueryEngine();
}

async function search(query: AstQuery, options: Record<string, unknown> = {}) {
  return engine().search({ searchPath: NAVIGATION, query, ...options });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "query-engine-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("searching a path", () => {
  it("reports nothing for a path with no matching files", async () => {
    const result = await engine().search({
      searchPath: dir,
      query: { kind: "FunctionDeclaration" },
    });

    expect(result).toEqual({
      matches: [],
      totalFiles: 0,
      filesWithMatches: 0,
      truncated: false,
    });
  }, 60_000);

  it("counts the files it looked at and the ones that matched", async () => {
    await writeFile(join(dir, "has.ts"), "export function f(): void {}\n", "utf-8");
    await writeFile(join(dir, "hasnt.ts"), "export const a = 1;\n", "utf-8");

    const result = await engine().search({
      searchPath: dir,
      query: { kind: "FunctionDeclaration" },
    });

    expect(result.totalFiles).toBe(2);
    expect(result.filesWithMatches).toBe(1);
    expect(result.truncated).toBe(false);
  }, 60_000);

  it("stops at the limit, and says it stopped", async () => {
    // A query over a large tree would otherwise return everything, which for
    // a tool response means megabytes.
    await writeFile(join(dir, "a.ts"), "export const a = 1;\nexport const b = 2;\n", "utf-8");
    await writeFile(join(dir, "b.ts"), "export const c = 3;\n", "utf-8");

    const result = await engine().search({
      searchPath: dir,
      query: { kind: "VariableDeclaration" },
      limit: 1,
    });

    expect(result.matches).toHaveLength(1);
    expect(result.truncated).toBe(true);
  }, 60_000);

  it("takes the include and exclude patterns it is given", async () => {
    await writeFile(join(dir, "keep.ts"), "export function f(): void {}\n", "utf-8");
    await writeFile(join(dir, "skip.ts"), "export function g(): void {}\n", "utf-8");

    const result = await engine().search({
      searchPath: dir,
      query: { kind: "FunctionDeclaration" },
      include: ["**/keep.ts"],
    });

    expect(result.totalFiles).toBe(1);
  }, 60_000);
});

describe("matching a node", () => {
  it("matches anything with $any", async () => {
    const result = await search({ kind: "FunctionDeclaration", name: { $any: true } });

    expect(result.matches.length).toBeGreaterThan(0);
  }, 60_000);

  it("filters by a regex over the node's text", async () => {
    const matching = await search({ kind: "FunctionDeclaration", $text: "generic" });
    const notMatching = await search({ kind: "FunctionDeclaration", $text: "nonesuch" });

    expect(matching.matches.length).toBeGreaterThan(0);
    expect(notMatching.matches).toEqual([]);
  }, 60_000);

  it("finds nothing for a kind that is not a syntax kind at all", async () => {
    // A typo in `kind` must not match everything.
    const result = await search({ kind: "NotARealKind" });

    expect(result.matches).toEqual([]);
  }, 60_000);

  it("truncates the text it reports for a long node", async () => {
    const result = await search({ kind: "FunctionDeclaration" });

    const longest = result.matches.map((m) => m.text).sort((a, b) => b.length - a.length)[0];
    expect(longest.length).toBeLessThanOrEqual(203);
  }, 60_000);
});

describe("descending into a named child", () => {
  it.each([
    { name: "a call's expression", query: { kind: "CallExpression", expression: { $any: true } } },
    { name: "a property access's expression", query: { kind: "PropertyAccessExpression", expression: { $any: true } } },
    { name: "an await's expression", query: { kind: "AwaitExpression", expression: { $any: true } } },
    { name: "an as-cast's expression", query: { kind: "AsExpression", expression: { $any: true } } },
    { name: "a non-null assertion's expression", query: { kind: "NonNullExpression", expression: { $any: true } } },
    { name: "a parenthesised expression", query: { kind: "ParenthesizedExpression", expression: { $any: true } } },
    { name: "a property access's name", query: { kind: "PropertyAccessExpression", name: { $any: true } } },
    { name: "a function's name", query: { kind: "FunctionDeclaration", name: { $any: true } } },
    { name: "a class's name", query: { kind: "ClassDeclaration", name: { $any: true } } },
    { name: "a method's name", query: { kind: "MethodDeclaration", name: { $any: true } } },
    { name: "a binary expression's operator", query: { kind: "BinaryExpression", operatorToken: { $any: true } } },
    { name: "a binary expression's left side", query: { kind: "BinaryExpression", left: { $any: true } } },
    { name: "a binary expression's right side", query: { kind: "BinaryExpression", right: { $any: true } } },
    { name: "a ternary's when-true branch", query: { kind: "ConditionalExpression", whenTrue: { $any: true } } },
    { name: "a ternary's when-false branch", query: { kind: "ConditionalExpression", whenFalse: { $any: true } } },
    { name: "a call's first argument", query: { kind: "CallExpression", arguments: { $any: true } } },
    { name: "a call's type arguments", query: { kind: "CallExpression", typeArguments: { $any: true } } },
  ])("finds $name", async ({ query }) => {
    const result = await search(query as AstQuery);

    expect(result.matches.length).toBeGreaterThan(0);
  }, 60_000);

  it("finds nothing for a property name this engine does not know", async () => {
    // The engine's vocabulary is smaller than `query_ast`'s -- it has no
    // `initializer`, `type`, `moduleSpecifier` or `thenStatement` -- so a
    // query written for one and run through the other silently finds
    // nothing. Recorded here so the difference is visible.
    const result = await search({ kind: "VariableDeclaration", initializer: { $any: true } });

    expect(result.matches).toEqual([]);
  }, 60_000);

  it("finds nothing for a child the node does not have", async () => {
    const result = await search({ kind: "ClassDeclaration", initializer: { $any: true } });

    expect(result.matches).toEqual([]);
  }, 60_000);

  it("finds nothing when the child is there but does not match", async () => {
    const result = await search({
      kind: "CallExpression",
      expression: { kind: "NumericLiteral" },
    });

    expect(result.matches).toEqual([]);
  }, 60_000);
});

describe("captures", () => {
  it("record the text and position of the node they name", async () => {
    const result = await search({
      kind: "CallExpression",
      $capture: "call",
      expression: { $capture: "callee" },
    });

    const first = result.matches[0];
    expect(first.captures.call.text).toBeTruthy();
    expect(first.captures.callee.line).toBeGreaterThan(0);
  }, 60_000);
});

describe("the presets", () => {
  it("are all valid queries with a kind", () => {
    // They are the entry point most callers use, so a preset that names a
    // syntax kind that does not exist silently finds nothing.
    for (const [name, query] of Object.entries(QUERY_PRESETS)) {
      expect(query.kind, name).toBeTruthy();
    }
  });
});
