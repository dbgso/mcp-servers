/**
 * Booleans, numbers and arrays that arrive as strings.
 *
 * `ts_ast` publishes only `action` and `help`; every argument an action takes is
 * untyped as far as the client can tell (policy__mcp-tool-surface). Claude Code
 * then sends `line: 3` as `"3"`, `dry_run: false` as `"false"` and
 * `include: ["a"]` as `'["a"]'`, and the action's strict schema rejected the
 * call. Each of those fields is wrapped with the loose converters from
 * mcp-shared; this file checks every one of them.
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import type { ToolResponse } from "mcp-shared";
import {
  AutoImportHandler,
  BatchExecuteHandler,
  CallGraphHandler,
  DeadCodeHandler,
  DependencyGraphHandler,
  ExtractCommonInterfaceHandler,
  FindBlocksHandler,
  FindReferencesHandler,
  GoToDefinitionHandler,
  GoToImplementationHandler,
  GoToTypeDefinitionHandler,
  HoverHandler,
  InlineTypeHandler,
  MonorepoGraphHandler,
  ParamsToObjectHandler,
  QueryAstHandler,
  RemoveNodesHandler,
  RemoveUnusedImportsHandler,
  RenameSymbolHandler,
  TransformAstHandler,
  TsStructureWriteHandler,
  TransformCallSiteHandler,
  TransformSignatureHandler,
  TsStructureReadHandler,
  TypeCheckHandler,
  TypeHierarchyHandler,
} from "../tools/handlers/index.js";
import { TsAstHandler } from "../tools/ts_ast/index.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

interface ParseResult {
  success: boolean;
  data?: unknown;
}

interface Case {
  action: string;
  handler: { schema: { safeParse: (args: unknown) => ParseResult } };
  args: Record<string, unknown>;
}

const POSITION = { file_path: "/src/a.ts", line: 3, column: 5 };

/** One case per action that takes a boolean, number or array; each lists all of them. */
const CASES: Case[] = [
  { action: "read", handler: new TsStructureReadHandler(), args: { file_path: ["/src/a.ts", "/src/b.ts"] } },
  { action: "definition", handler: new GoToDefinitionHandler(), args: POSITION },
  { action: "implementation", handler: new GoToImplementationHandler(), args: POSITION },
  { action: "type_definition", handler: new GoToTypeDefinitionHandler(), args: POSITION },
  { action: "hover", handler: new HoverHandler(), args: POSITION },
  { action: "inline_type", handler: new InlineTypeHandler(), args: POSITION },
  { action: "references", handler: new FindReferencesHandler(), args: { ...POSITION, scope_to_dependents: true } },
  {
    action: "call_graph",
    handler: new CallGraphHandler(),
    args: { ...POSITION, max_depth: 2, include_external: true },
  },
  {
    action: "type_hierarchy",
    handler: new TypeHierarchyHandler(),
    args: { ...POSITION, max_depth: 2, include_external: true },
  },
  {
    action: "extract_common_interface",
    handler: new ExtractCommonInterfaceHandler(),
    args: {
      source_files: ["/src/a.ts"],
      interface_name: "IShared",
      include_methods: false,
      include_properties: false,
      min_occurrence: 0.75,
    },
  },
  { action: "dependency_graph", handler: new DependencyGraphHandler(), args: { directory: "/src", include_external: true } },
  { action: "rename", handler: new RenameSymbolHandler(), args: { ...POSITION, new_name: "renamed", dry_run: false } },
  {
    action: "dead_code",
    handler: new DeadCodeHandler(),
    args: { paths: ["/src"], include_tests: true, entry_points: ["src/index.ts"] },
  },
  { action: "type_check", handler: new TypeCheckHandler(), args: { file_path: "/src/a.ts", include_suggestions: true } },
  { action: "auto_import", handler: new AutoImportHandler(), args: { file_path: "/src/a.ts", dry_run: false } },
  {
    action: "transform",
    handler: new TransformAstHandler(),
    args: {
      path: "/src",
      preset: "class_to_object",
      add_imports: [{ from: "mcp-shared", named: ["jsonResponse"] }],
      property_mappings: [{ from: "a", to: "b" }],
      method_mappings: [{ from: "run", to: "execute", add_params: ["context"] }],
      remove_properties: ["name"],
      include: ["**/*.ts"],
      exclude: ["**/dist/**"],
      dry_run: false,
    },
  },
  {
    action: "transform_signature",
    handler: new TransformSignatureHandler(),
    args: { ...POSITION, new_params: [{ name: "a", type: "string", optional: true }], dry_run: false },
  },
  {
    action: "transform_call_site",
    handler: new TransformCallSiteHandler(),
    args: { ...POSITION, param_names: ["a", "b"], dry_run: false },
  },
  { action: "params_to_object", handler: new ParamsToObjectHandler(), args: { ...POSITION, dry_run: false } },
  { action: "monorepo_graph", handler: new MonorepoGraphHandler(), args: { root_dir: "/repo", include_dev: false } },
  {
    action: "batch",
    handler: new BatchExecuteHandler(),
    args: { operations: [{ tool: "transform_call_site", args: { line: 1 } }], stop_on_error: false },
  },
  {
    action: "find_blocks",
    handler: new FindBlocksHandler(),
    args: {
      file_path: ["/src/a.test.ts"],
      block_types: ["it"],
      include_nested: false,
      max_depth: 2,
      include_source: true,
    },
  },
  {
    action: "remove_nodes",
    handler: new RemoveNodesHandler(),
    args: { file_path: "/src/a.ts", targets: [{ type: "statement_at_line", line: 3 }], dry_run: false },
  },
  {
    action: "remove_unused_imports",
    handler: new RemoveUnusedImportsHandler(),
    args: { file_path: "/src/a.ts", dry_run: false, organize: true },
  },
  {
    action: "query",
    handler: new QueryAstHandler(),
    args: { path: "/src", preset: "debugger", limit: 3, include: ["**/*.ts"], exclude: ["**/dist/**"] },
  },
];

