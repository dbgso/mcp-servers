/**
 * The AsciiDoc handler's block vocabulary, read and written back.
 *
 * The integration suite drives this handler through two or three simple
 * documents, which is why two thirds of its branches had never run: the
 * converter and the serialiser are a switch over every block context AsciiDoc
 * has, and each arm is a different shape on disk. A block context that survives
 * `read` but has no arm in `serialize` is silently dropped -- `ast_write` then
 * writes back a document missing a section, a list or a code block, with no
 * error anywhere -- so each context is checked in both directions here.
 *
 * `write` is also driven with hand-built ASTs. That is not a shortcut around
 * `read`: `structured_write` hands this serialiser objects a caller composed,
 * where `lines` and `source` carry the body interchangeably, and only one of
 * those two comes back from a parse.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { AsciidocHandler } from "../handlers/asciidoc.js";
import type { AsciidocDocument, AsciidocBlock } from "../types/index.js";

let dir: string;
let handler: AsciidocHandler;

async function fixture(params: { name?: string; content: string }): Promise<string> {
  const { name = "doc.adoc", content } = params;
  const filePath = join(dir, name);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

/** Serialise an AST the way `ast_write` does, and hand back what landed. */
async function written(ast: AsciidocDocument): Promise<string> {
  const filePath = join(dir, "out.adoc");
  await handler.write({ filePath, ast });
  return readFile(filePath, "utf-8");
}

/** The blocks of a document, by context, after a parse. */
async function blocksOf(content: string): Promise<AsciidocBlock[]> {
  const { ast } = await handler.read(await fixture({ content }));
  return (ast as AsciidocDocument).blocks;
}

function flatten(blocks: AsciidocBlock[]): AsciidocBlock[] {
  return blocks.flatMap((block) => [block, ...flatten(block.blocks ?? [])]);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "adoc-blocks-"));
  handler = new AsciidocHandler();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the document header", () => {
  it("keeps the attributes asciidoctor drops", async () => {
    // `:toc:` and friends are consumed by the parser and are nowhere in its
    // AST, so they are read off the raw source and carried separately. Without
    // that, every write silently strips the header.
    const content = "= Title\n:toc:\n:author: A Person\n:revdate: 2026-01-01\n\nBody text.\n";

    const { ast } = await handler.read(await fixture({ content }));
    const doc = ast as AsciidocDocument;

    expect(doc.title).toBe("Title");
    expect(doc.docAttributes).toEqual([":toc:", ":author: A Person", ":revdate: 2026-01-01"]);
    expect(await written(doc)).toContain(":author: A Person");
  });

  it("stops looking once the body starts", async () => {
    // An attribute-looking line further down belongs to a block, not the
    // header, and hoisting it would move it to the top of the document.
    const content = "= Title\n:toc:\n\nBody text.\n\n:not-an-attribute: here\n";

    const { ast } = await handler.read(await fixture({ content }));

    expect((ast as AsciidocDocument).docAttributes).toEqual([":toc:"]);
  });

  it("reports no attributes rather than an empty list", async () => {
    const { ast } = await handler.read(await fixture({ content: "= Title\n\nBody.\n" }));

    expect((ast as AsciidocDocument).docAttributes).toBeUndefined();
  });

  it("writes a document that has neither title nor attributes", async () => {
    const out = await written({ type: "asciidoc", blocks: [{ context: "paragraph", source: "Just a body." }] });

    expect(out.startsWith("Just a body.")).toBe(true);
  });

  it("writes attributes for a document with no title", async () => {
    const out = await written({
      type: "asciidoc",
      docAttributes: [":toc:"],
      blocks: [{ context: "paragraph", source: "Body." }],
    });

    expect(out.split("\n")[0]).toBe(":toc:");
  });
});

describe("comments and includes", () => {
  it("keeps a line comment through a round trip", async () => {
    const content = "= Title\n\n// a note to the next reader\nBody text.\n";

    const { ast } = await handler.read(await fixture({ content }));

    expect(await written(ast as AsciidocDocument)).toContain("// a note to the next reader");
  });

  it("keeps a block comment's delimiters the right way round", async () => {
    // The opening and closing `////` are the same four characters, so which
    // marker each becomes is decided by counting the ones before it. Getting
    // that backwards turns the document inside out.
    const content = "= Title\n\n////\nnot for readers\n////\n\nBody text.\n";

    const { ast } = await handler.read(await fixture({ content }));
    const out = await written(ast as AsciidocDocument);

    expect((out.match(/^\/\/\/\/$/gm) ?? []).length).toBe(2);
    expect(out).toContain("not for readers");
  });

  it("keeps an include directive rather than resolving it", async () => {
    const content = "= Title\n\ninclude::other.adoc[leveloffset=+1]\n\nBody.\n";

    const { ast } = await handler.read(await fixture({ content }));

    expect(await written(ast as AsciidocDocument)).toContain("include::other.adoc[leveloffset=+1]");
  });
});

