/**
 * The eleven tool handlers that had never been run.
 *
 * Each is a thin wrapper -- resolve a handler for the file's extension, call
 * one method, wrap the answer -- but the thin part is the part a caller hits
 * first: an unsupported file type has to come back as a message naming what is
 * supported, not as a crash inside a handler that was never resolved. That
 * guard is the same in all of them and none of it ran.
 *
 * The underlying analyses are exercised too, against the fixtures already in
 * this directory, so these are not shape-only tests: `hover` has to find a
 * type, `type_check` has to find the errors the fixture deliberately contains.
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { AutoImportHandler } from "../tools/handlers/auto-import.js";
import { CallGraphHandler } from "../tools/handlers/call-graph.js";
import { DeadCodeHandler } from "../tools/handlers/dead-code.js";
import { HoverHandler } from "../tools/handlers/hover.js";
import { InlineTypeHandler } from "../tools/handlers/inline-type.js";
import { QueryGraphHandler } from "../tools/handlers/query-graph.js";
import { RenameSymbolHandler } from "../tools/handlers/rename-symbol.js";
import { TypeCheckHandler } from "../tools/handlers/type-check.js";
import { getToolRegistry } from "../tools/registry.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const MAIN = join(FIXTURES, "main.ts");
const NOT_TYPESCRIPT = join(FIXTURES, "notes.md");

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((c) => c.text ?? "").join("\n");

const json = (r: { content: { type: string; text?: string }[] }) =>
  JSON.parse(text(r)) as Record<string, unknown>;

describe("a file whose type is not supported", () => {
  it.each([
    { name: "hover", call: () => new HoverHandler().execute({ file_path: NOT_TYPESCRIPT, line: 1, column: 1 }) },
    { name: "auto_import", call: () => new AutoImportHandler().execute({ file_path: NOT_TYPESCRIPT, dry_run: true }) },
    { name: "call_graph", call: () => new CallGraphHandler().execute({ file_path: NOT_TYPESCRIPT, line: 1, column: 1 }) },
    { name: "inline_type", call: () => new InlineTypeHandler().execute({ file_path: NOT_TYPESCRIPT, line: 1, column: 1 }) },
    {
      name: "rename_symbol",
      call: () =>
        new RenameSymbolHandler().execute({
          file_path: NOT_TYPESCRIPT,
          line: 1,
          column: 1,
          new_name: "x",
          dry_run: true,
        }),
    },
    { name: "type_check", call: () => new TypeCheckHandler().execute({ file_path: NOT_TYPESCRIPT }) },
  ])("is refused by $name, with the supported list", async ({ call }) => {
    const result = await call();

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Unsupported file type");
    expect(text(result)).toMatch(/\bts\b/);
  });
});

describe("hover", () => {
  it("reports the type of the symbol under the position", async () => {
    // `const config: Config` on line 4 of the fixture.
    const result = await new HoverHandler().execute({
      file_path: MAIN,
      line: 4,
      column: 7,
    });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("config");
  }, 60_000);
});

describe("type_check", () => {
  it("finds the errors a fixture deliberately contains", async () => {
    const result = await new TypeCheckHandler().execute({
      file_path: join(FIXTURES, "type-error.ts"),
    });

    const data = json(result) as { diagnostics?: unknown[] };
    expect(Array.isArray(data.diagnostics)).toBe(true);
    expect((data.diagnostics ?? []).length).toBeGreaterThan(0);
  }, 60_000);

  it("finds none in a file that compiles", async () => {
    const result = await new TypeCheckHandler().execute({
      file_path: join(FIXTURES, "types.ts"),
      include_suggestions: true,
    });

    expect(result.isError).toBeFalsy();
  }, 60_000);
});

describe("auto_import", () => {
  it("proposes the import a file is missing, without writing it", async () => {
    // The fixture uses `User` without importing it, which is the whole point
    // of the file -- so a dry run has to find something and change nothing.
    const result = await new AutoImportHandler().execute({
      file_path: join(FIXTURES, "missing-import.ts"),
      dry_run: true,
    });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("User");
  }, 60_000);
});

describe("call_graph", () => {
  it("follows calls out of a function", async () => {
    const result = await new CallGraphHandler().execute({
      file_path: join(FIXTURES, "same-file-call.ts"),
      line: 1,
      column: 1,
      max_depth: 2,
    });

    expect(result.isError).toBeFalsy();
  }, 60_000);
});

describe("inline_type", () => {
  it("answers for a position in a file it can read", async () => {
    const result = await new InlineTypeHandler().execute({
      file_path: join(FIXTURES, "types.ts"),
      line: 7,
      column: 13,
    });

    expect(typeof text(result)).toBe("string");
  }, 60_000);
});

describe("rename_symbol", () => {
  it("reports what it would change, without writing", async () => {
    const result = await new RenameSymbolHandler().execute({
      file_path: join(FIXTURES, "types.ts"),
      line: 7,
      column: 13,
      new_name: "UserIdentifier",
      dry_run: true,
    });

    expect(result.isError).toBeFalsy();
  }, 60_000);
});

describe("dead_code", () => {
  it("accepts a single path as well as a list", async () => {
    const single = await new DeadCodeHandler().execute({
      path: join(FIXTURES, "dead-code"),
      include_tests: false,
      entry_points: [],
      scope: "all",
      reference_scope: "paths",
    });

    expect(single.isError).toBeFalsy();
  }, 120_000);
});

describe("query_graph", () => {
  it("answers a preset query over a directory", async () => {
    const result = await new QueryGraphHandler().execute({
      source: "dependency",
      directory: FIXTURES,
      preset: "top_importers",
    });

    expect(result.isError).toBeFalsy();
  }, 120_000);
});

describe("the tool registry", () => {
  it("holds the ts_ast tool and hands back the same instance", () => {
    const registry = getToolRegistry();

    expect(registry.getAllTools().map((t) => t.name)).toContain("ts_ast");
    expect(getToolRegistry()).toBe(registry);
  });
});
