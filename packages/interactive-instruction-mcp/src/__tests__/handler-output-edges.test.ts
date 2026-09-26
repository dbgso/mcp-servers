/**
 * The remaining shapes each handler's output can take.
 *
 * Every case here is one a corpus reaches on an ordinary day -- a document that
 * is not there, a link added to a document that already has some, a code fence
 * with a `#` inside it, a description nobody filled in -- and each decides a
 * line of text the caller relays to the user. They are collected rather than
 * spread through the per-handler files because what they have in common is the
 * output, not the action.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR, DRAFT_PREFIX } from "../constants.js";
import { AddHandler } from "../tools/instruction/handlers/add.js";
import { ReadHandler } from "../tools/instruction/handlers/read.js";
import { GraphHandler } from "../tools/instruction/handlers/graph.js";
import { LintHandler } from "../tools/instruction/handlers/lint.js";
import { UpdateHandler } from "../tools/instruction/handlers/update.js";
import { UpdateMetaHandler } from "../tools/instruction/handlers/update-meta.js";
import { LinkAddHandler } from "../tools/instruction/handlers/link-add.js";
import { LinkRemoveHandler } from "../tools/instruction/handlers/link-remove.js";
import { formatNextActions } from "../tools/instruction/types.js";
import { draftWorkflowManager } from "../workflows/draft-workflow.js";
import { resetMutationGatesForTesting } from "../services/mutation-gate.js";
import { throughGate } from "./helpers/gate.js";
import type { InstructionContext, ReminderConfig } from "../types/index.js";

const config: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

const EXPLANATION = "I told the user what this changes and why.";

let tempDir: string;
let docsDir: string;
let reader: MarkdownReader;
let context: InstructionContext;
let drafts: string[];

const add = new AddHandler();
const read = new ReadHandler();
const graph = new GraphHandler();
const lint = new LintHandler();
const update = new UpdateHandler();
const updateMeta = new UpdateMetaHandler();
const linkAdd = new LinkAddHandler();
const linkRemove = new LinkRemoveHandler();

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((c) => c.text ?? "").join("\n");

async function write(params: { id: string; frontmatter?: string; body?: string }): Promise<void> {
  const { id, frontmatter = `description: about ${id}\n`, body = `# ${id}\n\nBody.\n` } = params;
  const file = path.join(docsDir, `${id.split("__").join(path.sep)}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `---\n${frontmatter}---\n\n${body}`, "utf-8");
  reader.invalidateCache();
}

beforeEach(async () => {
  drafts = [];
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "output-edges-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
  reader = new MarkdownReader(docsDir);
  context = { reader, config };
  resetMutationGatesForTesting();
});

afterEach(async () => {
  vi.restoreAllMocks();
  resetMutationGatesForTesting();
  for (const id of drafts) await draftWorkflowManager.delete({ id });
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("reading", () => {
  it("offers to create the document when there is neither a draft nor a promoted one", async () => {
    const result = await read.execute({ rawParams: { action: "read", id: "absent" }, context });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not found");
    expect(text(result)).toContain('action: "add"');
  });
});

describe("adding a draft", () => {
  it("still reports the draft when the workflow will not record it", async () => {
    // The file is written before the state machine is told. If the state
    // machine refuses, the draft exists and saying otherwise would send the
    // caller to write it again.
    const id = "workflow-refuses";
    drafts.push(id);
    vi.spyOn(draftWorkflowManager, "trigger").mockResolvedValue({
      ok: false,
      error: "simulated refusal",
    } as never);

    const result = await add.execute({
      rawParams: {
        action: "add",
        id,
        content: "# T\n\nBody.\n",
        description: "d",
        whenToUse: ["testing"],
      },
      context,
    });

    expect(text(result)).toContain("created successfully");
    expect(text(result)).not.toContain("**Workflow:**");
    expect(await reader.documentExists(DRAFT_PREFIX + id)).toBe(true);
  });
});

describe("next-action suggestions", () => {
  it("add nothing when there are none", () => {
    expect(formatNextActions([])).toBe("");
  });
});

describe("the graph", () => {
  it("says so when there is nothing to draw at all", async () => {
    const result = await graph.execute({
      rawParams: { action: "graph", format: "text" },
      context,
    });

    expect(text(result)).toContain("No relations to draw");
  });

  it("labels a node with no description by its id alone", async () => {
    // `id — ` with nothing after it reads as a truncated tooltip rather than
    // as a document whose description has not been written.
    await write({
      id: "hub",
      frontmatter: "relatedDocs:\n  - detail\n",
      body: "# Hub\n",
    });
    await write({ id: "detail", frontmatter: "whenToUse:\n  - testing\n", body: "# Detail\n" });
    const outputPath = path.join(tempDir, "graph.html");

    await graph.execute({
      rawParams: { action: "graph", format: "html", outputPath },
      context,
    });

    const html = await fs.readFile(outputPath, "utf-8");
    expect(html).toContain('"tooltip":"hub"');
    expect(html).not.toContain('"tooltip":"hub — "');
  });
});

describe("lint", () => {
  it("does not read a `#` inside a code fence as a heading", async () => {
    await write({
      id: "fenced",
      body: "# Title\n\n```sh\n# Setup\n```\n\n## Setup\n\nText.\n",
    });

    const result = await lint.execute({ rawParams: { action: "lint" }, context });

    expect(text(result)).not.toContain("duplicate-heading");
  });

  it("reports a cycle once however many times it is reached", async () => {
    // A document listing the same neighbour twice reaches the same cycle
    // twice. Reporting it twice would put the caller on a second fix for a
    // problem they had already been shown.
    await write({ id: "a", frontmatter: "description: a\nrelatedDocs:\n  - b\n" });
    await write({ id: "b", frontmatter: "description: b\nrelatedDocs:\n  - a\n  - a\n" });

    const result = await lint.execute({ rawParams: { action: "lint" }, context });

    const occurrences = text(result).split("Circular reference detected").length - 1;
    expect(occurrences).toBe(1);
  });

  it("skips a document that disappeared after the listing was taken", async () => {
    // The listing is cached for a minute, so a file removed in that window is
    // still in it. Reporting it as empty would name a document that is gone.
    await write({ id: "present", body: "# Present\n\nText.\n" });
    await write({ id: "vanishing", body: "# Vanishing\n\nText.\n" });
    await lint.execute({ rawParams: { action: "lint" }, context });
    // Removed without invalidating: exactly what another process doing the
    // deleting looks like from here.
    await fs.rm(path.join(docsDir, "vanishing.md"));

    const result = await lint.execute({ rawParams: { action: "lint" }, context });

    expect(text(result)).not.toContain("vanishing.md");
  });
});

describe("updating metadata", () => {
  it("writes frontmatter for a whenToUse with no description to go with it", async () => {
    // `hasAnyField` stops at the first field with a value. With no description
    // to find -- the body has no title to infer one from -- the array is what
    // decides that there is metadata at all.
    const id = "when-only";
    drafts.push(id);
    await write({
      id,
      frontmatter: "whenToUse:\n  - testing\n",
      body: "Just a paragraph, with no title to infer from.\n",
    });

    const result = await update.execute({
      rawParams: {
        action: "update",
        id,
        content: "Still just a paragraph, with no title.\n",
        whenToUse: ["a new trigger"],
      },
      context,
    });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("a new trigger");
  });

  it("finds the title after the blank lines a document starts with", async () => {
    // Inference runs only where there is no description to keep, which is a
    // promoted document written by hand rather than through `add`.
    const id = "leading-blanks";
    drafts.push(id);
    await write({ id, frontmatter: "whenToUse:\n  - testing\n" });

    const result = await update.execute({
      rawParams: {
        action: "update",
        id,
        content: "\n\n# Title\n\nThe first paragraph, which becomes the description.\n",
      },
      context,
    });

    expect(text(result)).toContain("The first paragraph");
  });

  it("names a candidate with no description as such", async () => {
    // No description in the frontmatter and no paragraph to fall back on.
    await write({ id: "topic__one", frontmatter: "", body: "# One\n" });
    await write({ id: "topic__two", frontmatter: "", body: "# Two\n" });

    const result = await updateMeta.execute({
      rawParams: { action: "update_meta", id: "topic__one" },
      context,
    });

    expect(text(result)).toContain("(No description)");
  });
});

describe("links on a document that already has some", () => {
  it("shows the current list when adding to it", async () => {
    await write({ id: "hub", frontmatter: "description: h\nrelatedDocs:\n  - first\n" });
    await write({ id: "first" });
    await write({ id: "second" });

    const result = await linkAdd.execute({
      rawParams: {
        action: "link_add",
        id: "hub",
        relatedDocs: ["second"],
        explanation: EXPLANATION,
      },
      context,
    });

    expect(text(result)).toContain("**Current relatedDocs:** first");
    expect(text(result)).toContain("**New relatedDocs:** first, second");
  });

  it("shows what is left when removing one of them", async () => {
    await write({ id: "hub", frontmatter: "description: h\nrelatedDocs:\n  - first\n  - second\n" });
    await write({ id: "first" });
    await write({ id: "second" });

    const call = () =>
      linkRemove.execute({
        rawParams: {
          action: "link_remove",
          id: "hub",
          relatedDocs: ["first"],
          explanation: EXPLANATION,
        },
        context,
      });

    expect(text(await call())).toContain("**New relatedDocs:** second");

    const { response } = await throughGate(call);
    expect(text(response)).toContain("**New relatedDocs:** second");
    expect(await reader.getDocumentContent("hub")).toContain("second");
  });
});
