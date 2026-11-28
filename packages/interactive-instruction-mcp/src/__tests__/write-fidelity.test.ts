/**
 * What a write must not change about a document it was not asked to change.
 *
 * Reported as #50 and #51, from a session that wrote eight documents through
 * the MCP and then had to repair all eight by hand:
 *
 * - the trailing newline was stripped on every write path, so a
 *   metadata-only update showed the last line of the body as a -/+ pair in
 *   `git diff` and the file stopped being a POSIX text file
 * - `relatedDocs` written in `add`'s `content` frontmatter was dropped in
 *   silence, losing 11 edges across 7 documents -- invisible until the graph
 *   was drawn, because the prose still read correctly
 * - `status` and `selfReviewNotes`, which exist to run the approval workflow,
 *   were left in the promoted document for every reader to see
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR, DRAFT_PREFIX } from "../constants.js";
import { AddHandler } from "../tools/instruction/handlers/add.js";
import { ApproveHandler } from "../tools/instruction/handlers/approve.js";
import { UpdateHandler } from "../tools/instruction/handlers/update.js";
import { ApplyHandler } from "../tools/instruction/handlers/apply.js";
import { LinkAddHandler } from "../tools/instruction/handlers/link-add.js";
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

const EXPLANATION = "This records the decision we just took.";

let tempDir: string;
let docsDir: string;
let reader: MarkdownReader;
let context: InstructionContext;
let ids: string[];

const add = new AddHandler();
const approve = new ApproveHandler();
const update = new UpdateHandler();
const apply = new ApplyHandler();
const linkAdd = new LinkAddHandler();

function uniqueId(base: string): string {
  const id = `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  ids.push(id);
  return id;
}

/** Read a file as it is on disk, without the reader's normalisation. */
async function raw(id: string): Promise<string> {
  return fs.readFile(path.join(docsDir, `${id}.md`), "utf-8");
}

/** Create a draft and promote it, the way a caller does. */
async function addAndPromote(params: {
  id: string;
  content: string;
  relatedDocs?: string[];
}): Promise<void> {
  const { id, content, relatedDocs } = params;

  await add.execute({
    rawParams: {
      action: "add",
      id,
      content,
      description: `desc ${id}`,
      whenToUse: ["when testing"],
      ...(relatedDocs === undefined ? {} : { relatedDocs }),
    },
    context,
  });
  await approve.execute({
    rawParams: { action: "approve", id, notes: "reviewed: one topic, one claim" },
    context,
  });
  await throughGate(() =>
    approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
      context,
    })
  );
}

beforeEach(async () => {
  ids = [];
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "write-fidelity-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
  reader = new MarkdownReader(docsDir);
  context = { reader, config };
  resetMutationGatesForTesting();
});

