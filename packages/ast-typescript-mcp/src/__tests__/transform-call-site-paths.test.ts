/**
 * `transform_call_site` in each of the four ways it can be driven, and each
 * way a call can fail to be transformable.
 *
 * This tool rewrites `f(a, b)` into `f({ x: a, y: b })` at one position. It
 * has four entry points -- standalone, inside a batch context, a two-phase
 * "prepare then apply by position", and a two-phase "collect then apply by
 * node" -- because a batch rewriting several calls in one file invalidates
 * every node reference it has not already collected. Only the first was
 * tested, and a rewrite that lands at the wrong offset corrupts source.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { Project } from "ts-morph";
import { TransformCallSiteHandler } from "../tools/handlers/transform-call-site.js";

const handler = new TransformCallSiteHandler();
let dir: string;

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((c) => c.text ?? "").join("\n");

const json = (r: { content: { type: string; text?: string }[] }) =>
  JSON.parse(text(r)) as Record<string, unknown>;

async function file(content: string, name = "calls.ts"): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content, "utf-8");
  return path;
}

/** The line a snippet is on, 1-based. */
function lineOf(content: string, snippet: string): number {
  const index = content.split("\n").findIndex((l) => l.includes(snippet));
  if (index === -1) throw new Error(`not found: ${snippet}`);
  return index + 1;
}

