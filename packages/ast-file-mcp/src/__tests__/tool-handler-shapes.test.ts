/**
 * The tool handlers' remaining output shapes.
 *
 * Each of these tools has one code path per output format and one per input
 * kind -- a file or a directory, a pattern that names markdown or one that names
 * AsciiDoc, warnings asked for or suppressed. The integration suite drives the
 * default of each, so the alternatives had never run: a `table` of a single
 * file, a directory filtered to `*.adoc`, a `sections` query with no explicit
 * level. A format that throws or comes back empty is the tool returning nothing
 * useful to the caller, with the schema none the wiser.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { StructureAnalysisHandler } from "../tools/handlers/structure-analysis.js";
import { AstReadHandler } from "../tools/handlers/ast-read.js";
import { TopicIndexHandler } from "../tools/handlers/topic-index.js";
import { LintDocumentHandler } from "../tools/handlers/lint-document.js";

let dir: string;

const structure = new StructureAnalysisHandler();
const astRead = new AstReadHandler();
const topics = new TopicIndexHandler();
const lint = new LintDocumentHandler();

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((c) => c.text ?? "").join("\n");

async function file(params: { name: string; content: string }): Promise<string> {
  const path = join(dir, params.name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, params.content, "utf-8");
  return path;
}

/** A markdown document with a heading hierarchy that skips a level, so it lints. */
const MARKDOWN = `# Title

Some prose with [a link](other.md).

### Skipped a level

More prose.
`;

const ASCIIDOC = `= Title

Some prose.

== Section

More prose with https://example.com[a link].
`;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tool-shapes-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("structure_analysis over a directory", () => {
  beforeEach(async () => {
    await file({ name: "one.md", content: MARKDOWN });
    await file({ name: "two.adoc", content: ASCIIDOC });
  });

  it.each([
    { pattern: "*.md", expected: "one.md", unexpected: "two.adoc" },
    { pattern: "*.adoc", expected: "two.adoc", unexpected: "one.md" },
  ])("keeps only what $pattern names", async ({ pattern, expected, unexpected }) => {
    const result = await structure.execute({
      file_path: dir,
      pattern,
      output_format: "table",
      include_warnings: true,
    });

    expect(text(result)).toContain(expected);
    expect(text(result)).not.toContain(unexpected);
  });

  it("finds nothing for a pattern neither handler claims", async () => {
    // `*.txt` is not a mistake worth an error -- the directory genuinely holds
    // no such documents -- but it must not silently fall back to everything.
    const result = await structure.execute({
      file_path: dir,
      pattern: "*.txt",
      output_format: "json",
      include_warnings: true,
    });

    expect(JSON.parse(text(result)).fileCount).toBe(0);
  });

  it("drops the warnings when it is told to", async () => {
    const withWarnings = await structure.execute({
      file_path: dir,
      output_format: "json",
      include_warnings: true,
    });
    const without = await structure.execute({
      file_path: dir,
      output_format: "json",
      include_warnings: false,
    });

    expect(JSON.parse(text(withWarnings)).warnings.length).toBeGreaterThan(0);
    expect(JSON.parse(text(without)).warnings).toEqual([]);
  });

  it.each(["tree", "table"] as const)("lists the warnings in the %s format", async (format) => {
    const result = await structure.execute({
      file_path: dir,
      output_format: format,
      include_warnings: true,
    });

    expect(text(result)).toMatch(/[Ww]arning/);
    expect(text(result)).toContain("one.md");
  });

  it.each(["tree", "table"] as const)(
    "leaves the warnings out of the %s format when there are none",
    async (format) => {
      const clean = await mkdtemp(join(tmpdir(), "tool-clean-"));
      await writeFile(join(clean, "fine.md"), "# Title\n\nProse.\n", "utf-8");

      const result = await structure.execute({
        file_path: clean,
        output_format: format,
        include_warnings: true,
      });

      expect(text(result)).not.toContain("## Warnings");
      expect(text(result)).not.toContain("Warnings:");
      await rm(clean, { recursive: true, force: true });
    }
  );
});

describe("structure_analysis over one file", () => {
  it("renders its sections and warnings as tables", async () => {
    const path = await file({ name: "one.md", content: MARKDOWN });

    const result = await structure.execute({
      file_path: path,
      output_format: "table",
      include_warnings: true,
    });

    expect(text(result)).toContain("## File Summary");
    expect(text(result)).toContain("## Sections");
    expect(text(result)).toContain("## Warnings");
  });

  it("leaves both tables out when there is nothing in them", async () => {
    // A document with no headings has no sections, and nothing to warn about
    // except the missing title, so the section table must not be emitted
    // empty -- a table with only a header row reads as data loss.
    const path = await file({ name: "bare.md", content: "Just prose, no heading.\n" });

    const result = await structure.execute({
      file_path: path,
      output_format: "table",
      include_warnings: false,
    });

    expect(text(result)).toContain("## File Summary");
    expect(text(result)).not.toContain("## Sections");
    expect(text(result)).not.toContain("## Warnings");
  });
});

describe("ast_read's sections query", () => {
  it("defaults to `##` for markdown", async () => {
    const path = await file({
      name: "levels.md",
      content: "# Title\n\n## First\n\ntext\n\n### Nested\n\ntext\n\n## Second\n\ntext\n",
    });

    const result = await astRead.execute({ file_path: path, query: "sections" });
    const data = JSON.parse(text(result));

    expect(data.sections.map((s: { title: string }) => s.title)).toEqual(["First", "Second"]);
  });

  it("defaults to `==` for AsciiDoc, which is the same altitude", async () => {
    const path = await file({
      name: "levels.adoc",
      content: "= Title\n\n== First\n\ntext\n\n=== Nested\n\ntext\n\n== Second\n\ntext\n",
    });

    const result = await astRead.execute({ file_path: path, query: "sections" });
    const data = JSON.parse(text(result));

    expect(data.sections.map((s: { title: string }) => s.title)).toEqual(["First", "Second"]);
  });

  it("takes the level it is given instead", async () => {
    const path = await file({
      name: "levels.md",
      content: "# Title\n\n## First\n\ntext\n\n### Nested\n\ntext\n",
    });

    const result = await astRead.execute({ file_path: path, query: "sections", level: 3 });
    const data = JSON.parse(text(result));

    expect(data.sections.map((s: { title: string }) => s.title)).toEqual(["Nested"]);
  });
});

describe("topic_index", () => {
  it("refuses a pattern for a format it does not read", async () => {
    await file({ name: "one.md", content: MARKDOWN });

    const result = await topics.execute({ directory: dir, pattern: "*.txt" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Unsupported file pattern");
  });
});

describe("lint_document", () => {
  it("puts the issues that belong to no line last", async () => {
    // `missing-title` is about the document rather than a line in it. Sorting
    // it first would put the least located issue at the top of the report.
    const path = await file({
      name: "unsorted.md",
      content: "## Second level first\n\ntext\n\n```\nno language\n```\n",
    });

    const result = await lint.execute({ file_path: path });
    const issues = JSON.parse(text(result)).issues as { rule: string; line?: number }[];

    expect(issues.length).toBeGreaterThan(1);
    expect(issues[issues.length - 1].line).toBeUndefined();
    const lined = issues.filter((i) => i.line !== undefined).map((i) => i.line as number);
    expect([...lined]).toEqual([...lined].sort((a, b) => a - b));
  });
});
