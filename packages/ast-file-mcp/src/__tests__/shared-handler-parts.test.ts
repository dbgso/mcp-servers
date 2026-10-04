/**
 * The pieces both document handlers now share: link targets and the result
 * buckets, the directory walk, and the section range scan. Each was written
 * once per handler before, so these are driven directly rather than through
 * a document of each type.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import {
  ExternalTarget,
  FileTarget,
  LinkChecker,
  SameFileAnchorTarget,
  isExternalUrl,
  parseLinkTarget,
  splitUrl,
  toLinkCheckResult,
  type LinkCheckContext,
  type LinkedDocument,
} from "../handlers/links.js";
import { findFilesByExtension } from "../handlers/file-walk.js";
import { findSectionRange, groupSections } from "../handlers/sections.js";
import { MarkdownHandler } from "../handlers/markdown.js";
import { getHandler, HANDLERS, readDocuments } from "../handlers/index.js";

let dir: string;

async function file(params: { name: string; content: string }): Promise<string> {
  const path = join(dir, params.name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, params.content, "utf-8");
  return path;
}

/** A document that has exactly the headings it is given. */
const document: LinkedDocument = new (class implements LinkedDocument {
  readonly fileType = "markdown" as const;
  readonly anchorNoun = "heading";
  headingsOf(content: string) {
    return content.split("\n").map((text, i) => ({ depth: 2, text, line: i + 1 }));
  }
  checkSameFileAnchor() {
    return { status: "valid" as const };
  }
})();

function context(filePath: string): LinkCheckContext {
  return { filePath, headings: [], checkExternal: false, timeout: 100, document };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "shared-parts-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("reading a URL", () => {
  it.each([
    { url: "#intro", target: SameFileAnchorTarget },
    { url: "http://example.com", target: ExternalTarget },
    { url: "https://example.com/a#b", target: ExternalTarget },
    { url: "other.md#intro", target: FileTarget },
    { url: "other.md", target: FileTarget },
  ])("reads $url as a $target.name", ({ url, target }) => {
    expect(parseLinkTarget(url)).toBeInstanceOf(target);
  });

  it("asks one question for both external schemes", () => {
    expect(["http://a", "https://a", "ftp://a", "./a"].map(isExternalUrl)).toEqual([true, true, false, false]);
  });

  it("splits a path from its anchor", () => {
    expect(splitUrl("a.md#b")).toEqual({ pathPart: "a.md", anchor: "b" });
    expect(splitUrl("a.md")).toEqual({ pathPart: "a.md", anchor: undefined });
  });
});

describe("checking a file target", () => {
  it("skips an external link unless asked to check it", async () => {
    expect(await new ExternalTarget("https://example.com").accept(new LinkChecker(context(join(dir, "x.md"))))).toEqual({
      status: "skipped",
      reason: "external link (check_external=false)",
    });
  });

  it("finds the anchor among the target's headings, and names a missing one", async () => {
    const source = await file({ name: "source.md", content: "" });
    await file({ name: "target.md", content: "Present Heading" });

    expect(await new FileTarget("target.md", "present-heading").accept(new LinkChecker(context(source)))).toEqual({ status: "valid" });
    expect(await new FileTarget("target.md", "absent").accept(new LinkChecker(context(source)))).toEqual({
      status: "broken",
      reason: 'heading "absent" not found in target.md',
    });
  });

  it("says the target could not be read when it is not a file", async () => {
    const source = await file({ name: "source.md", content: "" });
    await mkdir(join(dir, "folder.md"));

    expect(await new FileTarget("folder.md", "a").accept(new LinkChecker(context(source)))).toEqual({
      status: "broken",
      reason: "failed to read folder.md",
    });
  });

  it("resolves an empty path to the linking file itself", () => {
    expect(new FileTarget("", "a").resolveFrom("/docs/x.md")).toBe("/docs/x.md");
  });
});

describe("sorting outcomes into the result", () => {
  it("puts each link in the list its status names, with its reason", () => {
    const link = (url: string) => ({ url, text: url, title: null, line: 1 });

    const result = toLinkCheckResult({
      filePath: "f.md",
      checked: [
        { link: link("a"), outcome: { status: "valid" } },
        { link: link("b"), outcome: { status: "broken", reason: "gone" } },
        { link: link("c"), outcome: { status: "skipped", reason: "external" } },
      ],
    });

    expect(result).toEqual({
      filePath: "f.md",
      valid: [{ url: "a", text: "a", line: 1 }],
      broken: [{ url: "b", text: "b", line: 1, reason: "gone" }],
      skipped: [{ url: "c", text: "c", line: 1, reason: "external" }],
    });
  });
});