const SOURCE = `export function create(name: string, age: number): string {
  return name + age;
}

const name = "alice";
export const made = create(name, 30);
export const literal = create("bob", 40);
export const already = create({ name: "carol", age: 50 });
export const tooMany = create("dave", 60, 70 as never);
export const nothing = 1;
`;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "call-site-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("standalone", () => {
  it("previews the rewrite without touching the file", async () => {
    const path = await file(SOURCE);
    const line = lineOf(SOURCE, "export const literal");

    const result = await handler.execute({
      file_path: path,
      line,
      column: 24,
      param_names: ["name", "age"],
      dry_run: true,
    });

    const data = json(result);
    expect(data.before).toBe('create("bob", 40)');
    expect(data.after).toBe('create({ name: "bob", age: 40 })');
    expect(data.modified).toBe(false);
    expect(await readFile(path, "utf-8")).toContain('create("bob", 40)');
  }, 60_000);

  it("writes the rewrite when it is not a dry run", async () => {
    const path = await file(SOURCE);
    const line = lineOf(SOURCE, "export const literal");

    await handler.execute({
      file_path: path,
      line,
      column: 24,
      param_names: ["name", "age"],
      dry_run: false,
    });

    expect(await readFile(path, "utf-8")).toContain('create({ name: "bob", age: 40 })');
  }, 60_000);

  it("uses shorthand when the argument is already the parameter's name", async () => {
    // `create({ name: name })` is noise; `{ name }` is what a person would
    // have written.
    const path = await file(SOURCE);
    const line = lineOf(SOURCE, "export const made");

    const data = json(
      await handler.execute({
        file_path: path,
        line,
        column: 22,
        param_names: ["name", "age"],
        dry_run: true,
      })
    );

    expect(data.after).toBe("create({ name, age: 30 })");
  }, 60_000);

  it("skips a call that already takes an object", async () => {
    // Running the same migration twice must not wrap the object again.
    const path = await file(SOURCE);
    const line = lineOf(SOURCE, "export const already");

    const data = json(
      await handler.execute({
        file_path: path,
        line,
        column: 25,
        param_names: ["name", "age"],
        dry_run: true,
      })
    );

    expect(data.skipped).toBe(true);
    expect(data.reason).toContain("Already using object");
  }, 60_000);

  it("refuses a call with more arguments than there are parameter names", async () => {
    // Guessing a name for the extra argument would drop it.
    const path = await file(SOURCE);
    const line = lineOf(SOURCE, "export const tooMany");

    const result = await handler.execute({
      file_path: path,
      line,
      column: 24,
      param_names: ["name", "age"],
      dry_run: true,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Too many arguments");
  }, 60_000);

  it("takes fewer arguments than parameters, for the optional ones", async () => {
    const source = 'export function f(a: string, b?: number): void {}\nf("only");\n';
    const path = await file(source);

    const data = json(
      await handler.execute({
        file_path: path,
        line: 2,
        column: 1,
        param_names: ["a", "b"],
        dry_run: true,
      })
    );

    expect(data.after).toBe('f({ a: "only" })');
  }, 60_000);

  it("says so when there is no call at the position", async () => {
    const path = await file(SOURCE);
    const line = lineOf(SOURCE, "export const nothing");

    const result = await handler.execute({
      file_path: path,
      line,
      column: 1,
      param_names: ["name"],
      dry_run: true,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("No function call found");
  }, 60_000);

  it("reports a file it cannot read", async () => {
    const result = await handler.execute({
      file_path: join(dir, "absent.ts"),
      line: 1,
      column: 1,
      param_names: ["a"],
      dry_run: true,
    });

    expect(result.isError).toBe(true);
  }, 60_000);
});

describe("inside a batch context", () => {
  /** The shared project and file map a batch hands to each operation. */
  async function context(params: { path: string; dryRun: boolean }) {
    const project = new Project();
    return {
      project,
      modifiedFiles: new Map(),
      dryRun: params.dryRun,
      changes: [],
    };
  }

  it("adds the file to the shared project the first time it is seen", async () => {
    const path = await file(SOURCE);
    const ctx = await context({ path, dryRun: true });

    const result = await handler.executeWithContext(
      { file_path: path, line: lineOf(SOURCE, "export const literal"), column: 24, param_names: ["name", "age"] },
      ctx as never
    );

    expect(result.success).toBe(true);
    expect(ctx.modifiedFiles.has(path)).toBe(true);
  }, 60_000);

  it("reuses the file the batch already has open", async () => {
    // Re-adding it would discard the edits the batch has already made to it.
    const path = await file(SOURCE);
    const ctx = await context({ path, dryRun: true });
    const opened = ctx.project.addSourceFileAtPath(path);
    ctx.modifiedFiles.set(path, opened);

    await handler.executeWithContext(
      { file_path: path, line: lineOf(SOURCE, "export const literal"), column: 24, param_names: ["name", "age"] },
      ctx as never
    );

    expect(ctx.modifiedFiles.get(path)).toBe(opened);
  }, 60_000);

  it("reports a skip as a success with nothing done", async () => {
    const path = await file(SOURCE);
    const ctx = await context({ path, dryRun: true });

    const result = await handler.executeWithContext(
      { file_path: path, line: lineOf(SOURCE, "export const already"), column: 25, param_names: ["name", "age"] },
      ctx as never
    );

    expect(result).toMatchObject({ success: true, skipped: true });
  }, 60_000);

  it("reports a failure with its reason", async () => {
    const path = await file(SOURCE);
    const ctx = await context({ path, dryRun: true });

    const result = await handler.executeWithContext(
      { file_path: path, line: lineOf(SOURCE, "export const tooMany"), column: 24, param_names: ["name", "age"] },
      ctx as never
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Too many arguments");
  }, 60_000);
});

describe("preparing a transform by position", () => {
  function sourceFileFor(path: string) {
    return new Project().addSourceFileAtPath(path);
  }

  it("returns the offsets and the replacement, without applying them", async () => {
    // A batch applies these back to front, so what it needs is a span and a
    // string -- not a node, which the previous edit would have invalidated.
    const path = await file(SOURCE);
    const prepared = handler.prepareTransform(
      sourceFileFor(path),
      lineOf(SOURCE, "export const literal"),
      24,
      ["name", "age"]
    );

    expect(prepared).toMatchObject({
      newText: '{ name: "bob", age: 40 }',
      functionName: "create",
      before: 'create("bob", 40)',
    });
    expect((prepared as { start: number }).start).toBeGreaterThan(0);
  }, 60_000);

  it("reports a call that is already an object as skipped", async () => {
    const path = await file(SOURCE);

    const prepared = handler.prepareTransform(
      sourceFileFor(path),
      lineOf(SOURCE, "export const already"),
      25,
      ["name", "age"]
    );

    expect(prepared).toMatchObject({ skipped: true });
  }, 60_000);

  it.each([
    { name: "no call at the position", snippet: "export const nothing", column: 1, expected: /No function call/ },
    { name: "too many arguments", snippet: "export const tooMany", column: 24, expected: /Too many arguments/ },
  ])("reports $name", async ({ snippet, column, expected }) => {
    const path = await file(SOURCE);

    const prepared = handler.prepareTransform(
      sourceFileFor(path),
      lineOf(SOURCE, snippet),
      column,
      ["name", "age"]
    );

    expect((prepared as { error: string }).error).toMatch(expected);
  }, 60_000);
});

describe("collecting a node and applying to it later", () => {
  function sourceFileFor(path: string) {
    return new Project().addSourceFileAtPath(path);
  }

  it("applies to the node it collected", async () => {
    const path = await file(SOURCE);
    const sourceFile = sourceFileFor(path);
    const info = handler.collectNodeInfo(
      sourceFile,
      lineOf(SOURCE, "export const literal"),
      24
    );

    const result = handler.applyToNode(info as never, ["name", "age"], false);

    expect(result.success).toBe(true);
    expect(result.modified).toBe(true);
    expect(sourceFile.getFullText()).toContain('create({ name: "bob", age: 40 })');
  }, 60_000);

  it("leaves the file alone on a dry run", async () => {
    const path = await file(SOURCE);
    const sourceFile = sourceFileFor(path);
    const info = handler.collectNodeInfo(sourceFile, lineOf(SOURCE, "export const literal"), 24);

    const result = handler.applyToNode(info as never, ["name", "age"], true);

    expect(result.modified).toBe(false);
    expect(sourceFile.getFullText()).toContain('create("bob", 40)');
  }, 60_000);

  it.each([
    { name: "no call at the position", snippet: "export const nothing", column: 1, expected: /No function call/ },
    { name: "a call that is already an object", snippet: "export const already", column: 25, expected: /Already using object/ },
  ])("refuses to collect $name", async ({ snippet, column, expected }) => {
    const path = await file(SOURCE);

    const info = handler.collectNodeInfo(sourceFileFor(path), lineOf(SOURCE, snippet), column);

    expect((info as { error: string }).error).toMatch(expected);
  }, 60_000);

  it("refuses to apply to a node whose file has been thrown away", async () => {
    // A batch that forgot a node between phases would otherwise write at an
    // offset from a file that no longer exists.
    const path = await file(SOURCE);
    const project = new Project();
    const sourceFile = project.addSourceFileAtPath(path);
    const info = handler.collectNodeInfo(sourceFile, lineOf(SOURCE, "export const literal"), 24);
    project.removeSourceFile(sourceFile);

    const result = handler.applyToNode(info as never, ["name", "age"], true);

    expect(result.success).toBe(false);
    expect(result.error).toContain("no longer valid");
  }, 60_000);

  it("refuses to apply with fewer parameter names than arguments", async () => {
    const path = await file(SOURCE);
    const sourceFile = sourceFileFor(path);
    const info = handler.collectNodeInfo(sourceFile, lineOf(SOURCE, "export const literal"), 24);

    const result = handler.applyToNode(info as never, ["name"], true);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Too many arguments");
  }, 60_000);
});