afterEach(async () => {
  for (const id of ids) await draftWorkflowManager.delete({ id });
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("the trailing newline survives every write path (#51)", () => {
  const body = "# Title\n\nA paragraph.\n\n- a list item\n";

  it("through add", async () => {
    const id = uniqueId("added");
    await add.execute({
      rawParams: { action: "add", id, content: body, description: "d", whenToUse: ["w"] },
      context,
    });

    expect(await raw(path.join(DRAFT_DIR, id))).toMatch(/\n$/);
  });

  it("through promotion", async () => {
    const id = uniqueId("promoted");
    await addAndPromote({ id, content: body });

    expect(await raw(id)).toMatch(/\n$/);
  });

  it("through update and apply", async () => {
    const id = uniqueId("updated");
    await addAndPromote({ id, content: body });

    await update.execute({
      rawParams: { action: "update", id, content: "# Title\n\nRewritten.\n" },
      context,
    });
    const applied = await throughGate(() =>
      apply.execute({ rawParams: { action: "apply", id, explanation: EXPLANATION }, context })
    );
    expect(applied.response.isError).toBeFalsy();

    expect(await raw(id)).toMatch(/\n$/);
  });

  it("through a metadata-only update, which must not touch the body at all", async () => {
    const id = uniqueId("meta-only");
    await addAndPromote({ id, content: body });
    const before = await raw(id);

    await update.execute({
      rawParams: { action: "update", id, description: "A better description" },
      context,
    });
    await throughGate(() =>
      apply.execute({ rawParams: { action: "apply", id, explanation: EXPLANATION }, context })
    );

    const after = await raw(id);
    // The point of the complaint: the last line of the body showed up in the
    // diff of a change that was only about the frontmatter.
    const bodyOf = (text: string) => text.slice(text.lastIndexOf("\n---\n") + 5);
    expect(bodyOf(after)).toBe(bodyOf(before));
    expect(after).toMatch(/\n$/);
  });

  it("through link_add", async () => {
    const id = uniqueId("linked");
    const other = uniqueId("target");
    await addAndPromote({ id, content: body });
    await addAndPromote({ id: other, content: body });

    resetMutationGatesForTesting();
    const linked = await throughGate(() =>
      linkAdd.execute({
        rawParams: {
          action: "link_add",
          id,
          relatedDocs: [other],
          explanation: "These two belong together.",
        },
        context,
      })
    );
    expect(linked.response.isError).toBeFalsy();

    expect(await raw(id)).toMatch(/\n$/);
  });
});

describe("add keeps the relations written in its content (#50)", () => {
  it("does not drop relatedDocs from the content frontmatter", async () => {
    const target = uniqueId("hub");
    const id = uniqueId("detail");

    const content = [
      "---",
      "description: written in the content",
      "whenToUse:",
      "  - from the content",
      "relatedDocs:",
      `  - ${target}`,
      "---",
      "",
      "# Detail",
      "",
      "Body.",
      "",
    ].join("\n");

    await add.execute({
      rawParams: {
        action: "add",
        id,
        content,
        description: `desc ${id}`,
        whenToUse: ["when testing"],
      },
      context,
    });

    // The prose still reads correctly with the link gone, so nothing about
    // the document itself says it was lost; only the graph does.
    expect(await raw(path.join(DRAFT_DIR, id))).toContain(target);
  });

  it("keeps them through promotion, where the graph is drawn from", async () => {
    const target = uniqueId("hub");
    const id = uniqueId("detail");

    await addAndPromote({
      id,
      content: `---\nrelatedDocs:\n  - ${target}\n---\n\n# Detail\n\nBody.\n`,
    });

    expect(await raw(id)).toContain(target);
  });

  it("prefers the argument when both say something", async () => {
    const fromArgs = uniqueId("from-args");
    const fromContent = uniqueId("from-content");
    const id = uniqueId("detail");

    await add.execute({
      rawParams: {
        action: "add",
        id,
        content: `---\nrelatedDocs:\n  - ${fromContent}\n---\n\n# Detail\n`,
        description: "d",
        whenToUse: ["w"],
        relatedDocs: [fromArgs],
      },
      context,
    });

    const written = await raw(path.join(DRAFT_DIR, id));
    expect(written).toContain(fromArgs);
    expect(written).not.toContain(fromContent);
  });
});

describe("the workflow's own fields stay out of the promoted document (#50)", () => {
  it("leaves no status behind", async () => {
    const id = uniqueId("promoted");
    await addAndPromote({ id, content: "# Title\n\nBody.\n" });

    const written = await raw(id);
    expect(written).not.toContain("status:");
  });

  it("leaves no selfReviewNotes behind", async () => {
    const id = uniqueId("promoted");
    await addAndPromote({ id, content: "# Title\n\nBody.\n" });

    // These are notes the AI wrote for the approval conversation. A reader of
    // the document gets them in `read` for as long as they stay.
    expect(await raw(id)).not.toContain("selfReviewNotes:");
  });

  it("keeps the metadata a reader wants", async () => {
    const id = uniqueId("promoted");
    await addAndPromote({ id, content: "# Title\n\nBody.\n" });

    const written = await raw(id);
    expect(written).toContain(`description: desc ${id}`);
    expect(written).toContain("- when testing");
  });

  it("still records that the draft is mid-workflow", async () => {
    // The status is load-bearing while the document is a draft; it is only
    // the promoted copy that should not carry it.
    const id = uniqueId("drafted");
    await add.execute({
      rawParams: { action: "add", id, content: "# T\n", description: "d", whenToUse: ["w"] },
      context,
    });
    await approve.execute({
      rawParams: { action: "approve", id, notes: "reviewed" },
      context,
    });

    const draft = await reader.getDocumentContent(DRAFT_PREFIX + id);
    expect(draft).toContain("status:");
    expect(draft).toContain("selfReviewNotes:");
  });
});

describe("update accepts the relations it is asked to change (#48)", () => {
  it("does not silently ignore relatedDocs", async () => {
    const id = uniqueId("doc");
    const target = uniqueId("target");
    await addAndPromote({ id, content: "# Title\n\nBody.\n" });
    await addAndPromote({ id: target, content: "# Target\n\nBody.\n" });

    resetMutationGatesForTesting();
    const staged = await update.execute({
      rawParams: {
        action: "update",
        id,
        description: "A better description",
        relatedDocs: [target],
      },
      context,
    });
    expect(staged.isError).toBeFalsy();

    await throughGate(() =>
      apply.execute({ rawParams: { action: "apply", id, explanation: EXPLANATION }, context })
    );

    // Silently dropping an argument is the failure here: the caller is told
    // the update was prepared, and the link is not in it.
    expect(await raw(id)).toContain(target);
  });
});
