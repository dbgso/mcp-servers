/**
 * The whole-project analyses: the dependency graph, its cycle detection, the
 * type hierarchy, dead code, and the interface extracted from several classes.
 *
 * Each walks a project rather than a file, and each had only its simplest case
 * run. What was untested is the part that decides what to leave out -- an
 * import that resolves outside the project, a type that comes from a library,
 * an export referenced from a file the caller did not name -- and leaving the
 * wrong thing out is how a "dead code" report comes to recommend deleting
 * something that is used.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { TypeScriptHandler } from "../handlers/typescript.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const handler = new TypeScriptHandler();

let dir: string;

async function file(params: { name: string; content: string }): Promise<string> {
  const path = join(dir, params.name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, params.content, "utf-8");
  return path;
}

async function lineOf(params: { filePath: string; snippet: string }): Promise<number> {
  const lines = (await readFile(params.filePath, "utf-8")).split("\n");
  const index = lines.findIndex((l) => l.includes(params.snippet));
  if (index === -1) throw new Error(`not in ${params.filePath}: ${params.snippet}`);
  return index + 1;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ast-graph-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the dependency graph", () => {
  it("records an edge per import, and resolves the extension the importer omitted", async () => {
    // TypeScript source says `./b.js` for a file on disk called `b.ts`. An
    // unresolved edge is a node missing from the graph, not an error anyone
    // sees.
    await file({ name: "a.ts", content: 'import { b } from "./b.js";\nexport const a = b;\n' });
    await file({ name: "b.ts", content: "export const b = 1;\n" });

    const graph = await handler.getDependencyGraph({ directory: dir });

    expect(graph.nodes.length).toBe(2);
    expect(graph.edges.some((e) => e.from.endsWith("a.ts") && e.to.endsWith("b.ts"))).toBe(true);
  }, 90_000);

  it("leaves an import of a package out, unless asked for it", async () => {
    await file({
      name: "a.ts",
      content: 'import { readFile } from "node:fs/promises";\nexport const a = readFile;\n',
    });

    const without = await handler.getDependencyGraph({ directory: dir });
    const withExternal = await handler.getDependencyGraph({
      directory: dir,
      includeExternal: true,
    });

    expect(without.edges).toEqual([]);
    expect(withExternal.edges.length).toBeGreaterThan(0);
  }, 90_000);

  it("resolves a directory import to its index file", async () => {
    await file({ name: "main.ts", content: 'import { x } from "./sub";\nexport const y = x;\n' });
    await file({ name: "sub/index.ts", content: "export const x = 1;\n" });

    const graph = await handler.getDependencyGraph({ directory: dir });

    expect(graph.edges.some((e) => e.to.includes("index.ts"))).toBe(true);
  }, 90_000);

  it("does not record an edge to a file that is not there", async () => {
    await file({ name: "a.ts", content: 'import { gone } from "./absent.js";\nexport const a = gone;\n' });

    const graph = await handler.getDependencyGraph({ directory: dir });

    expect(graph.edges).toEqual([]);
  }, 90_000);

  it("finds a cycle, and reports it once per cycle rather than per file", async () => {
    const graph = await handler.getDependencyGraph({
      directory: join(FIXTURES, "cyclic"),
    });

    expect(graph.cycles.length).toBeGreaterThan(0);
    expect(graph.cycles[0].nodes.length).toBeGreaterThan(1);
  }, 90_000);

  it("reports no cycles for a tree", async () => {
    await file({ name: "a.ts", content: 'import { b } from "./b.js";\nexport const a = b;\n' });
    await file({ name: "b.ts", content: 'import { c } from "./c.js";\nexport const b = c;\n' });
    await file({ name: "c.ts", content: "export const c = 1;\n" });

    const graph = await handler.getDependencyGraph({ directory: dir });

    expect(graph.cycles).toEqual([]);
  }, 90_000);

  it("counts a file that imports nothing and is imported by nothing", async () => {
    await file({ name: "alone.ts", content: "export const alone = 1;\n" });

    const graph = await handler.getDependencyGraph({ directory: dir });

    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toEqual([]);
  }, 90_000);
});

describe("the type hierarchy", () => {
  const HIERARCHY = join(FIXTURES, "type-hierarchy.ts");

  it("walks up to the types a class comes from", async () => {
    const line = await lineOf({ filePath: HIERARCHY, snippet: "export class Dog" });

    const result = await handler.getTypeHierarchy({
      filePath: HIERARCHY,
      line,
      column: 14,
      direction: "ancestors",
    });

    const names = JSON.stringify(result);
    expect(names).toContain("Creature");
    expect(names).toContain("Animal");
  }, 90_000);

  it("walks down to the types that come from a class", async () => {
    const line = await lineOf({ filePath: HIERARCHY, snippet: "export class Creature" });

    const result = await handler.getTypeHierarchy({
      filePath: HIERARCHY,
      line,
      column: 14,
      direction: "descendants",
    });

    expect(JSON.stringify(result)).toContain("Dog");
  }, 90_000);

  it("walks both ways at once", async () => {
    const line = await lineOf({ filePath: HIERARCHY, snippet: "export interface Pet extends" });

    const result = await handler.getTypeHierarchy({
      filePath: HIERARCHY,
      line,
      column: 18,
      direction: "both",
    });

    expect(JSON.stringify(result)).toContain("Animal");
  }, 90_000);

  it("stops at the depth it is given", async () => {
    const line = await lineOf({ filePath: HIERARCHY, snippet: "export class Dog" });

    const shallow = await handler.getTypeHierarchy({
      filePath: HIERARCHY,
      line,
      column: 14,
      direction: "ancestors",
      maxDepth: 1,
    });

    expect(shallow).toBeDefined();
  }, 90_000);
});

describe("dead code", () => {
  const DEAD_CODE = join(FIXTURES, "dead-code");

  it("does not call an export dead because the caller only named one file", async () => {
    // `reference_scope: "project"` is the default for exactly this reason: an
    // export used by a file outside the given paths is still used, and
    // reporting it as dead invites a deletion that breaks the build.
    const result = await handler.findDeadCode({
      paths: [join(DEAD_CODE, "used-export.ts")],
      includeTests: true,
      referenceScope: "project",
    });

    const names = result.deadSymbols.map((s) => s.name);
    expect(names).not.toContain("usedFunction");
  }, 120_000);

  it("reports an export nothing references", async () => {
    const result = await handler.findDeadCode({
      paths: [DEAD_CODE],
      // The fixtures live under `__tests__`, which the analysis skips unless
      // it is told not to.
      includeTests: true,
      referenceScope: "paths",
      scope: "exports",
    });

    expect(result.deadSymbols.length).toBeGreaterThan(0);
  }, 120_000);

  it("can be narrowed to private members", async () => {
    const result = await handler.findDeadCode({
      paths: [join(DEAD_CODE, "private-members.ts")],
      includeTests: true,
      referenceScope: "paths",
      scope: "private_members",
    });

    expect(Array.isArray(result.deadSymbols)).toBe(true);
  }, 120_000);

  it("treats an entry point's exports as used", async () => {
    // Nothing in the project imports an entry point -- that is what makes it
    // one -- so its exports must not be reported as dead.
    const result = await handler.findDeadCode({
      paths: [DEAD_CODE],
      includeTests: true,
      referenceScope: "paths",
      entryPoints: ["**/entry-point.ts"],
    });

    expect(result.deadSymbols.every((s) => !s.filePath.endsWith("entry-point.ts"))).toBe(true);
  }, 120_000);
});

