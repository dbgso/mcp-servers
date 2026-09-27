/**
 * Frontmatter that does not parse, which is a different fact from having none.
 *
 * A description containing an unquoted `: ` is a mapping rather than a string, so
 * the parse fails for the whole block. Everything downstream then behaves as
 * though the document had no metadata: `lint` reported a missing description and
 * a missing `whenToUse` -- neither of which was the cause -- and a `relatedDocs`
 * entry plainly present in the file went unseen, so the document it named was
 * reported as an orphan. One unquoted colon, four findings, three of them naming
 * the wrong thing and one simply false.
 *
 * Worse on the write side: `updateFrontmatter` starts from an empty block when
 * the existing one is unreadable, so a caller who asked to change a description
 * had `whenToUse` and `relatedDocs` deleted without being told. On a draft there
 * is not even a diff to notice it in.
 *
 * Written after doing it by hand to this repository's own corpus.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { AddHandler } from "../tools/instruction/handlers/add.js";
import { UpdateHandler } from "../tools/instruction/handlers/update.js";
import { LintHandler } from "../tools/instruction/handlers/lint.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR } from "../constants.js";
import type { InstructionContext, ReminderConfig } from "../types/index.js";

const config: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

/** The exact shape that started this: a colon inside an unquoted value. */
const BROKEN = [
  "---",
  "description: What a report has to contain: the colon breaks this",
  "whenToUse:",
  "  - keep me",
  "relatedDocs:",
  "  - other",
  "---",
  "",
  "# Broken",
  "",
  "body",
  "",
].join("\n");

let tempDir: string;
let docsDir: string;
let context: InstructionContext;

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((c) => c.text ?? "").join("\n");

const call = async (
  handler: { execute: (p: { rawParams: unknown; context: InstructionContext }) => Promise<{ content: { type: string; text?: string }[]; isError?: boolean }> },
  rawParams: unknown
) => handler.execute({ rawParams, context });

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "unreadable-fm-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
  context = { reader: new MarkdownReader(docsDir), config };
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("lint, on a document whose frontmatter does not parse", () => {
  beforeEach(async () => {
    await fs.writeFile(path.join(docsDir, "broken.md"), BROKEN, "utf-8");
    context.reader.invalidateCache();
  });

  it("says the frontmatter is unreadable, and why", async () => {
    const lint = text(await call(new LintHandler(), { action: "lint" }));

    expect(lint).toContain("frontmatter-unreadable");
    expect(lint).toContain("not valid YAML");
    // The parser's own message, so the reader is told where to look rather than
    // being left to find the colon themselves.
    expect(lint).toMatch(/line \d+, column \d+/);
  });

  it("does not report the consequences as though they were the cause", async () => {
    // These fired before, and the fix for all of them is the same pair of quotes.
    const lint = text(await call(new LintHandler(), { action: "lint" }));

    expect(lint).not.toContain("Missing description");
    expect(lint).not.toContain("Missing whenToUse");
  });

  it("is an error, not a warning", async () => {
    // Everything read from this document is wrong while it holds.
    const lint = text(await call(new LintHandler(), { action: "lint" }));

    expect(lint).toContain("[x] **broken**");
  });

  it("leaves a sound document alone", async () => {
    await fs.writeFile(
      path.join(docsDir, "fine.md"),
      "---\ndescription: A sound document.\nwhenToUse:\n  - testing\n---\n\n# Fine\n\nbody\n",
      "utf-8"
    );
    context.reader.invalidateCache();

    const lint = text(await call(new LintHandler(), { action: "lint" }));

    expect(lint).not.toContain("**fine**: The frontmatter is not valid YAML");
  });
});

describe("writing to a document whose frontmatter does not parse", () => {
  it("is refused rather than done, and the file is untouched", async () => {
    const file = path.join(docsDir, "broken.md");
    await fs.writeFile(file, BROKEN, "utf-8");
    context.reader.invalidateCache();

    const result = await call(new UpdateHandler(), {
      action: "update", id: "broken", description: "A safe description.",
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not valid YAML");
    expect(text(result)).toContain("would drop");
    // The whole of the point: `whenToUse` and `relatedDocs` used to go silently.
    expect(await fs.readFile(file, "utf-8")).toBe(BROKEN);
  });

  it("is refused on a draft too, where there is no diff to notice it in", async () => {
    const file = path.join(docsDir, DRAFT_DIR, "broken.md");
    await fs.writeFile(file, BROKEN, "utf-8");
    context.reader.invalidateCache();

    const result = await call(new UpdateHandler(), {
      action: "update", id: "broken", description: "A safe description.",
    });

    expect(result.isError).toBe(true);
    expect(await fs.readFile(file, "utf-8")).toBe(BROKEN);
  });

  it("refuses `add` whose content carries an unreadable block", async () => {
    // `add` is documented as keeping the metadata written in `content`. A block
    // that does not parse breaks that promise without saying so.
    const result = await call(new AddHandler(), {
      action: "add", id: "viaadd", content: BROKEN,
      description: "given as an argument", whenToUse: ["arg"],
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not valid YAML");
  });

  it("still writes when the block parses", async () => {
    const result = await call(new AddHandler(), {
      action: "add", id: "sound", content: "# Sound\n\nbody",
      description: "A sound document.", whenToUse: ["testing"],
    });

    expect(result.isError).toBeFalsy();
  });
});
