/**
 * Issue #54: line count is a proxy for "one topic, one claim", and a poor one.
 *
 * Three things were asked for. The first -- counting the body rather than the
 * frontmatter -- is already in, and `lint-handler.test.ts` holds it. These are
 * the other two:
 *
 * - a document can declare that it is deliberately long, with a reason, so the
 *   next reader can tell a considered exception from an unaddressed warning
 * - the same heading appearing twice in one file is a more specific signal than
 *   length: it is what appending to the end of a document looks like, and in
 *   the reported case the appended part was a separable topic
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { LintHandler } from "../tools/instruction/handlers/lint.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import type { InstructionContext, ReminderConfig } from "../types/index.js";

const config: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

let tempDir: string;
let docsDir: string;
let context: InstructionContext;
const lint = new LintHandler();

/** A body comfortably over the 150-line limit. */
const longBody = Array(200).fill("A line of prose.").join("\n");

async function write(params: { id: string; frontmatter?: string; body: string }): Promise<void> {
  const { id, frontmatter, body } = params;
  const head = frontmatter === undefined ? "" : `---\n${frontmatter}\n---\n\n`;
  await fs.writeFile(path.join(docsDir, `${id}.md`), `${head}${body}\n`, "utf-8");
}

async function run(): Promise<string> {
  const result = await lint.execute({ rawParams: { action: "lint" }, context });
  return result.content[0].type === "text" ? result.content[0].text : "";
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lint-structure-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(docsDir, { recursive: true });
  context = { reader: new MarkdownReader(docsDir), config };
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("a document can say it is deliberately long", () => {
  const meta = (extra: string) =>
    `description: A reference table\nwhenToUse:\n  - looking a value up\n${extra}`;

  it("warns without an exemption", async () => {
    await write({ id: "table", frontmatter: meta(""), body: longBody });

    expect(await run()).toContain("document-too-large");
  });

  it("stays quiet with a reason", async () => {
    // A table is worth more in one place than split across three.
    await write({
      id: "table",
      frontmatter: meta('sizeExemption: "A reference table; splitting it means looking in three places."'),
      body: longBody,
    });

    expect(await run()).not.toContain("document-too-large");
  });

  it("needs an actual reason, not just the key", async () => {
    // Otherwise it is a mute button, and the point is to record the judgement.
    await write({ id: "table", frontmatter: meta('sizeExemption: ""'), body: longBody });

    const text = await run();
    expect(text).toContain("sizeExemption");
    expect(text).toContain("reason");
  });

  it("says so when the exemption is no longer needed", async () => {
    // The document was split and the exemption outlived it; nothing else would
    // ever mention it again.
    await write({
      id: "now-short",
      frontmatter: meta('sizeExemption: "Kept whole on purpose."'),
      body: "# Short\n\nTwo lines.",
    });

    const text = await run();
    expect(text).toContain("now-short");
    expect(text).toContain("sizeExemption");
  });

  it("exempts only the document that declares it", async () => {
    await write({
      id: "exempt",
      frontmatter: meta('sizeExemption: "A reference table."'),
      body: longBody,
    });
    await write({ id: "not-exempt", frontmatter: meta(""), body: longBody });

    const text = await run();
    expect(text).toContain("not-exempt");
    expect(text.split("not-exempt")[0]).not.toContain("document-too-large: exempt");
  });
});

describe("the same heading twice in one document", () => {
  const meta = "description: A document\nwhenToUse:\n  - testing";

  it("is reported", async () => {
    // What appending to the end of a document looks like: the section that was
    // already there, and a second copy of it further down.
    await write({
      id: "appended",
      frontmatter: meta,
      body: [
        "# Title",
        "",
        "## Related",
        "",
        "- a",
        "",
        "## Something else",
        "",
        "Body.",
        "",
        "## Related",
        "",
        "- b",
      ].join("\n"),
    });

    const text = await run();
    expect(text).toContain("duplicate-heading");
    expect(text).toContain("Related");
  });

  it("is not reported for a document whose headings are all distinct", async () => {
    await write({
      id: "clean",
      frontmatter: meta,
      body: "# Title\n\n## One\n\nBody.\n\n## Two\n\nBody.",
    });

    expect(await run()).not.toContain("duplicate-heading");
  });

  it("does not count the same text at different levels", async () => {
    // `# Setup` and `## Setup` under it is nesting, not a repeated section.
    await write({
      id: "nested",
      frontmatter: meta,
      body: "# Setup\n\n## Setup\n\nBody.",
    });

    expect(await run()).not.toContain("duplicate-heading");
  });

  it("ignores headings inside fenced code", async () => {
    // A shell comment is not a section, and a document full of examples would
    // otherwise be unusable.
    await write({
      id: "fenced",
      frontmatter: meta,
      body: [
        "# Title",
        "",
        "## Example",
        "",
        "```sh",
        "# Example",
        "echo hi",
        "```",
        "",
        "```sh",
        "# Example",
        "echo again",
        "```",
      ].join("\n"),
    });

    expect(await run()).not.toContain("duplicate-heading");
  });

  it("is not silenced by a size exemption", async () => {
    // The exemption says the document is deliberately long, which says nothing
    // about its structure being broken.
    await write({
      id: "long-and-repeated",
      frontmatter: `${meta}\nsizeExemption: "A runbook; the steps have to stay in order."`,
      body: `# Runbook\n\n## Related\n\n- a\n\n${longBody}\n\n## Related\n\n- b`,
    });

    const text = await run();
    expect(text).toContain("duplicate-heading");
    expect(text).not.toContain("document-too-large");
  });
});
