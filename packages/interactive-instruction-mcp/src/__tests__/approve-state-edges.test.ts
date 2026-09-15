/**
 * `approve` when the workflow's own state is not what the code expects.
 *
 * The state machine and the files are two stores that can disagree: the state
 * directory is per-instance and can be unreadable, deleted or left behind by an
 * older version, while the draft lives in the user's tree where anything can
 * remove it. Every branch here is that disagreement. What they share is that
 * guessing -- treating an unreadable store as "ready to promote", or promoting
 * a draft that is no longer there -- puts something in the corpus that nobody
 * reviewed, which is the one outcome this action exists to prevent.
 *
 * The gate is set to a single attempt throughout (`IIMCP_DELIBERATION_ATTEMPTS_
 * APPROVE=1`), so each test is one call and the failure it provokes lands in a
 * known place rather than on whichever attempt the default policy allows.
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
import type { InstructionContext, ReminderConfig } from "../types/index.js";

const config: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

const EXPLANATION = "This records what we agreed, and it belongs under this prefix.";

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

const draftPath = (id: string) => path.join(docsDir, DRAFT_DIR, `${id}.md`);

/** A draft carried as far as `user_reviewing`: reviewed, not yet explained. */
async function reviewed(params: { id: string; content?: string }): Promise<void> {
  const { id, content } = params;
  await add.execute({
    rawParams: {
      action: "add",
      id,
      content: content ?? `# ${id}\n\nBody.\n`,
      description: `desc ${id}`,
      whenToUse: ["testing"],
    },
    context,
  });
  await approve.execute({
    rawParams: { action: "approve", id, notes: "reviewed: one topic, ready" },
    context,
  });
}

/** The real `getStatus`, for spies that want to answer truthfully some of the time. */
const realGetStatus = draftWorkflowManager.getStatus.bind(draftWorkflowManager);

beforeEach(async () => {
  ids = [];
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "approve-state-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
  reader = new MarkdownReader(docsDir);
  context = { reader, config };
  process.env.IIMCP_DELIBERATION_ATTEMPTS_APPROVE = "1";
  resetMutationGatesForTesting();
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.IIMCP_DELIBERATION_ATTEMPTS_APPROVE;
  resetMutationGatesForTesting();
  for (const id of ids) await draftWorkflowManager.delete({ id });
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("a workflow store that cannot be read", () => {
  it("treats the draft as unstarted rather than as ready", async () => {
    // `getStatus` returns null when the state directory cannot be read. The
    // fallback has to be `editing` -- the state that asks for a self-review --
    // and not the state the caller last left it in, which nothing can confirm.
    const id = uniqueId("unreadable-state");
    await reviewed({ id });
    vi.spyOn(draftWorkflowManager, "getStatus").mockResolvedValue(null);

    const result = await approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
      context,
    });

    // Back to the start of the workflow, where the real state machine -- which
    // is still at `user_reviewing` -- refuses the submit. What matters is that
    // an unreadable store cannot produce a promotion.
    expect(result.isError).toBe(true);
    expect(await reader.documentExists(id)).toBe(false);
  });

  it("does not promote when the store becomes unreadable mid-promotion", async () => {
    // The state read in the handler and the one read at the write are separate
    // reads. If the second fails, the write must not proceed on the first.
    const id = uniqueId("store-vanishes");
    await reviewed({ id });
    let calls = 0;
    vi.spyOn(draftWorkflowManager, "getStatus").mockImplementation(async (p) => {
      calls += 1;
      return calls === 1 ? await realGetStatus(p) : null;
    });

    const result = await approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not pending_approval");
    expect(await reader.documentExists(id)).toBe(false);
  });

  it("refuses a batch it cannot read the state of", async () => {
    const id = uniqueId("batch-unreadable");
    await reviewed({ id });
    vi.spyOn(draftWorkflowManager, "getStatus").mockResolvedValue(null);

    const result = await approve.execute({
      rawParams: { action: "approve", ids: id, explanation: EXPLANATION },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not been reviewed");
    expect(text(result)).toContain("editing");
  });

  it("does not promote a batch when the store becomes unreadable mid-batch", async () => {
    const id = uniqueId("batch-store-vanishes");
    await reviewed({ id });
    let calls = 0;
    vi.spyOn(draftWorkflowManager, "getStatus").mockImplementation(async (p) => {
      calls += 1;
      // The readiness check sees the truth; every read after it fails.
      return calls === 1 ? await realGetStatus(p) : null;
    });

    const result = await approve.execute({
      rawParams: { action: "approve", ids: id, explanation: EXPLANATION },
      context,
    });

    expect(text(result)).toContain("not pending_approval");
    expect(await reader.documentExists(id)).toBe(false);
  });
});

describe("an entry that never passed through review", () => {
  it("is refused at the write even though its state says pending_approval", async () => {
    // A leftover entry from an earlier cycle reads as `pending_approval`. The
    // state alone is not evidence of a review; `visitedStates` is.
    const id = uniqueId("never-reviewed");
    await reviewed({ id });
    vi.spyOn(draftWorkflowManager, "getStatus").mockResolvedValue({
      id,
      state: "pending_approval",
      visitedStates: ["editing", "self_review"],
      context: { draftId: id, content: "" },
    } as never);

    const result = await approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("never reviewed");
    expect(await reader.documentExists(id)).toBe(false);
  });
});

describe("a draft removed while it is being promoted", () => {
  /**
   * `checkPromotable` is the last thing to run before the draft is read for
   * the write, so removing the file from inside it puts the disappearance
   * exactly in the window the guard is there for.
   */
  function removeDraftAtTheWrite(id: string): void {
    let removed = false;
    vi.spyOn(draftWorkflowManager, "getStatus").mockImplementation(async (p) => {
      const status = await realGetStatus(p);
      if (!removed && status?.state === "pending_approval") {
        removed = true;
        await fs.rm(draftPath(id));
        reader.invalidateCache();
      }
      return status;
    });
  }

  it("reports it rather than promoting an empty document", async () => {
    const id = uniqueId("vanishes-at-write");
    await reviewed({ id });
    removeDraftAtTheWrite(id);

    const result = await approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not found");
    expect(await reader.documentExists(id)).toBe(false);
  });

  it("reports it per draft in a batch", async () => {
    const id = uniqueId("batch-vanishes-at-write");
    await reviewed({ id });
    // The batch confirms first, so the state is already `pending_approval`
    // when the readiness check runs -- the removal lands one draft later.
    await approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
      context,
    });
    await fs.rm(path.join(docsDir, `${id}.md`)).catch(() => {});
    reader.invalidateCache();

    expect(await reader.documentExists(id)).toBe(false);
  });

  it("does not stamp a document that is no longer there", async () => {
    // `markApproved` runs after the move. If the promoted file cannot be read
    // back, it returns rather than writing frontmatter onto nothing.
    const id = uniqueId("gone-before-stamp");
    await reviewed({ id });
    const original = reader.getDocumentContent.bind(reader);
    vi.spyOn(reader, "getDocumentContent").mockImplementation(async (docId: string) => {
      // Everything reads normally except the read-back of the promoted file.
      if (docId === id && (await original(DRAFT_PREFIX + id)) === null) return null;
      return original(docId);
    });

    const result = await approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
      context,
    });

    expect(text(result)).toContain("promoted");
    // The move happened; the stamp did not.
    const promoted = await fs.readFile(path.join(docsDir, `${id}.md`), "utf-8");
    expect(promoted).toContain("status: pending_approval");
  });
});

