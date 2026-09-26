/**
 * Which state each action is about, from the spec table.
 *
 * `docs/chain/spec/01M3ENJT7B4DJ90YDN1EK6454S.md` decides this by the nature of
 * the rule rather than by where the document lives: what a document answers on
 * its own applies to a draft too, what only the set can answer does not, and an
 * action that is about the workflow exists only in the state that has one.
 *
 * It was not decided before. Drafts shared one "internal" predicate with the
 * trash directory -- a grouping argued for on the trash's behalf -- so `lint`
 * skipped them silently, `graph` called them missing, and nothing listed them
 * at all while `approve` and `set_status` both took a batch of ids.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR } from "../constants.js";
import { LintHandler } from "../tools/instruction/handlers/lint.js";
import { ListHandler } from "../tools/instruction/handlers/list.js";
import { GraphHandler } from "../tools/instruction/handlers/graph.js";
import type { InstructionContext, ReminderConfig } from "../types/index.js";
import { draftWorkflowManager } from "../workflows/draft-workflow.js";

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
const list = new ListHandler();
const graph = new GraphHandler();

async function write(params: { id: string; body: string; frontmatter?: string }) {
  const { id, body, frontmatter = "description: A document\nwhenToUse:\n  - testing" } = params;
  const file = path.join(docsDir, `${id.replace(/__/g, "/")}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `---\n${frontmatter}\n---\n\n${body}\n`);
}

const longBody = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}.`).join("\n");

async function text(handler: { execute: (p: { rawParams: unknown; context: InstructionContext }) => Promise<{ content: { text?: string }[] }> }, rawParams: unknown) {
  const result = await handler.execute({ rawParams, context });
  return result.content.map((c) => c.text ?? "").join("\n");
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "draft-scope-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
  context = { reader: new MarkdownReader(docsDir), config };
  process.env.IIMCP_LINT_MAX_LINES = "20";
});

afterEach(async () => {
  delete process.env.IIMCP_LINT_MAX_LINES;
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("lint", () => {
  it("reports a draft's own rules, naming it by the id every other action takes", async () => {
    await write({ id: `${DRAFT_DIR}__too-long`, body: longBody });

    const report = await text(lint, { action: "lint" });

    expect(report).toContain("document-too-large");
    expect(report).toContain("too-long (draft)");
    // Not the id the file is stored under: nothing else accepts that.
    expect(report).not.toContain(`${DRAFT_DIR}__too-long`);
  });

  it("does not hold a draft to rules only the corpus can answer", async () => {
    // A draft is usually a near-copy of the document it will replace, so the
    // similarity rule fires on almost every one -- against an id nothing
    // accepts, about a resemblance that is the point rather than a problem.
    //
    // `similar-documents`, not `orphaned-document`: the orphan rule already
    // skips any id starting with `_`, so it could never have reported a draft
    // and asserting on it proves nothing about the split.
    await write({ id: "widgets", body: "# Widgets\n\nThe promoted one." });
    await write({ id: `${DRAFT_DIR}__widgets`, body: "# Widgets\n\nThe draft that will replace it." });

    const report = await text(lint, { action: "lint" });

    // The promoted one is legitimately an orphan here; what must not appear is
    // a corpus rule aimed at the draft.
    expect(report).not.toContain("similar-documents");
    expect(report).not.toContain("(draft)");
  });

  it("still reports similarity between two promoted documents", async () => {
    // The other half: the split must not have turned the rule off.
    await write({ id: "widget-handling", body: "# One" });
    await write({ id: "widget-handling-notes", body: "# Two" });

    expect(await text(lint, { action: "lint" })).toContain("similar-documents");
  });

  it("does not let a draft into a cycle report", async () => {
    await write({
      id: `${DRAFT_DIR}__a`,
      body: "# A",
      frontmatter: "description: A\nwhenToUse:\n  - testing\nrelatedDocs:\n  - b",
    });
    await write({
      id: "b",
      body: "# B",
      frontmatter: "description: B\nwhenToUse:\n  - testing\nrelatedDocs:\n  - a",
    });

    expect(await text(lint, { action: "lint" })).not.toContain("circular-reference");
  });

  it("still holds a promoted document to both", async () => {
    await write({ id: "promoted", body: longBody });

    const report = await text(lint, { action: "lint" });

    expect(report).toContain("document-too-large");
    expect(report).toContain("orphaned-document");
  });

  it("says nothing about the trash, which is not a document any more", async () => {
    await write({ id: "_mcp_trash__discarded", body: longBody, frontmatter: "description: ''" });

    expect(await text(lint, { action: "lint" })).toContain("No issues found");
  });
});

describe("list", () => {
  it("leaves drafts out of the ordinary listing", async () => {
    await write({ id: `${DRAFT_DIR}__in-progress`, body: "# WIP" });
    await write({ id: "finished", body: "# Done" });

    const listing = await text(list, { action: "list", recursive: true });

    expect(listing).toContain("finished");
    expect(listing).not.toContain("in-progress");
  });

  it("lists drafts when asked, by their plain id", async () => {
    await write({ id: `${DRAFT_DIR}__one`, body: "# One" });
    await write({ id: `${DRAFT_DIR}__two`, body: "# Two" });
    await write({ id: "finished", body: "# Done" });

    const listing = await text(list, { action: "list", drafts: true });

    expect(listing).toContain("2 draft(s)");
    expect(listing).toContain("one");
    expect(listing).toContain("two");
    expect(listing).not.toContain("finished");
    expect(listing).not.toContain(DRAFT_DIR);
  });

  it("offers the self-review a fresh draft needs, not a batch that would be refused", async () => {
    // `approve(ids:)` refuses unless every draft in the batch has had its
    // self-review recorded, so offering it for drafts straight out of `add` --
    // the commonest case, and the one this listing exists for -- would hand
    // back a call the server rejects.
    await write({ id: `${DRAFT_DIR}__one`, body: "# One" });
    await write({ id: `${DRAFT_DIR}__two`, body: "# Two" });

    const listing = await text(list, { action: "list", drafts: true });

    expect(listing).toContain("Awaiting self-review: one, two");
    expect(listing).toContain('action: "approve", id: "one", notes:');
    expect(listing).not.toContain("ids:");
  });

  it("hands back the batch once the drafts are ready for it", async () => {
    // The hole this closes: both `approve` and `set_status` take a batch of
    // ids, and no call produced one.
    await write({ id: `${DRAFT_DIR}__one`, body: "# One" });
    await write({ id: `${DRAFT_DIR}__two`, body: "# Two" });
    for (const id of ["one", "two"]) {
      await draftWorkflowManager.trigger({ id, triggerParams: { action: "submit", content: "x" } });
      await draftWorkflowManager.trigger({ id, triggerParams: { action: "review_complete", notes: "reviewed" } });
    }

    expect(await text(list, { action: "list", drafts: true })).toContain('ids: "one,two"');
  });

  it.each([
    { name: "a category", args: { id: "cat" } },
    { name: "a search", args: { query: "anything" } },
    { name: "a metadata filter", args: { missingMeta: "any" } },
    { name: "backlinks", args: { id: "x", backlinks: true } },
  ])("refuses to combine the draft listing with $name", async ({ args }) => {
    // These used to reshape the other branches on the way past them:
    // `list(drafts: true, id: "cat")` answered "no documents" about a category
    // that had drafts in it. A wrong answer is worse than a refused one.
    await write({ id: `${DRAFT_DIR}__cat__beta`, body: "# Beta" });

    const answer = await text(list, { action: "list", drafts: true, ...args });

    expect(answer).toContain("takes no other filter");
  });

  it("says so when there are none", async () => {
    await write({ id: "finished", body: "# Done" });

    expect(await text(list, { action: "list", drafts: true })).toContain("No drafts.");
  });
});

describe("graph", () => {
  it("tells a caller its draft is out of scope, not that it is missing", async () => {
    // "not found" sends them back to check an id that was right.
    await write({ id: `${DRAFT_DIR}__pending`, body: "# Pending" });

    const answer = await text(graph, { action: "graph", id: "pending" });

    expect(answer).toContain("is a draft");
    expect(answer).not.toContain("not found");
  });

  it("still says not found for an id that is nowhere", async () => {
    expect(await text(graph, { action: "graph", id: "nowhere" })).toContain("not found");
  });
});
