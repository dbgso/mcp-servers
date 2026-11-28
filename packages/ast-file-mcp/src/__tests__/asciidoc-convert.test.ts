/**
 * The block converter against the shapes it guards for.
 *
 * Asciidoctor hands back objects typed as `unknown` whose accessors differ by
 * block context, so the converter probes for each one. Those probes cannot be
 * driven through a parse -- a real block always has the accessors its own
 * context calls for -- which is why every one of their false arms had never
 * run. What they are worth is that a document using a block type this converter
 * has not met is read anyway, rather than throwing out of a read.
 */

import { describe, it, expect } from "vitest";
import { convertBlocks } from "../handlers/asciidoc-convert.js";

/** The least a block can be: a context and nothing else. */
const bare = { getContext: () => "paragraph" };

describe("a block with nothing but a context", () => {
  it("converts to exactly that", () => {
    expect(convertBlocks({ blocks: [bare] })).toEqual([{ context: "paragraph" }]);
  });
});

describe("accessors that are missing", () => {
  it.each([
    { name: "getLevel", block: { getContext: () => "section", getTitle: () => "T" } },
    { name: "getTitle", block: { getContext: () => "section", getLevel: () => 1 } },
    { name: "getStyle", block: { getContext: () => "listing", getLines: () => ["x"] } },
    { name: "getAttributes", block: { getContext: () => "listing", getStyle: () => "source" } },
    { name: "getMarker", block: { getContext: () => "list_item", getText: () => "t" } },
    { name: "getSource", block: { getContext: () => "paragraph", getText: () => "t" } },
    { name: "getLines", block: { getContext: () => "paragraph", getSource: () => "s" } },
    { name: "getBlocks", block: { getContext: () => "section", getTitle: () => "T" } },
  ])("are skipped rather than called: $name", ({ block }) => {
    const [converted] = convertBlocks({ blocks: [block] });

    expect(converted.context).toBeTruthy();
  });
});

describe("accessors that answer with nothing", () => {
  it.each([
    {
      name: "a level that is not a number",
      block: { getContext: () => "section", getLevel: () => undefined },
      absent: "level" as const,
    },
    {
      name: "an empty title",
      block: { getContext: () => "section", getTitle: () => "" },
      absent: "title" as const,
    },
    {
      name: "an empty style",
      block: { getContext: () => "listing", getStyle: () => "" },
      absent: "style" as const,
    },
    {
      name: "attributes that are not an object",
      block: { getContext: () => "listing", getAttributes: () => null },
      absent: "attributes" as const,
    },
    {
      name: "attributes with nothing worth keeping",
      block: { getContext: () => "listing", getAttributes: () => ({ id: "x", unknown: 1 }) },
      absent: "attributes" as const,
    },
    {
      name: "an empty marker",
      block: { getContext: () => "list_item", getMarker: () => "" },
      absent: "marker" as const,
    },
    {
      name: "an empty source",
      block: { getContext: () => "paragraph", getSource: () => "" },
      absent: "source" as const,
    },
    {
      name: "empty text",
      block: { getContext: () => "list_item", getText: () => "" },
      absent: "text" as const,
    },
    {
      name: "lines that are not an array",
      block: { getContext: () => "paragraph", getLines: () => null },
      absent: "lines" as const,
    },
    {
      name: "no nested blocks",
      block: { getContext: () => "section", getBlocks: () => [] },
      absent: "blocks" as const,
    },
  ])("leave the field off: $name", ({ block, absent }) => {
    const [converted] = convertBlocks({ blocks: [block] });

    expect(converted[absent]).toBeUndefined();
  });
});

describe("what it does keep", () => {
  it("keeps only the attributes that describe the content", () => {
    // `id` and `role`-adjacent noise is asciidoctor's bookkeeping. The
    // language is what a reader of the AST needs.
    const [converted] = convertBlocks({
      blocks: [
        {
          getContext: () => "listing",
          getAttributes: () => ({ language: "sh", linenums: "", id: "x", style: "source" }),
        },
      ],
    });

    expect(converted.attributes).toEqual({ language: "sh", linenums: "" });
  });

  it("prefers the raw `text` property over the rendered accessor", () => {
    // `getText()` returns HTML for a list item -- `<a href=…>` where the source
    // said `link:…[…]` -- so a write built from it would replace AsciiDoc with
    // markup.
    const [converted] = convertBlocks({
      blocks: [
        {
          getContext: () => "list_item",
          text: "link:https://example.com[the site]",
          getText: () => '<a href="https://example.com">the site</a>',
        },
      ],
    });

    expect(converted.text).toBe("link:https://example.com[the site]");
  });

  it("falls back to the accessor when the property is empty", () => {
    const [converted] = convertBlocks({
      blocks: [{ getContext: () => "list_item", text: "", getText: () => "from the accessor" }],
    });

    expect(converted.text).toBe("from the accessor");
  });

  it("converts nested blocks too", () => {
    const [converted] = convertBlocks({
      blocks: [
        {
          getContext: () => "section",
          getBlocks: () => [{ getContext: () => "paragraph", getSource: () => "inside" }],
        },
      ],
    });

    expect(converted.blocks).toEqual([{ context: "paragraph", source: "inside" }]);
  });
});

describe("a tree that points back at itself", () => {
  it("is marked rather than followed", () => {
    // Asciidoctor's blocks hold a reference to their parent document, and a
    // converter that followed one would not return.
    const self: { getContext: () => string; getBlocks: () => unknown[] } = {
      getContext: () => "section",
      getBlocks: () => [self],
    };

    const [converted] = convertBlocks({ blocks: [self] });

    expect(converted.blocks).toEqual([{ context: "circular_ref" }]);
  });

  it("marks a block that appears twice in the same conversion", () => {
    const shared = { getContext: () => "paragraph", getSource: () => "once" };

    const converted = convertBlocks({ blocks: [shared, shared] });

    expect(converted).toEqual([
      { context: "paragraph", source: "once" },
      { context: "circular_ref" },
    ]);
  });

  it("does not defend against a block that is not an object", () => {
    // The tracking set only takes objects, and the context accessor is called
    // unguarded, so a null in the list throws. Asciidoctor does not produce
    // one; this records that the guards above stop at the accessors and are
    // not a general tolerance for anything in the array.
    expect(() => convertBlocks({ blocks: [null] })).toThrow(TypeError);
  });
});
