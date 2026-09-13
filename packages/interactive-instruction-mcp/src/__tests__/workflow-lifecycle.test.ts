/**
 * What happens to a draft's workflow state once its life is over, and what a
 * leftover entry must not allow.
 *
 * Promotion used to call `clear()`, which drops the in-memory entry and leaves
 * the persisted one saying `pending_approval` with every review state already
 * visited. A later draft reusing that id inherited it, and the batch path --
 * which only checked the state name -- promoted it with no self-review and no
 * explanation to the user.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR, DRAFT_PREFIX } from "../constants.js";
import { ApproveHandler } from "../tools/instruction/handlers/approve.js";
import { AddHandler } from "../tools/instruction/handlers/add.js";
import { draftWorkflowManager } from "../workflows/draft-workflow.js";
import { scopeKey, scopedStateDir } from "../services/instance-scope.js";
import type { InstructionContext, ReminderConfig } from "../types/index.js";

const TOKEN = "valid-token";

const config: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

let tempDir: string;
let docsDir: string;
let reader: MarkdownReader;
let context: InstructionContext;
let ids: string[];

const approve = new ApproveHandler();
const add = new AddHandler();

function uniqueId(base: string): string {
  const id = `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  ids.push(id);
  return id;
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((c) => c.text ?? "").join("\n");
}

async function promote(id: string, content: string): Promise<void> {
  await add.execute({
    rawParams: { action: "add", id, content, description: `desc ${id}`, whenToUse: ["w"] },
    context,
  });
  await approve.execute({ rawParams: { action: "approve", id, notes: "reviewed" }, context });
  await approve.execute({ rawParams: { action: "approve", id, confirmed: true, force: true }, context });
  await approve.execute({ rawParams: { action: "approve", id, approvalToken: TOKEN }, context });
}

beforeEach(async () => {
  ids = [];
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-lifecycle-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
  reader = new MarkdownReader(docsDir);
  context = { reader, config };
});

afterEach(async () => {
  for (const id of ids) {
    await draftWorkflowManager.delete({ id });
  }
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("workflow state after promotion", () => {
  it("is gone, not merely uncached", async () => {
    const id = uniqueId("guide");
    await promote(id, "# Guide\n\nBody.");

    expect(await reader.getDocumentContent(id)).toContain("Guide");
    const status = await draftWorkflowManager.getStatus({ id });
    expect(status?.state).toBe("editing");
  });

  it("does not let a new draft reusing the id skip review via the batch path", async () => {
    const id = uniqueId("guide");
    await promote(id, "# Guide\n\nReviewed properly.");

    // A brand new draft under the same id, straight from `add`.
    await add.execute({
      rawParams: {
        action: "add",
        id,
        content: "# Guide\n\nBRAND NEW UNREVIEWED CONTENT",
        description: "d",
        whenToUse: ["w"],
      },
      context,
    });

    const result = await approve.execute({ rawParams: { action: "approve", ids: id }, context });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Cannot batch approve");
    expect(await reader.getDocumentContent(id)).not.toContain("BRAND NEW UNREVIEWED CONTENT");
  });

  it("refuses a batch for a draft that reached pending_approval without review", async () => {
    const id = uniqueId("unreviewed");
    await add.execute({
      rawParams: { action: "add", id, content: "# X", description: "d", whenToUse: ["w"] },
      context,
    });
    // Drive the state directly, skipping the review transitions the handler
    // would have required.
    await draftWorkflowManager.trigger({ id, triggerParams: { action: "submit", content: "# X" } });

    const result = await approve.execute({ rawParams: { action: "approve", ids: id }, context });

    expect(result.isError).toBe(true);
  });
});

describe("a failed promotion leaves the draft alone", () => {
  it("does not stamp the draft approved when the move fails", async () => {
    const id = uniqueId("halfdone");
    await add.execute({
      rawParams: { action: "add", id, content: "# Half", description: "d", whenToUse: ["w"] },
      context,
    });
    await approve.execute({ rawParams: { action: "approve", id, notes: "reviewed" }, context });
    await approve.execute({ rawParams: { action: "approve", id, confirmed: true, force: true }, context });

    const original = await reader.getDocumentContent(DRAFT_PREFIX + id);

    const renameSpy = vi
      .spyOn(reader, "renameDocument")
      .mockResolvedValueOnce({ success: false, error: "simulated disk failure" });

    const result = await approve.execute({
      rawParams: { action: "approve", id, approvalToken: TOKEN },
      context,
    });

    expect(result.isError).toBe(true);
    expect(await reader.getDocumentContent(DRAFT_PREFIX + id)).toBe(original);
    expect(await reader.getDocumentContent(DRAFT_PREFIX + id)).not.toContain("status: approved");

    renameSpy.mockRestore();
  });
});

describe("the consecutive-approval warning", () => {
  it("does not name drafts that were already applied", async () => {
    const applied = uniqueId("alpha");
    await promote(applied, "# Alpha\n\nBody.");

    const next = uniqueId("beta");
    await add.execute({
      rawParams: { action: "add", id: next, content: "# Beta", description: "d", whenToUse: ["w"] },
      context,
    });
    await approve.execute({ rawParams: { action: "approve", id: next, notes: "reviewed" }, context });

    const result = await approve.execute({
      rawParams: { action: "approve", id: next, confirmed: true },
      context,
    });

    expect(text(result)).not.toContain(applied);
  });
});

describe("state is scoped to the documents directory", () => {
  it("gives two documents directories different stores", () => {
    expect(scopeKey("/projects/a/docs")).not.toBe(scopeKey("/projects/b/docs"));
  });

  it("is stable for the same directory across restarts", () => {
    expect(scopeKey("/projects/a/docs")).toBe(scopeKey("/projects/a/./docs"));
  });

  it("puts each documents directory under its own subdirectory", () => {
    const a = scopedStateDir({ base: "store", docsDir: "/projects/a/docs" });
    const b = scopedStateDir({ base: "store", docsDir: "/projects/b/docs" });
    expect(a).not.toBe(b);
    expect(path.dirname(a)).toBe(path.dirname(b));
  });

  it("honors an explicit override", () => {
    expect(scopedStateDir({ base: "store", docsDir: "/x", override: "/tmp/fixed" })).toBe("/tmp/fixed");
  });
});
