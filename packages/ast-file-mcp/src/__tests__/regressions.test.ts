/**
 * Bugs found while merging the Markdown and AsciiDoc twins, one test each.
 *
 * Every case here failed before its fix. Most come from the same root: a
 * behaviour written twice, where the copies had drifted -- four slug functions
 * that disagreed about which anchor a heading has, two `query` methods of which
 * only one honoured `heading`, three directory readers of which one answered an
 * unsupported pattern with an empty result instead of an error.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { MarkdownHandler } from "../handlers/markdown.js";
import { AsciidocHandler } from "../handlers/asciidoc.js";
import { TopicIndexHandler } from "../tools/handlers/topic-index.js";

let dir: string;
const md = new MarkdownHandler();
const adoc = new AsciidocHandler();

async function file(params: { name: string; content: string }): Promise<string> {
  const path = join(dir, params.name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, params.content, "utf-8");
  return path;
}

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((c) => c.text ?? "").join("\n");

/** The anchors topic_index hands out for the documents in `dir`. */
async function topicAnchors(): Promise<Record<string, string>> {
  const result = await new TopicIndexHandler().execute({ directory: dir });
  const { topics } = JSON.parse(text(result)) as { topics: { text: string; anchor: string }[] };
  return Object.fromEntries(topics.map((t) => [t.text, t.anchor]));
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "regressions-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("a one-line AsciiDoc admonition written back", () => {
  it.each([
    { name: "one line", source: "WARNING: careful\n", expected: "WARNING: careful" },
    { name: "a paragraph", source: "NOTE: two\nlines here\n", expected: "NOTE: two\nlines here" },
  ])("keeps its body when it is $name", async ({ source, expected }) => {
    // The parser puts a paragraph admonition's body in `source`, not `lines`;
    // the serialiser looked only at `lines` and wrote an empty `====` pair.
    const path = await file({ name: "admonition.adoc", content: `= T\n\n${source}` });
    const { ast } = await adoc.read(path);
    const out = join(dir, "out.adoc");

    await adoc.write({ filePath: out, ast });

    expect(await readFile(out, "utf-8")).toContain(expected);
  });
});

describe("anchors topic_index hands out are the anchors the link tools accept", () => {
  it("tells a Markdown link to a heading in Japanese from one to nowhere", async () => {
    // The old slug dropped every non-ASCII letter, so every Japanese heading
    // and every Japanese anchor became "" -- and each matched all the others.
    const path = await file({
      name: "ja.md",
      content: "# 概要\n\n[詳細へ](#詳細設計) [無い](#存在しない)\n\n## 詳細設計\n\ntext\n",
    });
    const anchors = await topicAnchors();
    expect(anchors["詳細設計"]).toBe("詳細設計");

    const result = await md.checkLinks({ filePath: path });

    expect(result.valid.map((l) => l.url)).toEqual(["#詳細設計"]);
    expect(result.broken.map((l) => l.url)).toEqual(["#存在しない"]);
  });

  it("follows that link with go_to_definition", async () => {
    const path = await file({
      name: "ja.md",
      content: "# 概要\n\n[詳細へ](#詳細設計)\n\n## 詳細設計\n\ntext\n",
    });

    const result = await md.goToDefinition({ filePath: path, line: 3, column: 2 });

    expect(result.definitions).toMatchObject([{ kind: "heading", line: 5 }]);
  });

  it("accepts the AsciiDoc ids asciidoctor generates, in the same file and across files", async () => {
    await file({ name: "other.adoc", content: "= Other\n\n== Far Section\n\ntext\n" });
    const path = await file({
      name: "here.adoc",
      content: "= Here\n\nSee <<_near_section>> and xref:other.adoc#_far_section[far].\n\n== Near Section\n\ntext\n",
    });
    const anchors = await topicAnchors();
    expect(anchors["Near Section"]).toBe("_near_section");
    expect(anchors["Far Section"]).toBe("_far_section");

    const result = await adoc.checkLinks({ filePath: path });

    expect(result.broken).toEqual([]);
    expect(result.valid).toHaveLength(2);
  });

  it("writes a table of contents whose anchors are topic_index's", async () => {
    const mdPath = await file({ name: "ja.md", content: "# 概要\n\n## 詳細設計\n" });
    const adocPath = await file({ name: "doc.adoc", content: "= Doc\n\n== Near Section\n" });

    expect(await md.generateToc({ filePath: mdPath })).toContain("[詳細設計](#詳細設計)");
    expect(await adoc.generateToc({ filePath: adocPath })).toContain("<<_near_section,Near Section>>");
  });
});