describe("walking a directory", () => {
  it("finds files by extension and passes over node_modules and .git", async () => {
    await file({ name: "a.md", content: "" });
    await file({ name: "sub/b.MD", content: "" });
    await file({ name: "c.txt", content: "" });
    await file({ name: "node_modules/d.md", content: "" });
    await file({ name: ".git/e.md", content: "" });

    const found = await findFilesByExtension({ directory: dir, extensions: ["md"] });

    expect(found).toEqual([join(dir, "a.md"), join(dir, "sub/b.MD")]);
  });

  it("finds nothing in a directory that is not there", async () => {
    expect(await findFilesByExtension({ directory: join(dir, "missing"), extensions: ["md"] })).toEqual([]);
  });
});

describe("a section's range", () => {
  const items = ["# A", "a", "## B", "b", "### C", "c", "## D", "d"];
  const headingOf = (line: string) => {
    const match = line.match(/^(#+) (.+)$/);
    return match ? { depth: match[1].length, text: match[2] } : undefined;
  };

  it.each([
    { heading: "B", expected: { start: 2, end: 6 } },
    { heading: "C", expected: { start: 4, end: 6 } },
    { heading: "D", expected: { start: 6, end: 8 } },
    { heading: "A", expected: { start: 0, end: 8 } },
    { heading: "Z", expected: undefined },
  ])("of $heading is $expected", ({ heading, expected }) => {
    expect(findSectionRange({ items, headingOf, headingText: heading })).toEqual(expected);
  });

  it("groups what follows a section into it, and what precedes all of them into the preamble", () => {
    const grouped = groupSections({
      items,
      sectionTitle: (line) => {
        const heading = headingOf(line);
        return heading?.depth === 2 ? heading.text : undefined;
      },
      level: 2,
    });

    expect(grouped.preamble).toEqual(["# A", "a"]);
    expect(grouped.sections.map((s) => [s.title, s.content.length])).toEqual([
      ["B", 4],
      ["D", 2],
    ]);
  });
});

describe("crawling into something that is not a file", () => {
  it("records the read error and goes on", async () => {
    const start = await file({ name: "start.md", content: "# S\n\n[f](folder.md)\n" });
    await mkdir(join(dir, "folder.md"));

    const result = await new MarkdownHandler().crawl({ startFile: start });

    expect(result.files.map((f) => f.filePath)).toEqual([start]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].filePath).toBe(join(dir, "folder.md"));
  });
});

describe("reordering by titles one of which is not there", () => {
  it("passes over the missing title and keeps the rest of the order", async () => {
    const path = await file({ name: "doc.md", content: "## A\n\na\n\n## B\n\nb\n" });

    await new MarkdownHandler().reorderSections({ filePath: path, order: ["Nope", "B"], level: 2 });
    const out = await readFile(path, "utf-8");

    expect(out.indexOf("## B")).toBeLessThan(out.indexOf("## A"));
  });
});

describe("the handler registry", () => {
  it("picks a handler by extension, case aside, and none for an unknown one", () => {
    expect(getHandler("/a/B.MD")).toBe(HANDLERS.markdown);
    expect(getHandler("/a/b.asc")).toBe(HANDLERS.asciidoc);
    expect(getHandler("/a/README")).toBeUndefined();
  });

  it("reads every document type sorted by path, or the one a pattern names", async () => {
    await file({ name: "b.md", content: "# B\n" });
    await file({ name: "a.adoc", content: "= A\n" });

    const all = await readDocuments({ directory: dir });
    const adoc = await readDocuments({ directory: dir, pattern: "*.adoc" });

    expect("files" in all && all.files.map((f) => f.fileType)).toEqual(["asciidoc", "markdown"]);
    expect("files" in adoc && adoc.files.map((f) => f.fileType)).toEqual(["asciidoc"]);
    expect(await readDocuments({ directory: dir, pattern: "*.txt" })).toEqual({
      error: "Unsupported file pattern: *.txt",
    });
  });
});
