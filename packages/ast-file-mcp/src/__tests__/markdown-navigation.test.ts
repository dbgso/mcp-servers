/**
 * Following a link, and walking a tree of them.
 *
 * `go_to_definition` answers "where does this link land", and every kind of
 * link lands somewhere different: a heading in the same file, a heading in
 * another, a file with no anchor, a file that is not there, an external URL.
 * Each is a separate arm, and the one that had never run is the one that
 * matters most in practice -- a link whose target is missing, which is what the
 * tool is used to find.
 *
 * `crawl` is the same links followed transitively, so its untested branches
 * were the ones that stop it: the depth limit and the already-seen set. Without
 * either, two documents that link to each other do not terminate.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { MarkdownHandler } from "../handlers/markdown.js";
import { AsciidocHandler } from "../handlers/asciidoc.js";

let dir: string;
let md: MarkdownHandler;
let adoc: AsciidocHandler;

async function file(params: { name: string; content: string }): Promise<string> {
  const path = join(dir, params.name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, params.content, "utf-8");
  return path;
}

/** Where the link on `line` of `filePath` leads. */
async function definitionAt(params: { filePath: string; line: number; column?: number }) {
  const { filePath, line, column = 1 } = params;
  const { ast } = await md.read(filePath);
  return md.goToDefinition({ filePath, ast, line, column });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "md-nav-"));
  md = new MarkdownHandler();
  adoc = new AsciidocHandler();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("go_to_definition", () => {
  it("lands on a heading in the same file", async () => {
    const path = await file({
      name: "same.md",
      content: "# Title\n\nSee [the section](#the-section).\n\n## The Section\n\ntext\n",
    });

    const result = await definitionAt({ filePath: path, line: 3, column: 6 });

    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0]).toMatchObject({ kind: "heading", filePath: path, line: 5 });
  });

  it("says nothing rather than guessing when the anchor names no heading", async () => {
    const path = await file({
      name: "same.md",
      content: "# Title\n\nSee [nowhere](#no-such-section).\n",
    });

    const result = await definitionAt({ filePath: path, line: 3, column: 6 });

    expect(result.definitions).toEqual([]);
  });

  it("reports an external URL as itself", async () => {
    const path = await file({
      name: "external.md",
      content: "# Title\n\nSee [the site](https://example.com/page).\n",
    });

    const result = await definitionAt({ filePath: path, line: 3, column: 6 });

    expect(result.definitions[0]).toMatchObject({
      kind: "external-link",
      filePath: "https://example.com/page",
    });
  });

  it("lands on a heading in another file", async () => {
    const other = await file({ name: "other.md", content: "# Other\n\n## Deep Section\n\ntext\n" });
    const path = await file({
      name: "source.md",
      content: "# Title\n\nSee [there](other.md#deep-section).\n",
    });

    const result = await definitionAt({ filePath: path, line: 3, column: 6 });

    expect(result.definitions[0]).toMatchObject({ kind: "heading", filePath: other, line: 3 });
  });

  it("lands on the top of the file when the anchor is not in it", async () => {
    // The file is the part the reader can act on, and saying which anchor was
    // missing is what tells them the link is stale rather than the file.
    const other = await file({ name: "other.md", content: "# Other\n\ntext\n" });
    const path = await file({
      name: "source.md",
      content: "# Title\n\nSee [there](other.md#gone).\n",
    });

    const result = await definitionAt({ filePath: path, line: 3, column: 6 });

    expect(result.definitions[0]).toMatchObject({ kind: "file", filePath: other, line: 1 });
    expect(result.definitions[0].text).toContain("gone");
  });

  it("lands on a file linked with no anchor", async () => {
    const other = await file({ name: "other.md", content: "# Other\n" });
    const path = await file({ name: "source.md", content: "# Title\n\nSee [there](other.md).\n" });

    const result = await definitionAt({ filePath: path, line: 3, column: 6 });

    expect(result.definitions[0]).toMatchObject({ kind: "file", filePath: other });
    expect(result.definitions[0].text).toBeUndefined();
  });

  it("says the file is not there", async () => {
    const path = await file({ name: "source.md", content: "# Title\n\nSee [gone](absent.md).\n" });

    const result = await definitionAt({ filePath: path, line: 3, column: 6 });

    expect(result.definitions[0].text).toBe("(file not found)");
    expect(result.definitions[0].name).toBe("absent.md");
  });

  it("finds nothing when the position is not on a link", async () => {
    const path = await file({ name: "source.md", content: "# Title\n\nJust prose.\n" });

    const result = await definitionAt({ filePath: path, line: 3, column: 2 });

    expect(result.definitions).toEqual([]);
    expect(result.identifier).toBe("");
  });
});