const isTyped = (value: unknown) => typeof value === "boolean" || typeof value === "number" || Array.isArray(value);

/** What a client that has no type for an argument sends instead of it. */
function asString(value: unknown): unknown {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (isTyped(value)) return String(value);
  return value;
}

function stringify(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, asString(value)]));
}

const text = (r: ToolResponse) => r.content.map((c) => ("text" in c ? c.text : "")).join("\n");

describe("an action argument sent as a string", () => {
  it("covers every boolean, number and array field of every action", () => {
    const fields = CASES.flatMap((c) => Object.values(c.args).filter(isTyped));
    expect(fields).toHaveLength(68);
  });

  it.each(CASES)("is read as the typed value by $action", ({ handler, args }) => {
    const typed = handler.schema.safeParse(args);
    const untyped = handler.schema.safeParse(stringify(args));

    expect(typed.success).toBe(true);
    expect(untyped).toEqual(typed);
  });

  it("is read as the typed value inside an array sent as a real array", () => {
    const cases: [Case["handler"], Record<string, unknown>, Record<string, unknown>][] = [
      [
        new RemoveNodesHandler(),
        { file_path: "/a.ts", targets: [{ type: "statement_at_line", line: 3 }] },
        { file_path: "/a.ts", targets: [{ type: "statement_at_line", line: "3" }] },
      ],
      [
        new TransformSignatureHandler(),
        { ...POSITION, new_params: [{ name: "a", type: "string", optional: true }] },
        { ...POSITION, new_params: [{ name: "a", type: "string", optional: "true" }] },
      ],
      [
        new TransformAstHandler(),
        { path: "/src", preset: "class_to_object", add_imports: [{ from: "m", named: ["a", "b"] }] },
        { path: "/src", preset: "class_to_object", add_imports: [{ from: "m", named: '["a","b"]' }] },
      ],
      [
        new TransformAstHandler(),
        { path: "/src", preset: "class_to_object", method_mappings: [{ from: "x", to: "y", add_params: ["c"] }] },
        { path: "/src", preset: "class_to_object", method_mappings: [{ from: "x", to: "y", add_params: '["c"]' }] },
      ],
    ];

    for (const [handler, typed, untyped] of cases) {
      const expected = handler.schema.safeParse(typed);
      expect(expected.success).toBe(true);
      expect(handler.schema.safeParse(untyped)).toEqual(expected);
    }
  });

  it("is still rejected when it is not the string spelling of the type", () => {
    const rename = new RenameSymbolHandler().schema;
    const query = new QueryAstHandler().schema;

    expect(rename.safeParse({ ...POSITION, new_name: "x", dry_run: "yes" }).success).toBe(false);
    expect(rename.safeParse({ ...POSITION, line: "1e3", new_name: "x" }).success).toBe(false);
    expect(query.safeParse({ path: "/src", preset: "eval", include: "**/*.ts" }).success).toBe(false);
  });

  it("stays one path where a path or a list of paths is taken", () => {
    const result = new FindBlocksHandler().schema.safeParse({ file_path: "src/[ab].test.ts" });

    expect(result).toMatchObject({ success: true, data: { file_path: "src/[ab].test.ts" } });
  });
});

describe("ts_ast with string arguments", () => {
  const tsAst = new TsAstHandler();

  it("finds the hover type at a line and column given as strings", async () => {
    const result = await tsAst.execute({
      action: "hover",
      file_path: join(FIXTURES, "main.ts"),
      line: "12",
      column: "22",
    });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("createUser");
  });

  it("applies a limit and an include list given as strings", async () => {
    const result = await tsAst.execute({
      action: "query",
      path: join(FIXTURES, "query-ast"),
      preset: "console_log",
      limit: "2",
      include: '["**/many-logs.ts"]',
      output: "summary",
    });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(text(result)) as { matches: { file: string }[] };
    expect(body.matches).toHaveLength(2);
    expect(body.matches.every((m) => m.file.endsWith("many-logs.ts"))).toBe(true);
  });
});

describe("an object argument sent as a JSON string", () => {
  it("is read as the object for query, additions and structure", () => {
    const transform = new TransformAstHandler().schema.parse({
      path: "src",
      query: '{"kind":"CallExpression"}',
      replacement: "${0}",
      additions: '{"Foo":{"enabled":true}}',
    });
    const write = new TsStructureWriteHandler().schema.parse({
      file_path: "a.ts",
      structure: '{"statements":[]}',
    });

    expect(transform.query).toEqual({ kind: "CallExpression" });
    expect(transform.additions).toEqual({ Foo: { enabled: true } });
    expect(write.structure).toEqual({ statements: [] });
  });

  it("runs a custom query given as a string", async () => {
    const result = await new TsAstHandler().execute({
      action: "query",
      path: join(FIXTURES, "query-ast", "many-logs.ts"),
      query: '{"kind":"CallExpression","expression":{"kind":"PropertyAccessExpression","name":"log"}}',
      output: "summary",
    });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(text(result)) as { matches: unknown[] };
    expect(body.matches.length).toBeGreaterThan(0);
  });
});