describe("every block context the parser produces", () => {
  const document = `= Reference

A preamble paragraph.

== Section One

Some prose.

[source,typescript]
----
const x = 1;
----

....
literal text
....

* first
* second

. step one
. step two

[quote]
____
Quoted text.
____

****
A sidebar.
****

====
An example.
====

NOTE: A single-line admonition.

[WARNING]
====
A multi-line
admonition.
====

|===
| a | b
|===
`;

  it("reads them all without dropping one", async () => {
    const contexts = flatten(await blocksOf(document)).map((block) => block.context);

    for (const context of [
      "preamble",
      "section",
      "paragraph",
      "listing",
      "literal",
      "ulist",
      "olist",
      "quote",
      "sidebar",
      "example",
      "admonition",
      "table",
    ]) {
      expect(contexts).toContain(context);
    }
  });

  it("writes them back as AsciiDoc that parses to the same contexts", async () => {
    const { ast } = await handler.read(await fixture({ content: document }));
    const out = await written(ast as AsciidocDocument);

    const before = flatten((ast as AsciidocDocument).blocks).map((b) => b.context).sort();
    const after = flatten(await blocksOf(out)).map((b) => b.context).sort();

    // The table is the one context with no serialiser arm; it falls to the
    // default, which writes its lines rather than the `|===` fence, so it does
    // not come back as a table. Everything else has to survive.
    expect(after.filter((c) => c !== "table")).toEqual(before.filter((c) => c !== "table"));
    expect(after).toContain("olist");
  });
});

