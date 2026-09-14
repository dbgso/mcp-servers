/**
 * The last few paths, each reached only by an input the earlier suites had no
 * reason to use: several files at once, a heading whose text is an image, a
 * query type outside the schema, a cross-reference written with the other
 * format's extension.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { MarkdownHandler } from "../handlers/markdown.js";
import { AsciidocHandler } from "../handlers/asciidoc.js";
import { AstReadHandler } from "../tools/handlers/ast-read.js";
import { FindBacklinksHandler } from "../tools/handlers/find-backlinks.js";
import type { QueryType, FindBacklinksResult } from "../types/index.js";

let dir: string;
const md = new MarkdownHandler();
const adoc = new AsciidocHandler();
const astRead = new AstReadHandler();
const findBacklinks = new FindBacklinksHandler();

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((c) => c.text ?? "").join("\n");

async function file(params: { name: string; content: string }): Promise<string> {
  const path = join(dir, params.name);
  await writeFile(path, params.content, "utf-8");
  return path;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "remaining-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ast_read over several files", () => {
  it("answers for each of them", async () => {
    const a = await file({ name: "a.md", content: "# A\n\n## One\n" });
    const b = await file({ name: "b.adoc", content: "= B\n\n== Two\n" });

    const result = await astRead.execute({ file_path: [a, b], query: "headings" });
    const data = JSON.parse(text(result));

    expect(data.results ?? data).toBeTruthy();
    expect(text(result)).toContain("One");
    expect(text(result)).toContain("Two");
  });
});

describe("a query type outside the schema", () => {
  it("falls back to the whole AST rather than throwing", async () => {
    // The schema rejects this, so it can only arrive from inside the process.
    // Returning the document is the answer that loses nothing.
    const path = await file({ name: "a.md", content: "# A\n\ntext\n" });

    const result = await md.query({ filePath: path, queryType: "unknown" as QueryType });

    expect(result.query).toBe("full");
    expect((result.data as { type: string }).type).toBe("root");
  });
});

describe("a heading with no text of its own", () => {
  it("reads as empty rather than as the markup inside it", async () => {
    // `# ![alt](x.png)` is a heading whose only child is an image, which has
    // no text node under it to collect.
    const path = await file({ name: "a.md", content: "# ![alt](picture.png)\n\ntext\n" });

    const { ast } = await md.read(path);
    const headings = md.getHeadings({ ast });

    expect(headings).toEqual([{ depth: 1, text: "", line: 1 }]);
  });
});

describe("AsciiDoc headings from a document object", () => {
  /** The accessors `getHeadings` uses, and nothing else. */
  function section(params: {
    level: number;
    title?: string;
    line?: number;
    sections?: unknown[];
  }) {
    const { level, title = "Section", line = 1, sections = [] } = params;
    return {
      getLevel: () => level,
      getTitle: () => title,
      getLineNumber: () => line,
      getSections: () => sections,
    };
  }

  function doc(sections: unknown[], title: string | null = "Title") {
    return {
      getTitle: () => title ?? undefined,
      getSections: () => sections,
      getSource: () => "",
      getBlocks: () => [],
    };
  }

  it("stops at the depth it is given", async () => {
    const nested = section({ level: 2, title: "Deeper", line: 7 });
    const tree = doc([section({ level: 1, title: "One", line: 3, sections: [nested] })]);

    const headings = adoc.getHeadings({ doc: tree as never, maxDepth: 2 });

    expect(headings.map((h) => h.text)).toEqual(["Title", "One"]);
  });

  it("keeps the title when the depth allows it", async () => {
    const tree = doc([section({ level: 1, title: "One" })]);

    const headings = adoc.getHeadings({ doc: tree as never, maxDepth: 1 });

    expect(headings.map((h) => h.text)).toEqual(["Title"]);
  });

  it("leaves out a document with no title", async () => {
    const tree = doc([section({ level: 1, title: "One" })], null);

    const headings = adoc.getHeadings({ doc: tree as never });

    expect(headings.map((h) => h.text)).toEqual(["One"]);
  });

  it("reads a section with no title as empty", async () => {
    const untitled = {
      getLevel: () => 1,
      getTitle: () => undefined,
      getLineNumber: () => 3,
      getSections: () => [],
    };

    const headings = adoc.getHeadings({ doc: doc([untitled]) as never });

    expect(headings.map((h) => h.text)).toEqual(["Title", ""]);
  });
});

describe("crawling AsciiDoc", () => {
  it("does not follow a reference into the same document", async () => {
    await file({ name: "a.adoc", content: "= A\n\nSee xref:#a-section[it].\n\n== A Section\n" });

    const result = await adoc.crawl({ startFile: join(dir, "a.adoc") });

    expect(result.files).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });
});

describe("a cross-reference written with the other format's extension", () => {
  it("still finds the document it names", async () => {
    // `.asciidoc` and `.adoc` are the same format, and a link written with one
    // has to find a file saved as the other -- otherwise renaming the file
    // extension silently breaks impact analysis.
    const target = await file({ name: "data-flow.adoc", content: "= Data flow\n" });
    await file({ name: "source.adoc", content: "= Source\n\nSee xref:data-flow.asciidoc[it].\n" });

    const result = await findBacklinks.execute({
      file_path: target,
      directory: dir,
      include_anchors: true,
    });
    const parsed = JSON.parse(text(result)) as FindBacklinksResult;

    expect(parsed.backlinks).toHaveLength(1);
  });
});