describe("crawl", () => {
  it("stops rather than going round a cycle", async () => {
    await file({ name: "a.md", content: "# A\n\n[to b](b.md)\n" });
    await file({ name: "b.md", content: "# B\n\n[back to a](a.md)\n" });

    const result = await md.crawl({ startFile: join(dir, "a.md") });

    expect(result.files.map((f) => f.filePath).sort()).toEqual([
      join(dir, "a.md"),
      join(dir, "b.md"),
    ]);
  });

  it("stops at the depth it is given", async () => {
    await file({ name: "a.md", content: "# A\n\n[to b](b.md)\n" });
    await file({ name: "b.md", content: "# B\n\n[to c](c.md)\n" });
    await file({ name: "c.md", content: "# C\n" });

    const result = await md.crawl({ startFile: join(dir, "a.md"), maxDepth: 1 });

    expect(result.files.map((f) => f.filePath)).toEqual([join(dir, "a.md"), join(dir, "b.md")]);
  });

  it("records a link to a file that is not there rather than failing", async () => {
    await file({ name: "a.md", content: "# A\n\n[to nowhere](absent.md)\n" });

    const result = await md.crawl({ startFile: join(dir, "a.md") });

    expect(result.errors).toEqual([
      { filePath: join(dir, "absent.md"), error: "File not found" },
    ]);
  });

  it("does not follow links it cannot read as documents", async () => {
    await file({ name: "a.md", content: "# A\n\n[external](https://example.com)\n[anchor](#a)\n[empty]()\n[image](picture.png)\n" });

    const result = await md.crawl({ startFile: join(dir, "a.md") });

    expect(result.files).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it("does the same for AsciiDoc", async () => {
    await file({ name: "a.adoc", content: "= A\n\nxref:b.adoc[to b]\n" });
    await file({ name: "b.adoc", content: "= B\n\nxref:a.adoc[back]\nhttps://example.com[out]\n" });

    const result = await adoc.crawl({ startFile: join(dir, "a.adoc") });

    expect(result.files).toHaveLength(2);
  });

  it("stops at the depth it is given for AsciiDoc too", async () => {
    await file({ name: "a.adoc", content: "= A\n\nxref:b.adoc[to b]\n" });
    await file({ name: "b.adoc", content: "= B\n\nxref:c.adoc[to c]\n" });
    await file({ name: "c.adoc", content: "= C\n" });

    const result = await adoc.crawl({ startFile: join(dir, "a.adoc"), maxDepth: 1 });

    expect(result.files).toHaveLength(2);
  });
});

describe("finding files", () => {
  it("walks into subdirectories but not into node_modules or .git", async () => {
    await file({ name: "top.md", content: "# Top\n" });
    await file({ name: "sub/nested.md", content: "# Nested\n" });
    await file({ name: "node_modules/pkg/readme.md", content: "# Vendored\n" });
    await file({ name: ".git/notes.md", content: "# Internal\n" });
    await file({ name: "not-a-document.txt", content: "text\n" });

    const found = await md.findFiles({ directory: dir });

    expect(found.sort()).toEqual([join(dir, "sub", "nested.md"), join(dir, "top.md")]);
  });
});

describe("sections", () => {
  it("returns an empty tree for a heading the document does not have", async () => {
    const path = await file({ name: "doc.md", content: "# Title\n\n## One\n\ntext\n" });

    const result = await md.query({
      filePath: path,
      queryType: "full",
      options: { heading: "Not Here" },
    });

    expect((result.data as { children: unknown[] }).children).toEqual([]);
  });

  it("splits a document with prose before its first heading", async () => {
    const path = await file({
      name: "doc.md",
      content: "Preamble prose.\n\n# Title\n\ntext\n\n## One\n\nmore\n",
    });

    const { preamble, sections } = await md.getSections({ filePath: path, level: 1 });

    expect(preamble.length).toBeGreaterThan(0);
    expect(sections.map((s) => s.title)).toEqual(["Title"]);
  });

  it("returns no sections for a document that has no headings", async () => {
    const path = await file({ name: "doc.md", content: "Just prose.\n" });

    const { preamble, sections } = await md.getSections({ filePath: path, level: 1 });

    expect(sections).toEqual([]);
    expect(preamble.length).toBeGreaterThan(0);
  });
});

describe("generated markdown", () => {
  it("leaves a cell empty rather than writing undefined", async () => {
    // A row missing one of the first row's keys is ordinary when the data came
    // from a query; `String(undefined)` would put the word in the table.
    const table = md.generateTable([
      { name: "a", note: "first" },
      { name: "b" },
    ]);

    expect(table).toContain("| b |  |");
    expect(table).not.toContain("undefined");
  });

  it("returns nothing for no rows at all", async () => {
    expect(md.generateTable([])).toBe("");
  });

  it("does the same in AsciiDoc", async () => {
    const table = adoc.generateTable([
      { name: "a", note: "first" },
      { name: "b" },
    ]);

    expect(table).not.toContain("undefined");
  });
});

describe("diff_structure", () => {
  it.each(["summary", "detailed"] as const)("compares two documents at the %s level", async (level) => {
    const a = await file({ name: "a.md", content: "# Title\n\n## Kept\n\n## Removed\n" });
    const b = await file({ name: "b.md", content: "# Title\n\n## Kept\n\n## Added\n" });

    const result = await md.diffStructure({ filePathA: a, filePathB: b, level });

    expect(result.added.map((i) => i.key)).toContain("2:Added");
    expect(result.removed.map((i) => i.key)).toContain("2:Removed");
  });

  it.each(["summary", "detailed"] as const)("does the same for AsciiDoc at the %s level", async (level) => {
    const a = await file({ name: "a.adoc", content: "= Title\n\n== Kept\n\n== Removed\n" });
    const b = await file({ name: "b.adoc", content: "= Title\n\n== Kept\n\n== Added\n" });

    const result = await adoc.diffStructure({ filePathA: a, filePathB: b, level });

    expect(result.added.length + result.removed.length).toBeGreaterThan(0);
  });
});