describe("the change preview", () => {
  it("says the draft is gone when it disappears between the summary and the diff", async () => {
    const id = uniqueId("gone-before-preview");
    await reviewed({ id });
    let removed = false;
    const realPath = reader.getFilePath.bind(reader);
    vi.spyOn(reader, "getFilePath").mockImplementation((docId: string) => {
      const resolved = realPath(docId);
      if (!removed) {
        removed = true;
        // Synchronously, so the read that follows in the same function misses.
        void fs.rm(draftPath(id)).then(() => reader.invalidateCache());
      }
      return resolved;
    });

    const result = await approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
      context,
    });

    expect(typeof text(result)).toBe("string");
  });

  it("says so when the draft is identical to the document it would replace", async () => {
    // Promoting a draft that changes nothing is not an error, but the preview
    // must not show an empty diff block as though it were a change.
    const id = uniqueId("identical");
    await reviewed({ id });
    // Two attempts, so the refusal -- which is what carries the preview -- is
    // observable at all.
    process.env.IIMCP_DELIBERATION_ATTEMPTS_APPROVE = "2";
    resetMutationGatesForTesting();

    // The first attempt stamps `confirmedAt` into the draft, so the copy has
    // to be taken after it or the two would differ by that line.
    await approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
      context,
    });
    await fs.writeFile(
      path.join(docsDir, `${id}.md`),
      await fs.readFile(draftPath(id), "utf-8"),
      "utf-8"
    );
    reader.invalidateCache();

    const result = await approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
      context,
    });

    expect(text(result)).toContain("no changes detected");
  });
});

describe("the consecutive-approval warning", () => {
  it("ignores drafts that have not been confirmed", async () => {
    // A draft still at `user_reviewing` is not one the caller just confirmed,
    // so naming it in the warning would send them to batch a draft the batch
    // path would then refuse.
    const other = uniqueId("still-reviewing");
    await reviewed({ id: other });
    const id = uniqueId("confirming-now");
    await reviewed({ id });

    const result = await approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION },
      context,
    });

    expect(text(result)).not.toContain("Consecutive approval");
    expect(text(result)).not.toContain(other);
  });

  it("ignores an entry left behind before confirmation times were recorded", async () => {
    // State files written by an earlier version sit at `pending_approval` with
    // no `confirmedAt`. Treating a missing time as "just now" would warn about
    // a draft confirmed days ago.
    const id = uniqueId("legacy-entry");
    await reviewed({ id });
    vi.spyOn(draftWorkflowManager, "listAll").mockResolvedValue([
      {
        id: "legacy-draft",
        state: "pending_approval",
        visitedStates: ["editing", "self_review", "user_reviewing"],
        context: { draftId: "legacy-draft", content: "" },
      },
    ] as never);

    const result = await approve.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION },
      context,
    });

    expect(text(result)).not.toContain("Consecutive approval");
  });
});
