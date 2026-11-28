/**
 * `backlinks`, which was `list(backlinks: true)` until the condition on `id`
 * turned out to be the symptom of a mode that did not belong.
 *
 * Three of the checks here replace ones that could not fail. In `list` the id
 * was optional, so:
 *   - the flow step covering backlinks called it without an id and expected two
 *     document names back -- which the root listing it fell through to prints;
 *   - the unit test for that case asserted `toContain("a")`, true of any English
 *     sentence, so it passed before the guard and after it alike.
 * Here the schema requires `id`, so the case those were reaching for cannot be
 * constructed -- which is the point of the move, and is asserted below.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { BacklinksHandler } from "../tools/instruction/handlers/backlinks.js";
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
const backlinks = new BacklinksHandler();

async function write(params: {
  id: string;
  description?: string;
  relatedDocs?: string[];
  draft?: boolean;
}): Promise<void> {
  const { id, description = "a doc", relatedDocs, draft } = params;
  const lines = ["---", `description: ${description}`];
  if (relatedDocs !== undefined) {
    lines.push("relatedDocs:", ...relatedDocs.map((r) => `  - ${r}`));
  }
  lines.push("---", "", `# ${id}`, "");

  const base = draft === true ? path.join(docsDir, DRAFT_DIR) : docsDir;
  const file = path.join(base, `${id.split("__").join(path.sep)}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, lines.join("\n"), "utf-8");
  context.reader.invalidateCache();
}

async function run(rawParams: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
  const result = await backlinks.execute({
    rawParams: { action: "backlinks", ...rawParams },
    context,
  });
  return {
    text: result.content[0].type === "text" ? result.content[0].text : "",
    ...(result.isError === undefined ? {} : { isError: result.isError }),
  };
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "backlinks-"));
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

    const { text } = await run({ id: "hub" });

    expect(text).toContain('Documents referencing "hub": 1 found');
    expect(text).toContain("detail");
  });

  it("does not report a document as referencing itself", async () => {
    await write({ id: "hub", description: "the hub" });
    await write({ id: "detail", description: "a detail", relatedDocs: ["hub"] });

    const { text } = await run({ id: "hub" });

    expect(text).not.toContain("**hub**");
  });

  it("says so plainly when nothing does, and is not an error", async () => {
    // Someone is checking before a rename or a delete. "Nothing points here" is
    // the answer they asked for, not a failure.
    await write({ id: "lonely", description: "nothing points here" });

    const { text, isError } = await run({ id: "lonely" });

    expect(isError).toBeUndefined();
    expect(text).toContain("No documents reference");
  });

  it("does not count a draft as a reference", async () => {
    await write({ id: "hub", description: "the hub" });
    await write({ id: "drafted", description: "a draft", relatedDocs: ["hub"], draft: true });

    const { text } = await run({ id: "hub" });

    expect(text).toContain("No documents reference");
  });

  it("separates a missing document from one nothing references", async () => {
    // `list` answered both with "No documents reference ...", which sends the
    // caller off to add links to an id that was mistyped.
    await write({ id: "present", description: "here" });

    const missing = await run({ id: "typo" });
    const lonely = await run({ id: "present" });

    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('No document "typo"');
    expect(lonely.isError).toBeUndefined();
    expect(lonely.text).toContain("No documents reference");
  });

  it("requires id in the schema, not in a hand-written guard", async () => {
    // The whole reason this is its own action. There is no fall-through to
    // refuse, because the call never reaches the handler body.
    const { text, isError } = await run({});

    expect(isError).toBe(true);
    // And the corpus is nowhere in the answer -- which is how the old bug read
    // as a result rather than a refusal.
    await write({ id: "alpha", description: "the alpha doc" });
    expect(text).not.toContain("Available documents");
  });
});
