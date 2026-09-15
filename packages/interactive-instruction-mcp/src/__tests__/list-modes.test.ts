/**
 * `list`'s four modes, which were the least-covered code in the package at
 * 51% of branches.
 *
 * It is also the most-called action -- every session starts with it -- and each
 * mode answers a different question: what is there, what mentions this, what
 * matches this word, and what is unfinished. Getting one wrong looks like an
 * empty corpus rather than an error.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ListHandler } from "../tools/instruction/handlers/list.js";
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

let tempDir: string;
let docsDir: string;
let context: InstructionContext;
const list = new ListHandler();

async function write(params: {
  id: string;
  description?: string;
  whenToUse?: string[];
  relatedDocs?: string[];
}): Promise<void> {
  const { id, description, whenToUse, relatedDocs } = params;
  const lines = ["---"];
  if (description !== undefined) lines.push(`description: ${description}`);
  if (whenToUse !== undefined && whenToUse.length > 0) {
    lines.push("whenToUse:", ...whenToUse.map((w) => `  - ${w}`));
  }
  if (relatedDocs !== undefined) {
    lines.push("relatedDocs:", ...relatedDocs.map((r) => `  - ${r}`));
  }
  lines.push("---", "", `# ${id}`, "");

  const file = path.join(docsDir, `${id.split("__").join(path.sep)}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, lines.join("\n"), "utf-8");
  context.reader.invalidateCache();
}

async function run(rawParams: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
  const result = await list.execute({ rawParams: { action: "list", ...rawParams }, context });
  return {
    text: result.content[0].type === "text" ? result.content[0].text : "",
    ...(result.isError === undefined ? {} : { isError: result.isError }),
  };
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "list-modes-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
  context = { reader: new MarkdownReader(docsDir), config };
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("backlinks", () => {
  it("finds what points at a document", async () => {
    await write({ id: "hub", description: "the hub" });
    await write({ id: "detail", description: "a detail", relatedDocs: ["hub"] });

    const { text } = await run({ id: "hub", backlinks: true });

    expect(text).toContain("Documents referencing \"hub\"");
    expect(text).toContain("detail");
  });

  it("says so plainly when nothing does", async () => {
    // An empty listing here reads as "no links", which is the answer, not an
    // error -- someone is checking before a rename or a delete.
    await write({ id: "lonely", description: "nothing points here" });

    const { text, isError } = await run({ id: "lonely", backlinks: true });

    expect(isError).toBeUndefined();
    expect(text).toContain("No documents reference");
  });

  it("does not count a draft as a reference", async () => {
    await write({ id: "hub", description: "the hub" });
    await fs.writeFile(
      path.join(docsDir, DRAFT_DIR, "drafted.md"),
      "---\ndescription: a draft\nrelatedDocs:\n  - hub\n---\n\n# drafted\n",
      "utf-8"
    );
    context.reader.invalidateCache();

    const { text } = await run({ id: "hub", backlinks: true });

    expect(text).toContain("No documents reference");
  });

  it("needs an id, and lists normally without one", async () => {
    await write({ id: "a", description: "a doc" });

    const { text } = await run({ backlinks: true });

    expect(text).toContain("a");
    expect(text).not.toContain("referencing");
  });
});

describe("query", () => {
  it("matches a description", async () => {
    await write({ id: "one", description: "about deployment" });
    await write({ id: "two", description: "about testing" });

    const { text } = await run({ query: "deployment" });

    expect(text).toContain("one");
    expect(text).not.toContain("two");
  });

  it("matches the id, so an English word finds a Japanese document", async () => {
    // The reason the id is searched at all: a corpus written in one language
    // with English ids would otherwise be unsearchable from the ids.
    await write({ id: "deployment__flow", description: "デプロイの手順" });

    expect((await run({ query: "deployment" })).text).toContain("deployment__flow");
  });

  it("matches a whenToUse entry", async () => {
    await write({ id: "one", description: "a doc", whenToUse: ["before releasing"] });

    expect((await run({ query: "releasing" })).text).toContain("one");
  });

  it("ignores case on every field it searches", async () => {
    await write({ id: "CamelCase", description: "MixedCase Description" });

    expect((await run({ query: "camelcase" })).text).toContain("CamelCase");
    expect((await run({ query: "MIXEDCASE" })).text).toContain("CamelCase");
  });

  it("reports a count of zero rather than failing", async () => {
    await write({ id: "one", description: "a doc" });

    const { text, isError } = await run({ query: "nothing matches this" });

    expect(isError).toBeUndefined();
    expect(text).toContain("0 found");
  });

  it("searches inside a category when given an id", async () => {
    await write({ id: "cat__one", description: "in the category" });
    await write({ id: "other__two", description: "in the category" });

    const { text } = await run({ id: "cat", query: "category" });

    expect(text).toContain("cat__one");
    expect(text).not.toContain("other__two");
  });
});

describe("missingMeta", () => {
  beforeEach(async () => {
    await write({ id: "complete", description: "has both", whenToUse: ["testing"] });
    await write({ id: "no-desc", whenToUse: ["testing"] });
    await write({ id: "no-when", description: "has a description" });
    await write({ id: "blank-desc", description: "   ", whenToUse: ["testing"] });
  });

  it("finds documents with no description", async () => {
    const { text } = await run({ missingMeta: "description" });

    expect(text).toContain("no-desc");
    expect(text).not.toContain("no-when");
  });

  it("counts whitespace as no description", async () => {
    // A description of spaces passes a truthiness check and tells a reader
    // nothing, so it has to count as missing.
    expect((await run({ missingMeta: "description" })).text).toContain("blank-desc");
  });

  it("finds documents with no whenToUse", async () => {
    const { text } = await run({ missingMeta: "whenToUse" });

    expect(text).toContain("no-when");
    expect(text).not.toContain("no-desc");
  });

  it("finds documents missing either, with `any`", async () => {
    const { text } = await run({ missingMeta: "any" });

    expect(text).toContain("no-desc");
    expect(text).toContain("no-when");
    expect(text).not.toContain("complete");
  });

  it("combines with a query, naming both in the header", async () => {
    const { text } = await run({ query: "description", missingMeta: "whenToUse" });

    expect(text).toContain('query: "description"');
    expect(text).toContain("missing: whenToUse");
    expect(text).toContain("no-when");
  });
});

describe("a category", () => {
  it("lists what is inside it", async () => {
    await write({ id: "cat__one", description: "first" });
    await write({ id: "cat__two", description: "second" });

    const { text } = await run({ id: "cat" });

    expect(text).toContain("Category: cat");
    expect(text).toContain("one");
    expect(text).toContain("two");
  });

  it("suggests reading instead when the id is a document", async () => {
    // Asking to list a document is a near-miss for `read`, and the response
    // is the only place to say so.
    await write({ id: "just-a-doc", description: "not a category" });

    const { text, isError } = await run({ id: "just-a-doc" });

    expect(isError).toBe(true);
    expect(text).toContain("is not a category");
    expect(text).toContain('action: "read"');
  });

  it("goes deeper only when asked", async () => {
    await write({ id: "cat__sub__deep", description: "nested twice" });
    await write({ id: "cat__shallow", description: "one level" });

    expect((await run({ id: "cat", recursive: true })).text).toContain("deep");
  });
});

describe("the root listing", () => {
  it("shows documents and categories, and leaves drafts out", async () => {
    await write({ id: "top", description: "at the root" });
    await write({ id: "cat__inside", description: "in a category" });
    await fs.writeFile(
      path.join(docsDir, DRAFT_DIR, "drafted.md"),
      "---\ndescription: a draft\n---\n\n# drafted\n",
      "utf-8"
    );
    context.reader.invalidateCache();

    const { text } = await run({});

    expect(text).toContain("top");
    expect(text).toContain("cat");
    expect(text).not.toContain("drafted");
    expect(text).not.toContain(DRAFT_DIR);
  });

  it("lists everything when asked recursively", async () => {
    await write({ id: "cat__inside", description: "in a category" });

    expect((await run({ recursive: true })).text).toContain("inside");
  });

  it("still answers for an empty corpus", async () => {
    const { text, isError } = await run({});

    expect(isError).toBeUndefined();
    expect(text).toBeTruthy();
  });
});
