/**
 * Which links count as a backlink to a file, and which do not.
 *
 * This is the tool people run before renaming or deleting a document, so a
 * false negative is the expensive direction: it reports nothing points here and
 * the document goes, taking every link with it. The matcher accepts a wide
 * range of link spellings for that reason -- relative, bare basename, Antora
 * `xref:module:page[]` -- and each of those is a separate arm that the
 * integration suite drove only in its simplest form.
 *
 * The other half is the context line each hit carries, which is what a reader
 * uses to decide whether the link matters. It has its own truncation rules.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { FindBacklinksHandler } from "../tools/handlers/find-backlinks.js";
import type { FindBacklinksResult } from "../types/index.js";

let dir: string;
let handler: FindBacklinksHandler;

async function file(params: { name: string; content: string }): Promise<string> {
  const path = join(dir, params.name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, params.content, "utf-8");
  return path;
}

async function backlinks(params: {
  target: string;
  section?: string;
  includeAnchors?: boolean;
}): Promise<FindBacklinksResult> {
  const result = await handler.execute({
    file_path: params.target,
    directory: dir,
    section_heading: params.section,
    include_anchors: params.includeAnchors ?? true,
  });
  const first = result.content[0];
  if (first?.type !== "text" || first.text === undefined) throw new Error("no text response");
  return JSON.parse(first.text) as FindBacklinksResult;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "backlinks-"));
  handler = new FindBacklinksHandler();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("links that are not backlinks", () => {
  it.each([
    { name: "an external http link", link: "[out](http://example.com/target.md)" },
    { name: "an external https link", link: "[out](https://example.com/target.md)" },
    { name: "a link to a section of the same file", link: "[here](#target)" },
    { name: "a link with no url at all", link: "[empty]()" },
    { name: "a link to a different document", link: "[other](other.md)" },
  ])("ignores $name", async ({ link }) => {
    const target = await file({ name: "target.md", content: "# Target\n" });
    await file({ name: "other.md", content: "# Other\n" });
    await file({ name: "source.md", content: `# Source\n\n${link}\n` });

    const result = await backlinks({ target });

    expect(result.backlinks).toEqual([]);
  });

  it("ignores a link to a file that merely shares a basename elsewhere", async () => {
    // A bare `target` in a subdirectory resolves next to the source, not to a
    // file of the same name two directories up. Matching on the basename alone
    // would report every same-named file in the tree.
    const target = await file({ name: "target.md", content: "# Target\n" });
    await file({ name: "sub/target.md", content: "# Another target\n" });
    await file({ name: "sub/source.md", content: "# Source\n\n[t](target.md)\n" });

    const result = await backlinks({ target });

    expect(result.backlinks).toEqual([]);
  });
});

describe("link spellings that are backlinks", () => {
  it.each([
    { name: "a same-directory link", link: "[t](target.md)" },
    { name: "an explicitly relative link", link: "[t](./target.md)" },
    { name: "a link with an anchor", link: "[t](target.md#a-section)" },
  ])("matches $name", async ({ link }) => {
    const target = await file({ name: "target.md", content: "# Target\n" });
    await file({ name: "source.md", content: `# Source\n\n${link}\n` });

    const result = await backlinks({ target });

    expect(result.backlinks).toHaveLength(1);
    expect(result.summary.totalBacklinks).toBe(1);
  });

  it("matches a link from a sibling directory", async () => {
    const target = await file({ name: "docs/target.md", content: "# Target\n" });
    await file({ name: "docs/other/source.md", content: "# Source\n\n[t](../target.md)\n" });

    const result = await backlinks({ target });

    expect(result.backlinks).toHaveLength(1);
  });

  it("matches a bare basename with no extension", async () => {
    // AsciiDoc cross-references are written this way: `xref:data-flow[]`.
    const target = await file({ name: "data-flow.adoc", content: "= Data flow\n" });
    await file({ name: "source.adoc", content: "= Source\n\nSee xref:data-flow[the flow].\n" });

    const result = await backlinks({ target });

    expect(result.backlinks).toHaveLength(1);
  });

  it("matches an Antora xref with a module prefix", async () => {
    // `xref:module:page.adoc[]` names the page inside a component. The module
    // part is not a directory, so it has to come off before resolving.
    const target = await file({ name: "page.adoc", content: "= Page\n" });
    await file({ name: "source.adoc", content: "= Source\n\nSee xref:ROOT:page.adoc[the page].\n" });

    const result = await backlinks({ target });

    expect(result.backlinks).toHaveLength(1);
  });

  it("matches a markdown file named without its extension", async () => {
    const target = await file({ name: "guide.md", content: "# Guide\n" });
    await file({ name: "source.adoc", content: "= Source\n\nSee xref:guide[the guide].\n" });

    const result = await backlinks({ target });

    expect(result.backlinks).toHaveLength(1);
  });
});

describe("anchors", () => {
  it("can be told to ignore every link that carries one", async () => {
    const target = await file({ name: "target.md", content: "# Target\n" });
    await file({ name: "whole.md", content: "# Whole\n\n[t](target.md)\n" });
    await file({ name: "part.md", content: "# Part\n\n[t](target.md#a-section)\n" });

    const result = await backlinks({ target, includeAnchors: false });

    expect(result.backlinks.map((b) => b.sourceFile)).toEqual([
      expect.stringContaining("whole.md"),
    ]);
  });

  it("matches only the section asked about", async () => {
    const target = await file({ name: "target.md", content: "# Target\n\n## The Section\n" });
    await file({ name: "right.md", content: "# Right\n\n[t](target.md#the-section)\n" });
    await file({ name: "wrong.md", content: "# Wrong\n\n[t](target.md#another-one)\n" });
    await file({ name: "none.md", content: "# None\n\n[t](target.md)\n" });

    const result = await backlinks({ target, section: "The Section" });

    expect(result.backlinks.map((b) => b.sourceFile)).toEqual([
      expect.stringContaining("right.md"),
    ]);
  });

  it("matches an AsciiDoc anchor, which is spelled with underscores", async () => {
    // `== The Section` gets the id `_the_section`, so the anchor generated for
    // an AsciiDoc target cannot be the markdown one.
    const target = await file({ name: "target.adoc", content: "= Target\n\n== The Section\n" });
    await file({
      name: "source.adoc",
      content: "= Source\n\nSee xref:target.adoc#_the_section[the section].\n",
    });

    const result = await backlinks({ target, section: "The Section" });

    expect(result.backlinks).toHaveLength(1);
  });
});

describe("the context each hit carries", () => {
  it("quotes the words either side of the link", async () => {
    const target = await file({ name: "target.md", content: "# Target\n" });
    await file({
      name: "source.md",
      content: "# Source\n\nBefore the link [t](target.md) and after it.\n",
    });

    const result = await backlinks({ target });

    expect(result.backlinks[0].context).toContain("Before the link");
    expect(result.backlinks[0].context).toContain("and after it");
  });

  it("marks both ends it cut", async () => {
    const target = await file({ name: "target.md", content: "# Target\n" });
    const pad = "padding ".repeat(20);
    await file({ name: "source.md", content: `# Source\n\n${pad}[t](target.md)${pad}\n` });

    const result = await backlinks({ target });

    expect(result.backlinks[0].context.startsWith("...")).toBe(true);
    expect(result.backlinks[0].context.endsWith("...")).toBe(true);
  });

  it("quotes the whole line when the link label is wrapped across two of them", async () => {
    // A hit is reported at the line the link starts on, but a label wrapped
    // over two lines is not a substring of either, so there is nothing to
    // centre the context on.
    const target = await file({ name: "target.md", content: "# Target\n" });
    await file({
      name: "source.md",
      content: "# Source\n\n[a label that is\nwrapped](target.md)\n",
    });

    const result = await backlinks({ target });

    expect(result.backlinks).toHaveLength(1);
    expect(result.backlinks[0].context).toContain("a label that is");
    expect(result.backlinks[0].context.endsWith("...")).toBe(false);
  });

  it("truncates a long line it cannot centre", async () => {
    const target = await file({ name: "target.md", content: "# Target\n" });
    const pad = "padding ".repeat(20);
    await file({
      name: "source.md",
      content: `# Source\n\n${pad}[a label that is\nwrapped](target.md)\n`,
    });

    const result = await backlinks({ target });

    expect(result.backlinks[0].context.endsWith("...")).toBe(true);
    expect(result.backlinks[0].context.length).toBe(103);
  });
});

describe("what it refuses to run on", () => {
  it("says so when the target does not exist", async () => {
    const result = await handler.execute({
      file_path: join(dir, "absent.md"),
      directory: dir,
      include_anchors: true,
    });

    expect(result.isError).toBe(true);
  });

  it("says so when the directory does not exist", async () => {
    const target = await file({ name: "target.md", content: "# Target\n" });

    const result = await handler.execute({
      file_path: target,
      directory: join(dir, "absent"),
      include_anchors: true,
    });

    expect(result.isError).toBe(true);
  });
});