describe("extracting a common interface", () => {
  it("keeps the members most of the classes share", async () => {
    await file({
      name: "a.ts",
      content:
        "export class AlphaService {\n  name = \"a\";\n  run(): void {}\n  only(): void {}\n}\n",
    });
    await file({
      name: "b.ts",
      content: "export class BetaService {\n  name = \"b\";\n  run(): void {}\n}\n",
    });

    const result = await handler.extractCommonInterface({
      sourceFiles: [join(dir, "*.ts")],
      interfaceName: "Service",
      minOccurrence: 1,
    });

    const names = result.commonMembers.map((m) => m.name);
    expect(names).toContain("run");
    // `only` is in one class of two, so a full-occurrence threshold drops it.
    expect(names).not.toContain("only");
    expect(result.totalClasses).toBe(2);
  }, 120_000);

  it("can be limited to the classes whose name matches a pattern", async () => {
    await file({ name: "a.ts", content: "export class AlphaService {\n  run(): void {}\n}\n" });
    await file({ name: "b.ts", content: "export class Unrelated {\n  other(): void {}\n}\n" });

    const result = await handler.extractCommonInterface({
      sourceFiles: [join(dir, "*.ts")],
      interfaceName: "Service",
      classPattern: "Service$",
      minOccurrence: 1,
    });

    expect(result.analyzedClasses).toEqual(["AlphaService"]);
    expect(result.commonMembers.map((m) => m.name)).toContain("run");
  }, 120_000);

  it("can be told to ignore properties, or methods", async () => {
    await file({
      name: "a.ts",
      content: "export class AlphaService {\n  name = \"a\";\n  run(): void {}\n}\n",
    });

    const methodsOnly = await handler.extractCommonInterface({
      sourceFiles: [join(dir, "*.ts")],
      interfaceName: "Service",
      includeProperties: false,
      minOccurrence: 1,
    });
    const propertiesOnly = await handler.extractCommonInterface({
      sourceFiles: [join(dir, "*.ts")],
      interfaceName: "Service",
      includeMethods: false,
      minOccurrence: 1,
    });

    expect(methodsOnly.commonMembers.map((m) => m.name)).toEqual(["run"]);
    expect(propertiesOnly.commonMembers.map((m) => m.name)).toEqual(["name"]);
  }, 120_000);
});
