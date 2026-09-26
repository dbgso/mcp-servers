/**
 * Reading whole AsciiDoc documents: headings to a depth, links, code blocks,
 * section text, a table of contents, link checking, and sections in and out.
 *
 * These are the operations the tools are built on, and the branches that had
 * never run are the ones that deal with a document that is not tidy: an
 * unterminated code fence, a `[source]` with no language, a cross-reference
 * with no label, a heading that is not there. Each of them either returns
 * something wrong or throws, and the caller has no way to tell which.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { AsciidocHandler } from "../handlers/asciidoc.js";
import type { AsciidocDocument } from "../types/index.js";

let dir: string;
let handler: AsciidocHandler;

async function file(params: { name: string; content: string }): Promise<string> {
  const path = join(dir, params.name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, params.content, "utf-8");
  return path;
}

const NESTED = `= Title

== One

text

=== Deeper

text

==== Deepest

text
`;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "adoc-docs-"));
  handler = new AsciidocHandler();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("headings to a depth", () => {
  it("keeps the title and stops where it is told", async () => {
    const path = await file({ name: "doc.adoc", content: NESTED });

    const headings = await handler.getHeadingsFromFile({ filePath: path, maxDepth: 2 });

    expect(headings.map((h) => h.text)).toEqual(["Title", "One"]);
  });

  it("returns everything when no depth is given", async () => {
    const path = await file({ name: "doc.adoc", content: NESTED });

    const headings = await handler.getHeadingsFromFile({ filePath: path });

    expect(headings.map((h) => h.text)).toEqual(["Title", "One", "Deeper", "Deepest"]);
  });
});

describe("links", () => {
  it("finds none in an empty document", async () => {
    const path = await file({ name: "empty.adoc", content: "" });

    expect(await handler.getLinksFromFile(path)).toEqual([]);
  });

  it("uses the target as the text when a reference has no label", async () => {
    // `xref:page.adoc[]` and `link:url[]` are both ordinary. An empty label
    // would leave the caller with a link it cannot show.
    const path = await file({
      name: "doc.adoc",
      content: "= T\n\nxref:page.adoc[] and link:https://example.com[].\n",
    });

    const links = await handler.getLinksFromFile(path);

    expect(links.map((l) => l.text)).toEqual(["page.adoc", "https://example.com"]);
  });

  it("finds a labelled reference of each kind", async () => {
    const path = await file({
      name: "doc.adoc",
      content: "= T\n\nxref:page.adoc[a page], link:https://example.com[a site], <<sec,a section>>.\n",
    });

    const links = await handler.getLinksFromFile(path);

    expect(links.map((l) => l.text)).toEqual(["a page", "a site", "a section"]);
  });
});

describe("code blocks", () => {
  it("reports a [source] with no language as having none", async () => {
    const path = await file({
      name: "doc.adoc",
      content: "= T\n\n[source]\n----\nplain\n----\n",
    });

    const blocks = await handler.getCodeBlocksFromFile(path);

    expect(blocks).toEqual([{ lang: null, value: "plain", line: 4 }]);
  });

  it("ignores a [source] with no block under it", async () => {
    // An attribute line at the end of a file, or one followed by prose, is not
    // a code block; treating it as one would swallow the rest of the document.
    const path = await file({ name: "doc.adoc", content: "= T\n\n[source,js]\n" });

    expect(await handler.getCodeBlocksFromFile(path)).toEqual([]);
  });

  it("ignores an unterminated fence rather than running to the end of the file", async () => {
    const path = await file({
      name: "doc.adoc",
      content: "= T\n\n----\nopened and never closed\n\nmore prose\n",
    });

    expect(await handler.getCodeBlocksFromFile(path)).toEqual([]);
  });

  it("reads a fenced block with no [source] attribute", async () => {
    const path = await file({ name: "doc.adoc", content: "= T\n\n----\nplain\n----\n" });

    expect(await handler.getCodeBlocksFromFile(path)).toEqual([
      { lang: null, value: "plain", line: 3 },
    ]);
  });
});

describe("the text under a heading", () => {
  it("is empty for a heading the document does not have", async () => {
    const path = await file({ name: "doc.adoc", content: NESTED });

    expect(await handler.getSectionText({ filePath: path, headingText: "Absent" })).toBe("");
  });

  it("stops at the next heading of the same level", async () => {
    const path = await file({
      name: "doc.adoc",
      content: "= T\n\n== One\n\nfirst\n\n== Two\n\nsecond\n",
    });

    const text = await handler.getSectionText({ filePath: path, headingText: "One" });

    expect(text).toContain("first");
    expect(text).not.toContain("second");
  });
});

describe("a table of contents", () => {
  it("is empty for a document with no headings", async () => {
    const path = await file({ name: "doc.adoc", content: "Just prose.\n" });

    expect(await handler.generateToc({ filePath: path })).toBe("");
  });

  it("indents by the depth below the shallowest heading", async () => {
    const path = await file({ name: "doc.adoc", content: NESTED });

    const toc = await handler.generateToc({ filePath: path, maxDepth: 3 });

    expect(toc.split("\n")).toEqual([
      "* <<title,Title>>",
      "** <<one,One>>",
      "*** <<deeper,Deeper>>",
    ]);
  });
});

describe("checking links", () => {
  it("accepts a cross-reference to a file named without its extension", async () => {
    // `<<other-file>>` is how AsciiDoc names a sibling page. It carries no
    // extension and no `#`, so an anchor check alone reports it broken.
    await file({ name: "other-file.adoc", content: "= Other\n" });
    const path = await file({ name: "doc.adoc", content: "= T\n\nSee <<other-file>>.\n" });

    const result = await handler.checkLinks({ filePath: path });

    expect(result.broken).toEqual([]);
    expect(result.valid).toHaveLength(1);
  });

  it("reports an anchor that is neither a heading nor a file", async () => {
    const path = await file({ name: "doc.adoc", content: "= T\n\nSee <<nowhere>>.\n" });

    const result = await handler.checkLinks({ filePath: path });

    expect(result.broken).toHaveLength(1);
    expect(result.broken[0].reason).toContain("nowhere");
  });

  it("accepts an anchor that names a heading in the same document", async () => {
    const path = await file({
      name: "doc.adoc",
      content: "= T\n\n== The Section\n\nSee <<the-section>>.\n",
    });

    const result = await handler.checkLinks({ filePath: path });

    expect(result.valid).toHaveLength(1);
  });

  it("reports a file that is not there", async () => {
    const path = await file({ name: "doc.adoc", content: "= T\n\nSee xref:absent.adoc[it].\n" });

    const result = await handler.checkLinks({ filePath: path });

    expect(result.broken[0].reason).toBe("file not found");
  });

  it("skips an external link unless asked to check it", async () => {
    const path = await file({
      name: "doc.adoc",
      content: "= T\n\nSee link:https://example.invalid/page[it].\n",
    });

    const result = await handler.checkLinks({ filePath: path });

    expect(result.skipped).toHaveLength(1);
  });
});

describe("finding files", () => {
  it("walks subdirectories and leaves other formats alone", async () => {
    await file({ name: "top.adoc", content: "= Top\n" });
    await file({ name: "sub/nested.asciidoc", content: "= Nested\n" });
    await file({ name: "notes.md", content: "# Notes\n" });

    const found = await handler.findFiles({ directory: dir });

    expect(found.sort()).toEqual([join(dir, "sub", "nested.asciidoc"), join(dir, "top.adoc")]);
  });
});

describe("sections in and out", () => {
  it("separates the preamble from the sections", async () => {
    const path = await file({
      name: "doc.adoc",
      content: "= Title\n:toc:\n\nPreamble prose.\n\n== One\n\nfirst\n\n== Two\n\nsecond\n",
    });

    const result = await handler.getSections({ filePath: path });

    expect(result.sections.map((s) => s.title)).toEqual(["One", "Two"]);
    expect(result.preamble.length).toBeGreaterThan(0);
    expect(result.title).toBe("Title");
    expect(result.docAttributes).toEqual([":toc:"]);
  });

  it("puts a block that is not a section of the asked-for level in the preamble", async () => {
    // Asking for level 2 when the document's sections are level 1 must not
    // silently drop them.
    const path = await file({
      name: "doc.adoc",
      content: "= Title\n\n== One\n\nfirst\n",
    });

    const result = await handler.getSections({ filePath: path, level: 2 });

    expect(result.sections).toEqual([]);
    expect(result.preamble.map((b) => b.context)).toContain("section");
  });

  it("writes the sections back in the order they are given", async () => {
    const path = await file({
      name: "doc.adoc",
      content: "= Title\n\nPreamble.\n\n== One\n\nfirst\n\n== Two\n\nsecond\n",
    });
    const { preamble, sections, title, docAttributes } = await handler.getSections({
      filePath: path,
    });
    const out = join(dir, "reordered.adoc");

    await handler.writeSections({
      filePath: out,
      preamble,
      sections: [sections[1], sections[0]],
      title,
      docAttributes,
    });
    const written = await readFile(out, "utf-8");

    expect(written.indexOf("== Two")).toBeLessThan(written.indexOf("== One"));
    expect(written).toContain("Preamble.");
  });

  it("writes a document with no preamble at all", async () => {
    const path = await file({ name: "doc.adoc", content: "= Title\n\n== One\n\nfirst\n" });
    const { sections, title } = await handler.getSections({ filePath: path });
    const out = join(dir, "no-preamble.adoc");

    await handler.writeSections({ filePath: out, sections, title });

    expect(await readFile(out, "utf-8")).toContain("== One");
  });
});

describe("blocks with nothing in them", () => {
  it.each([
    { name: "a section with no nested blocks", block: { context: "section", title: "Empty" } },
    { name: "a listing with no body", block: { context: "listing" } },
    { name: "a literal with no body", block: { context: "literal" } },
    {
      name: "a list item with no body",
      block: { context: "ulist", blocks: [{ context: "list_item" }] },
    },
  ])("writes $name without failing", async ({ block }) => {
    const out = join(dir, "sparse.adoc");

    await handler.write({
      filePath: out,
      ast: { type: "asciidoc", blocks: [block] } as AsciidocDocument,
    });

    expect(typeof (await readFile(out, "utf-8"))).toBe("string");
  });
});

describe("what AsciiDoc has no answer for", () => {
  it("refuses go_to_definition", async () => {
    await expect(
      handler.goToDefinition({ filePath: "x.adoc", line: 1, column: 1 })
    ).rejects.toThrow(/not supported/);
  });
});