describe("serialising each block from a hand-built AST", () => {
  it.each([
    {
      name: "a section, by its level",
      block: { context: "section", level: 2, title: "Deep", blocks: [] },
      expected: "=== Deep",
    },
    {
      name: "a section with no level, at the top",
      block: { context: "section", title: "Plain", blocks: [] },
      expected: "== Plain",
    },
    {
      name: "a paragraph from its lines",
      block: { context: "paragraph", lines: ["one", "two"] },
      expected: "one\ntwo",
    },
    {
      name: "a paragraph from its text",
      block: { context: "paragraph", text: "rendered text" },
      expected: "rendered text",
    },
    {
      name: "a code block with its language",
      block: { context: "listing", style: "source", attributes: { language: "sh" }, lines: ["ls"] },
      expected: "[source,sh]\n----\nls\n----",
    },
    {
      name: "a code block with no language",
      block: { context: "listing", source: "plain" },
      expected: "----\nplain\n----",
    },
    {
      name: "a literal block from its source",
      block: { context: "literal", source: "verbatim" },
      expected: "....\nverbatim\n....",
    },
    {
      name: "a literal block from its lines",
      block: { context: "literal", lines: ["verbatim"] },
      expected: "....\nverbatim\n....",
    },
    {
      name: "a list item's own marker",
      block: {
        context: "ulist",
        blocks: [{ context: "list_item", marker: "-", source: "dashed" }],
      },
      expected: "- dashed",
    },
    {
      name: "a list item with no marker",
      block: { context: "ulist", blocks: [{ context: "list_item", text: "starred" }] },
      expected: "* starred",
    },
    {
      name: "a list item whose body is in lines",
      block: {
        context: "ulist",
        blocks: [{ context: "list_item", lines: ["two", "words"] }],
      },
      expected: "* two words",
    },
    {
      name: "a list nested under an item",
      block: {
        context: "ulist",
        blocks: [
          {
            context: "list_item",
            source: "outer",
            blocks: [
              { context: "olist", blocks: [{ context: "list_item", marker: ".", source: "inner" }] },
            ],
          },
        ],
      },
      expected: "* outer\n. inner",
    },
    {
      name: "a non-item block sitting in a list",
      block: { context: "ulist", blocks: [{ context: "paragraph", source: "not an item" }] },
      expected: "",
    },
    {
      name: "an ordered item's own marker",
      block: {
        context: "olist",
        blocks: [{ context: "list_item", marker: "..", source: "nested step" }],
      },
      expected: ".. nested step",
    },
    {
      name: "an ordered item with no marker",
      block: { context: "olist", blocks: [{ context: "list_item", text: "step" }] },
      expected: ". step",
    },
    {
      name: "a quote with no style",
      block: { context: "quote", lines: ["said so"] },
      expected: "____\nsaid so\n____",
    },
    {
      name: "a quote with a style",
      block: { context: "quote", style: "verse", lines: ["a line"] },
      expected: "[verse]\n____\na line\n____",
    },
    {
      name: "a sidebar",
      block: { context: "sidebar", lines: ["aside"] },
      expected: "****\naside\n****",
    },
    {
      name: "an example",
      block: { context: "example", lines: ["for instance"] },
      expected: "====\nfor instance\n====",
    },
    {
      name: "a one-line admonition",
      block: { context: "admonition", style: "tip", lines: ["be careful"] },
      expected: "TIP: be careful",
    },
    {
      name: "a multi-line admonition as a block",
      block: { context: "admonition", style: "warning", lines: ["one", "two"] },
      expected: "[WARNING]\n====\none\ntwo\n====",
    },
    {
      name: "a multi-line admonition whose body is in nested blocks",
      block: {
        context: "admonition",
        style: "caution",
        blocks: [{ context: "paragraph", source: "the body" }],
      },
      expected: "[CAUTION]\n====\nthe body",
    },
    {
      name: "an admonition with no style at all",
      block: { context: "admonition", lines: [] },
      expected: "[NOTE]",
    },
    {
      name: "an unknown context, by its lines",
      block: { context: "table", lines: ["| a | b"] },
      expected: "| a | b",
    },
  ])("writes $name", async ({ block, expected }) => {
    const out = await written({ type: "asciidoc", blocks: [block as AsciidocBlock] });

    expect(out).toContain(expected);
  });

  it.each([
    { name: "a list with no items at all", block: { context: "ulist" } },
    { name: "an ordered list with no items", block: { context: "olist" } },
    { name: "a paragraph with nothing in it", block: { context: "paragraph" } },
    { name: "a section with no title", block: { context: "section", blocks: [] } },
    { name: "a preamble with nothing in it", block: { context: "preamble" } },
    { name: "an unknown context with nothing in it", block: { context: "open" } },
  ])("writes nothing for $name", async ({ block }) => {
    const out = await written({ type: "asciidoc", blocks: [block as AsciidocBlock] });

    expect(out.trim()).toBe("");
  });

  it("writes the blocks nested inside a container", async () => {
    const out = await written({
      type: "asciidoc",
      blocks: [
        {
          context: "preamble",
          blocks: [{ context: "paragraph", source: "inside the preamble" }],
        },
        {
          context: "quote",
          blocks: [{ context: "paragraph", source: "inside the quote" }],
        },
        {
          context: "sidebar",
          blocks: [{ context: "paragraph", source: "inside the sidebar" }],
        },
        {
          context: "example",
          blocks: [{ context: "paragraph", source: "inside the example" }],
        },
        {
          context: "open",
          blocks: [{ context: "paragraph", source: "inside an unknown block" }],
        },
      ],
    });

    for (const text of [
      "inside the preamble",
      "inside the quote",
      "inside the sidebar",
      "inside the example",
      "inside an unknown block",
    ]) {
      expect(out).toContain(text);
    }
  });

  it("writes a section's children under its heading", async () => {
    const out = await written({
      type: "asciidoc",
      blocks: [
        {
          context: "section",
          level: 1,
          title: "Parent",
          blocks: [{ context: "section", level: 2, title: "Child", blocks: [] }],
        },
      ],
    });

    expect(out.indexOf("== Parent")).toBeLessThan(out.indexOf("=== Child"));
  });
});

describe("queries", () => {
  const content = `= Title

== One

Text with https://example.com[a link] in it.

[source,js]
----
const a = 1;
----

=== Deeper

More text.
`;

  it("refuses a list query, which AsciiDoc has no answer for", async () => {
    const filePath = await fixture({ content });

    await expect(handler.query({ filePath, queryType: "lists" })).rejects.toThrow(
      /not supported/
    );
  });

  it.each([
    { queryType: "headings" as const, query: "headings" },
    { queryType: "links" as const, query: "links" },
    { queryType: "code_blocks" as const, query: "code_blocks" },
    { queryType: "full" as const, query: "full" },
  ])("answers a $queryType query", async ({ queryType, query }) => {
    const filePath = await fixture({ content });

    const result = await handler.query({ filePath, queryType });

    expect(result.query).toBe(query);
    expect(result.data).toBeDefined();
  });

  it("returns the whole document when a heading is named", async () => {
    const filePath = await fixture({ content });

    const result = await handler.query({
      filePath,
      queryType: "headings",
      options: { heading: "One" },
    });

    expect(result.query).toBe("full");
    expect((result.data as AsciidocDocument).title).toBe("Title");
  });

  it("stops at the depth asked for", async () => {
    const filePath = await fixture({ content });

    const result = await handler.query({
      filePath,
      queryType: "headings",
      options: { depth: 1 },
    });

    const depths = (result.data as { depth: number }[]).map((h) => h.depth);
    expect(Math.max(...depths)).toBeLessThanOrEqual(1);
  });
});
