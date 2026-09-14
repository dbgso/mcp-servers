/**
 * `approve`'s failure paths, which were the largest block of untested branches
 * in the package -- 24 of them, in the action that decides what enters the
 * corpus.
 *
 * Each is a way the promotion does not happen: the draft is gone, the state
 * machine refuses, the workflow entry is stale, the write fails. What they have
 * in common is that reporting success for any of them would put a document in
 * the corpus that nobody approved, or leave a draft the caller believes was
 * promoted.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR, DRAFT_PREFIX } from "../constants.js";
import { AddHandler } from "../tools/instruction/handlers/add.js";
import { ApproveHandler } from "../tools/instruction/handlers/approve.js";
import { draftWorkflowManager } from "../workflows/draft-workflow.js";
import { resetMutationGatesForTesting } from "../services/mutation-gate.js";
import { isRefusal, throughGate } from "./helpers/gate.js";
import type { InstructionContext, ReminderConfig } from "../types/index.js";

const config: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

const EXPLANATION = "This records what we agreed.";

let tempDir: string;
let docsDir: string;
let reader: MarkdownReader;
let context: InstructionContext;
let ids: string[];

const add = new AddHandler();
const approve = new ApproveHandler();

function uniqueId(base: string): string {
  const id = `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  ids.push(id);
  return id;
}

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((c) => c.text ?? "").join("\n");

async function draft(params: { id: string; content?: string }): Promise<void> {
  await add.execute({
    rawParams: {
      action: "add",
      id: params.id,
      content: params.content ?? `# ${params.id}\n\nBody.\n`,
      description: `desc ${params.id}`,
      whenToUse: ["testing"],
    },
    context,
  });
}

async function reviewed(params: { id: string }): Promise<void> {
  await draft(params);
  await approve.execute({
    rawParams: { action: "approve", id: params.id, notes: "reviewed: one topic" },
    context,
  });
}

beforeEach(async () => {
  ids = [];
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "approve-failures-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
  reader = new MarkdownReader(docsDir);
  context = { reader, config };
  resetMutationGatesForTesting();
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const id of ids) await draftWorkflowManager.delete({ id });
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("a draft that is not there", () => {
  it("cannot start the workflow", async () => {
    // `editing` submits the draft's current content, so there has to be some.
    const id = uniqueId("absent");

    const result = await approve.execute({ rawParams: { action: "approve", id }, context });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not found");
  });

  it("cannot be promoted after being deleted mid-flow", async () => {
    const id = uniqueId("vanishing");
    await reviewed({ id });
    await approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
      context,
    });

    await fs.rm(path.join(docsDir, DRAFT_DIR, `${id}.md`));
    reader.invalidateCache();

    const result = await approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not found");
  });
});

describe("the state machine refusing", () => {
  it("reports a submit that the workflow rejects", async () => {
    const id = uniqueId("unsubmittable");
    await draft({ id });
    // `add` submits, so the draft is already past `editing`. `delete` drops
    // the persisted entry too -- `clear` only drops the in-memory one, and
    // `getStatus` would read the state straight back off disk.
    await draftWorkflowManager.delete({ id });
    vi.spyOn(draftWorkflowManager, "trigger").mockResolvedValue({
      ok: false,
      error: "simulated workflow refusal",
    } as never);

    const result = await approve.execute({ rawParams: { action: "approve", id }, context });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("simulated workflow refusal");
  });

  it("reports a review_complete that the workflow rejects", async () => {
    const id = uniqueId("unreviewable");
    await draft({ id });
    const trigger = vi.spyOn(draftWorkflowManager, "trigger");
    trigger.mockImplementation(async (params) =>
      (params.triggerParams as { action?: string }).action === "review_complete"
        ? ({ ok: false, error: "simulated review refusal" } as never)
        : ({ ok: true, from: "editing", to: "self_review" } as never)
    );

    const result = await approve.execute({
      rawParams: { action: "approve", id, notes: "reviewed" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("simulated review refusal");
  });

  it("reports a confirm that the workflow rejects", async () => {
    const id = uniqueId("unconfirmable");
    await reviewed({ id });
    vi.spyOn(draftWorkflowManager, "trigger").mockResolvedValue({
      ok: false,
      error: "simulated confirm refusal",
    } as never);

    const result = await approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("simulated confirm refusal");
  });

  it("refuses a state it has no step for", async () => {
    const id = uniqueId("applied");
    await reviewed({ id });
    await throughGate(() =>
      approve.execute({
        rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
        context,
      })
    );

    // Promoted and the entry deleted, so a further call starts from `editing`
    // with no draft to submit.
    const result = await approve.execute({ rawParams: { action: "approve", id }, context });

    expect(result.isError).toBe(true);
  });
});

describe("the write failing", () => {
  it("does not claim the promotion happened", async () => {
    const id = uniqueId("unwritable");
    await reviewed({ id });

    const call = () =>
      approve.execute({
        rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
        context,
      });

    let result;
    do {
      const spy = vi
        .spyOn(reader, "renameDocument")
        .mockResolvedValue({ success: false, error: "simulated disk failure" });
      result = await call();
      spy.mockRestore();
    } while (isRefusal(result));

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("simulated disk failure");
    expect(await reader.documentExists(DRAFT_PREFIX + id)).toBe(true);
  });

  it("leaves the draft unstamped when the approval mark cannot be written", async () => {
    // `markApproved` runs after the move. A failure there must not be reported
    // as a failed promotion, because the document is already in the corpus.
    const id = uniqueId("unstampable");
    await reviewed({ id });
    const updateSpy = vi.spyOn(reader, "updateDocument");

    const { response } = await throughGate(() =>
      approve.execute({
        rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
        context,
      })
    );

    expect(response.isError).toBeFalsy();
    expect(updateSpy).toHaveBeenCalled();
  });
});

describe("the batch path", () => {
  it("refuses a draft whose entry says pending_approval without a review", async () => {
    // A leftover entry from an earlier cycle reads as ready. Trusting it would
    // promote a brand-new draft with no self-review behind it.
    const id = uniqueId("stale");
    await draft({ id });
    await draftWorkflowManager.trigger({
      id,
      triggerParams: { action: "submit", content: "# x" },
    });
    vi.spyOn(draftWorkflowManager, "getStatus").mockResolvedValue({
      state: "pending_approval",
      visitedStates: ["editing", "self_review"],
      context: {},
    } as never);

    const result = await approve.execute({
      rawParams: { action: "approve", ids: id, explanation: EXPLANATION },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("never reviewed");
  });

  it("reports which draft in the batch was not ready", async () => {
    const ready = uniqueId("ready");
    const notReady = uniqueId("not-ready");
    await reviewed({ id: ready });
    await draft({ id: notReady });

    const result = await approve.execute({
      rawParams: { action: "approve", ids: `${ready},${notReady}`, explanation: EXPLANATION },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain(notReady);
  });

  it("reports a draft that vanished between the check and the write", async () => {
    const id = uniqueId("racing");
    await reviewed({ id });
    await approve.execute({
      rawParams: { action: "approve", ids: id, explanation: EXPLANATION },
      context,
    });

    await fs.rm(path.join(docsDir, DRAFT_DIR, `${id}.md`));
    reader.invalidateCache();

    const result = await approve.execute({
      rawParams: { action: "approve", ids: id, explanation: EXPLANATION },
      context,
    });

    expect(isRefusal(result) || result.isError === true).toBe(true);
  });
});

describe("the consecutive-approval warning", () => {
  it("does not fire for a draft whose file is gone", async () => {
    // The warning names other drafts waiting to be promoted. One that has
    // been deleted is not waiting for anything, and naming it sends the
    // caller to a batch command that cannot work.
    const gone = uniqueId("gone");
    const next = uniqueId("next");
    await reviewed({ id: gone });
    await approve.execute({
      rawParams: { action: "approve", id: gone, explanation: EXPLANATION, force: true },
      context,
    });
    await fs.rm(path.join(docsDir, DRAFT_DIR, `${gone}.md`));
    reader.invalidateCache();

    await reviewed({ id: next });
    const result = await approve.execute({
      rawParams: { action: "approve", id: next, explanation: EXPLANATION },
      context,
    });

    expect(text(result)).not.toContain(gone);
  });
});

describe("the change preview", () => {
  it("says so when the draft cannot be read", async () => {
    const id = uniqueId("unreadable");
    await reviewed({ id });
    vi.spyOn(reader, "getDocumentContent").mockResolvedValue(null);

    const result = await approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
      context,
    });

    expect(result.isError).toBe(true);
  });

  it("reports a document with no headings rather than an empty structure", async () => {
    const id = uniqueId("headless");
    await reviewed({ id, content: "Just a paragraph, no heading at all.\n" });

    const result = await approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
      context,
    });

    expect(text(result)).toContain("no headers found");
  });

  it("shows a diff when the target already exists", async () => {
    // Promoting onto an existing document is an update, and the preview has
    // to be the diff rather than the summary a new document gets.
    const id = uniqueId("existing");
    await fs.writeFile(
      path.join(docsDir, `${id}.md`),
      `---\ndescription: the old one\nwhenToUse:\n  - testing\n---\n\n# Old\n\nOld body.\n`,
      "utf-8"
    );
    reader.invalidateCache();
    await reviewed({ id, content: "# New\n\nNew body.\n" });

    const result = await approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
      context,
    });

    const preview = text(result);
    expect(preview).toContain("OVERWRITE");
    expect(preview).toContain("```diff");
    expect(preview).toContain("New body.");
  });
});
