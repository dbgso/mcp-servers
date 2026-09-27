/**
 * The comby-style pattern engine: parse, match, apply, and rewrite files.
 *
 * `src/codemod` ran at 17%, with `transformer.ts` -- the part that finds the
 * files and writes to them -- at 0%. It is the mechanism behind every
 * pattern-based rewrite this server offers, so what is untested is a rewrite
 * that could corrupt source: a placeholder that swallows too much, a
 * replacement written to a file on what was meant to be a dry run.
 *
 * The matcher's own claim is bracket balance -- `:[args]` stops at the closing
 * paren that belongs to it, not the first one it meets -- and that is what most
 * of these check.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { parsePattern, applyCaptures } from "../codemod/pattern-parser.js";
import { findMatches, transform } from "../codemod/pattern-matcher.js";
import { transformFiles } from "../codemod/transformer.js";

let dir: string;

async function file(params: { name: string; content: string }): Promise<string> {
  const path = join(dir, params.name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, params.content, "utf-8");
  return path;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "codemod-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parsing a pattern", () => {
  it("splits it into the literals and the holes", () => {
    const parsed = parsePattern("foo(:[args])");

    expect(parsed.tokens.map((t) => t.type)).toEqual(["literal", "placeholder", "literal"]);
    expect(parsed.placeholderNames).toEqual(["args"]);
  });

  it("does not name the anonymous hole", () => {
    // `:[_]` matches without capturing, so a target pattern cannot refer to
    // it -- and it must not appear in the names the caller is offered.
    const parsed = parsePattern("foo(:[_])");

    expect(parsed.placeholderNames).toEqual([]);
    expect(parsed.tokens.some((t) => t.type === "placeholder")).toBe(true);
  });

  it("names a repeated hole once", () => {
    const parsed = parsePattern(":[x] + :[x]");

    expect(parsed.placeholderNames).toEqual(["x"]);
  });

  it("treats a pattern with no holes as one literal", () => {
    const parsed = parsePattern("console.log");

    expect(parsed.tokens).toEqual([{ type: "literal", value: "console.log" }]);
    expect(parsed.placeholderNames).toEqual([]);
  });

  it("keeps a pattern that is nothing but a hole", () => {
    const parsed = parsePattern(":[all]");

    expect(parsed.tokens).toHaveLength(1);
    expect(parsed.placeholderNames).toEqual(["all"]);
  });
});

describe("applying captures to a target", () => {
  it("substitutes every occurrence of a name", () => {
    const result = applyCaptures({
      target: ":[x] === :[x]",
      captures: new Map([["x", "value"]]),
    });

    expect(result).toBe("value === value");
  });

  it("leaves a name nothing was captured for alone", () => {
    // Better a visible `:[missing]` in the output than a silent empty string
    // where a caller expected their capture.
    const result = applyCaptures({
      target: ":[x] and :[missing]",
      captures: new Map([["x", "a"]]),
    });

    expect(result).toBe("a and :[missing]");
  });
});

describe("finding matches", () => {
  it("finds every occurrence of a pattern with no holes", () => {
    const { matches } = findMatches({ source: "a.b(); a.b();", pattern: "a.b()" });

    expect(matches).toHaveLength(2);
    expect(matches[0].start).toBe(0);
  });

  it("finds nothing when the pattern is not there", () => {
    expect(findMatches({ source: "nothing here", pattern: "absent" }).matches).toEqual([]);
  });

  it("captures what sits inside the brackets", () => {
    const { matches } = findMatches({ source: "log(hello)", pattern: "log(:[msg])" });

    expect(matches).toHaveLength(1);
    expect(matches[0].captures.get("msg")).toBe("hello");
  });

  it("stops at the closing bracket that belongs to the pattern", () => {
    // The first `)` in `log(f(a), b)` closes `f(`, not `log(`. A matcher that
    // stopped there would capture `f(a` and rewrite the call into nonsense.
    const { matches } = findMatches({ source: "log(f(a), b)", pattern: "log(:[args])" });

    expect(matches).toHaveLength(1);
    expect(matches[0].captures.get("args")).toBe("f(a), b");
  });

  it("does the same across braces and brackets", () => {
    const { matches } = findMatches({
      source: "wrap({ a: [1, 2] })",
      pattern: "wrap(:[body])",
    });

    expect(matches[0].captures.get("body")).toBe("{ a: [1, 2] }");
  });

  it("matches a hole that spans lines", () => {
    const source = "call(\n  first,\n  second\n)";

    const { matches } = findMatches({ source, pattern: "call(:[args])" });

    expect(matches[0].captures.get("args")).toContain("second");
  });

  it("finds several matches of the same shape", () => {
    const { matches } = findMatches({
      source: "log(one); log(two);",
      pattern: "log(:[m])",
    });

    expect(matches.map((m) => m.captures.get("m"))).toEqual(["one", "two"]);
  });

  it("matches an anonymous hole without capturing it", () => {
    const { matches } = findMatches({ source: "log(ignored)", pattern: "log(:[_])" });

    expect(matches).toHaveLength(1);
    expect(matches[0].captures.size).toBe(0);
  });

  it("gives up on a pattern whose closing literal never arrives", () => {
    const { matches } = findMatches({ source: "log(unclosed", pattern: "log(:[m])" });

    expect(matches).toEqual([]);
  });
});

describe("transforming a source string", () => {
  it("returns it unchanged when nothing matches", () => {
    const { result, changes } = transform({
      source: "const a = 1;",
      sourcePattern: "log(:[m])",
      targetPattern: "debug(:[m])",
    });

    expect(result).toBe("const a = 1;");
    expect(changes).toEqual([]);
  });

  it("rewrites every match and keeps everything between them", () => {
    const { result, changes } = transform({
      source: "before log(one) middle log(two) after",
      sourcePattern: "log(:[m])",
      targetPattern: "debug(:[m])",
    });

    expect(result).toBe("before debug(one) middle debug(two) after");
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ before: "log(one)", after: "debug(one)" });
  });

  it("can reorder what it captured", () => {
    const { result } = transform({
      source: "swap(a, b)",
      sourcePattern: "swap(:[x], :[y])",
      targetPattern: "swap(:[y], :[x])",
    });

    expect(result).toBe("swap(b, a)");
  });
});

describe("transforming files", () => {
  it("reports what it would change without writing, by default", async () => {
    // The default is a dry run precisely because the alternative rewrites a
    // tree in place. A caller who forgot the flag must not lose source.
    const path = await file({ name: "src/a.ts", content: "log(one);\nlog(two);\n" });

    const result = await transformFiles({
      sourcePattern: "log(:[m])",
      targetPattern: "debug(:[m])",
      path: dir,
    });

    expect(result.dryRun).toBe(true);
    expect(result.totalMatches).toBe(2);
    expect(result.filesModified).toEqual([path]);
    expect(await readFile(path, "utf-8")).toContain("log(one)");
  });

  it("writes when told to, and says where each change was", async () => {
    const path = await file({ name: "src/a.ts", content: "const x = 1;\nlog(one);\n" });

    const result = await transformFiles({
      sourcePattern: "log(:[m])",
      targetPattern: "debug(:[m])",
      path: dir,
      dryRun: false,
    });

    expect(await readFile(path, "utf-8")).toContain("debug(one)");
    // Line and column are 1-based, and point at the match rather than the file.
    expect(result.changes[0]).toMatchObject({ line: 2, column: 1 });
  });

  it("takes a single file as its path", async () => {
    const path = await file({ name: "only.ts", content: "log(one);\n" });
    await file({ name: "other.ts", content: "log(two);\n" });

    const result = await transformFiles({
      sourcePattern: "log(:[m])",
      targetPattern: "debug(:[m])",
      path,
    });

    expect(result.filesModified).toEqual([path]);
  });

  it("takes a file pattern to narrow a directory", async () => {
    await file({ name: "keep.ts", content: "log(one);\n" });
    await file({ name: "skip.tsx", content: "log(two);\n" });

    const result = await transformFiles({
      sourcePattern: "log(:[m])",
      targetPattern: "debug(:[m])",
      path: dir,
      filePattern: "*.ts",
    });

    expect(result.filesModified).toHaveLength(1);
    expect(result.filesModified[0]).toContain("keep.ts");
  });

  it("leaves files with no match out of the report", async () => {
    await file({ name: "a.ts", content: "const a = 1;\n" });

    const result = await transformFiles({
      sourcePattern: "log(:[m])",
      targetPattern: "debug(:[m])",
      path: dir,
    });

    expect(result.filesModified).toEqual([]);
    expect(result.totalMatches).toBe(0);
  });

  it("does not walk into node_modules or type declarations", async () => {
    // Rewriting a dependency's source, or a `.d.ts`, is never what was asked
    // for -- and in node_modules it would be undone by the next install.
    await file({ name: "node_modules/pkg/index.ts", content: "log(vendored);\n" });
    await file({ name: "types.d.ts", content: "log(declared);\n" });
    await file({ name: "own.ts", content: "log(mine);\n" });

    const result = await transformFiles({
      sourcePattern: "log(:[m])",
      targetPattern: "debug(:[m])",
      path: dir,
    });

    expect(result.filesModified).toHaveLength(1);
    expect(result.filesModified[0]).toContain("own.ts");
  });
});
