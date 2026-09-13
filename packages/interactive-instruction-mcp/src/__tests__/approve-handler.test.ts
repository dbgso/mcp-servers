/**
 * ApproveHandler Unit Tests
 *
 * Tests for batch approval functionality and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MarkdownReader } from "../services/markdown-reader.js";
import type { ReminderConfig, InstructionContext } from "../types/index.js";
import { DRAFT_DIR } from "../constants.js";
import { ApproveHandler } from "../tools/instruction/handlers/approve.js";
import { AddHandler } from "../tools/instruction/handlers/add.js";
import { draftWorkflowManager } from "../workflows/draft-workflow.js";

import { resetMutationGatesForTesting } from "../services/mutation-gate.js";
import { isRefusal, throughGate } from "./helpers/gate.js";

/**
 * One explanation, reused. It is part of the run key, so a test that wants a
 * second attempt to count as a repeat has to pass the same string -- which is
 * the property being relied on, not an incidental detail of the harness.
 */
const EXPLANATION = "This document records the decision we just discussed.";

const tempBase = path.join(process.cwd(), "src/__tests__/temp-approve");
const docsDir = tempBase;

describe("ApproveHandler", () => {
  let reader: MarkdownReader;
  let context: InstructionContext;
  let approveHandler: ApproveHandler;
  let addHandler: AddHandler;
  let testIds: string[] = [];

  const defaultConfig: ReminderConfig = {
    remindMcp: false,
    remindOrganize: false,
    customReminders: [],
    topicForEveryTask: null,
    infoValidSeconds: 60,
  };

  // Generate unique IDs per test to avoid state conflicts
  const getTestId = (base: string) => {
    const id = `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    testIds.push(id);
    return id;
  };

  beforeEach(async () => {
    testIds = [];
    await fs.mkdir(docsDir, { recursive: true });
    await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });

    reader = new MarkdownReader(docsDir);
    context = { reader, config: defaultConfig };
    approveHandler = new ApproveHandler();
    addHandler = new AddHandler();

    resetMutationGatesForTesting();
  });

  afterEach(async () => {
    // clearAllMocks, not resetAllMocks: the spies must keep wrapping the real
    // implementations between tests.
    vi.clearAllMocks();

    // Remove workflow states for all IDs used in this test. Use delete() (not
    // clear()) so the on-disk persisted state is removed too — otherwise a
    // confirmed draft lingers on disk within the 10s window and pollutes a
    // later test's getRecentlyConfirmedDrafts scan.
    for (const id of testIds) {
      await draftWorkflowManager.delete({ id });
    }

    try {
      await fs.rm(tempBase, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Helper to create a draft and progress it to a specific state.
   */
  /**
   * `pending_approval` is reached through the handler rather than by driving
   * the workflow manager directly, because the handler is what opens the gate
   * run -- and a run opened by one call is what the next call continues.
   */
  async function createDraftAtState(
    id: string,
    state: "editing" | "self_review" | "user_reviewing" | "pending_approval",
    options: { targetId?: string } = {}
  ): Promise<void> {
    // Clear any existing state first
    draftWorkflowManager.clear({ id });

    // Create draft file
    await addHandler.execute({
      rawParams: { action: "add", id, content: `# ${id}\n\nTest content for ${id}.`, description: `Test ${id}`, whenToUse: ["Testing"] },
      context,
    });

    if (state === "editing") return;

    // Progress to self_review
    await draftWorkflowManager.trigger({
      id,
      triggerParams: { action: "submit", content: `# ${id}\n\nTest content.` },
    });

    if (state === "self_review") return;

    // Progress to user_reviewing
    await draftWorkflowManager.trigger({
      id,
      triggerParams: { action: "review_complete", notes: "Reviewed" },
    });

    if (state === "user_reviewing") return;

    // Progress to pending_approval by making the first promotion attempt, the
    // way a caller does -- the gate refuses it, and that refusal is what leaves
    // the draft here. `force` skips the consecutive-approval warning, which is
    // about caller habits and not what these tests are exercising.
    await approveHandler.execute({
      rawParams: { action: "approve", id, explanation: EXPLANATION, force: true, ...options },
      context,
    });
  }

  describe("AddHandler validations", () => {
    it("should require whenToUse for add action", async () => {
      const id = getTestId("test-no-when");
      const result = await addHandler.execute({
        rawParams: { action: "add", id, content: "# Test", description: "Test description" },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Required");
    });

    it("should accept empty whenToUse array (no min constraint)", async () => {
      const id = getTestId("test-empty-when");
      const result = await addHandler.execute({
        rawParams: { action: "add", id, content: "# Test", description: "Test desc", whenToUse: [] },
        context,
      });

      // Schema allows empty array (no .min(1)), so draft is created successfully
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("created successfully");
    });
  });

  describe("Single draft approval", () => {
    it("should require id or ids parameter", async () => {
      const result = await approveHandler.execute({
        rawParams: { action: "approve" },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("id or ids is required");
    });

    it("should require notes in self_review state", async () => {
      const id = getTestId("test-draft-1");
      await createDraftAtState(id, "self_review");

      const result = await approveHandler.execute({
        rawParams: { action: "approve", id },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("notes");
    });

    it("should require an explanation in user_reviewing state", async () => {
      const id = getTestId("test-draft-1");
      await createDraftAtState(id, "user_reviewing");

      const result = await approveHandler.execute({
        rawParams: { action: "approve", id },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("explanation");
    });
  });

  describe("Batch approval with ids parameter", () => {
    it("previews every draft in one refusal", async () => {
      const id1 = getTestId("test-draft-1");
      const id2 = getTestId("test-draft-2");
      const id3 = getTestId("test-draft-3");
      await createDraftAtState(id1, "user_reviewing");
      await createDraftAtState(id2, "user_reviewing");
      await createDraftAtState(id3, "user_reviewing");

      const result = await approveHandler.execute({
        rawParams: { action: "approve", ids: `${id1},${id2},${id3}`, explanation: EXPLANATION },
        context,
      });

      // One run over the whole batch, so one explanation and one refusal -- the
      // caller is not made to account for each document separately.
      expect(isRefusal(result)).toBe(true);
      const text = result.content[0].text as string;
      expect(text).toContain("3 draft(s)");
      for (const id of [id1, id2, id3]) expect(text).toContain(id);

      for (const id of [id1, id2, id3]) {
        expect((await draftWorkflowManager.getStatus({ id }))?.state).toBe("pending_approval");
      }
    });

    it("promotes every draft once the identical call is repeated", async () => {
      const id1 = getTestId("test-draft-1");
      const id2 = getTestId("test-draft-2");
      await createDraftAtState(id1, "user_reviewing");
      await createDraftAtState(id2, "user_reviewing");

      const { response } = await throughGate(() =>
        approveHandler.execute({
          rawParams: { action: "approve", ids: `${id1},${id2}`, explanation: EXPLANATION },
          context,
        })
      );

      expect(response.isError).toBeFalsy();
      expect(response.content[0].text).toContain("promoted");
      expect(await reader.getDocumentContent(id1)).toContain("Test content");
      expect(await reader.getDocumentContent(id2)).toContain("Test content");
    });

    it("does not let a different set of ids continue an open run", async () => {
      const id1 = getTestId("test-draft-1");
      const id2 = getTestId("test-draft-2");
      await createDraftAtState(id1, "user_reviewing");
      await createDraftAtState(id2, "user_reviewing");

      await approveHandler.execute({
        rawParams: { action: "approve", ids: id1, explanation: EXPLANATION },
        context,
      });

      // The ids are in the key, so widening the batch is a new run rather than
      // a second attempt at the one the user was shown.
      const widened = await approveHandler.execute({
        rawParams: { action: "approve", ids: `${id1},${id2}`, explanation: EXPLANATION },
        context,
      });

      expect(isRefusal(widened)).toBe(true);
      expect(await reader.getDocumentContent(id1)).toBeNull();
      expect(await reader.getDocumentContent(id2)).toBeNull();
    });

    it("asks for an explanation before touching anything", async () => {
      const id1 = getTestId("test-draft-1");
      await createDraftAtState(id1, "user_reviewing");

      const result = await approveHandler.execute({
        rawParams: { action: "approve", ids: id1 },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("explanation");
      expect((await draftWorkflowManager.getStatus({ id: id1 }))?.state).toBe("user_reviewing");
    });

    it("returns an error when a draft has not been reviewed", async () => {
      const id1 = getTestId("test-draft-1");
      const id2 = getTestId("test-draft-2");
      await createDraftAtState(id1, "user_reviewing");
      await createDraftAtState(id2, "self_review"); // Wrong state

      const result = await approveHandler.execute({
        rawParams: { action: "approve", ids: `${id1},${id2}`, explanation: EXPLANATION },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(id2);
      expect(result.content[0].text).toContain("self_review");
    });

    it("handles a draft file that vanished mid-batch", async () => {
      const id1 = getTestId("test-draft-1");
      const id2 = getTestId("test-draft-2");
      await createDraftAtState(id1, "pending_approval");
      await createDraftAtState(id2, "pending_approval");

      await fs.rm(path.join(docsDir, DRAFT_DIR, `${id2}.md`));
      reader.invalidateCache();

      const result = await approveHandler.execute({
        rawParams: { action: "approve", ids: `${id1},${id2}`, explanation: EXPLANATION },
        context,
      });

      // A missing draft changes the batch `what`, so this is a fresh run rather
      // than the one opened when both drafts were there.
      expect(isRefusal(result) || result.isError === true).toBe(true);
    });
  });

  describe("Error handling", () => {
    it("should return isError: true for empty ids", async () => {
      const result = await approveHandler.execute({
        rawParams: { action: "approve", ids: "   ,  , " },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No valid IDs");
    });

    it("reports a failed rename in a batch without claiming success", async () => {
      const id1 = getTestId("test-draft-1");
      await createDraftAtState(id1, "pending_approval");

      const call = () =>
        approveHandler.execute({
          rawParams: { action: "approve", ids: id1, explanation: EXPLANATION },
          context,
        });

      let response = await call();
      while (isRefusal(response)) {
        const renameSpy = vi
          .spyOn(reader, "renameDocument")
          .mockResolvedValueOnce({ success: false, error: "Batch rename error" });
        response = await call();
        renameSpy.mockRestore();
      }

      // A batch that promoted nothing is a failure, not a report. It used to
      // come back as a success whose body happened to mention the error.
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Batch rename error");
    });
  });

  describe("Single draft promotion", () => {
    it("refuses to promote a draft that has not been reviewed", async () => {
      const id = getTestId("test-draft-1");
      await createDraftAtState(id, "self_review");

      const result = await approveHandler.execute({
        rawParams: { action: "approve", id, explanation: EXPLANATION },
        context,
      });

      // self_review wants notes first; the explanation does not skip it.
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("notes");
      expect(await reader.getDocumentContent(id)).toBeNull();
    });

    it("promotes on the repeat", async () => {
      const id = getTestId("test-draft-1");
      await createDraftAtState(id, "pending_approval");

      const { response, attempts } = await throughGate(() =>
        approveHandler.execute({
          rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
          context,
        })
      );

      expect(response.isError).toBeFalsy();
      expect(response.content[0].text).toContain("promoted");
      expect(attempts).toBeGreaterThanOrEqual(1);
      expect(await reader.getDocumentContent(id)).toContain("Test content");
      // The draft is gone, not copied.
      const draftGone = await fs
        .access(path.join(docsDir, DRAFT_DIR, `${id}.md`))
        .then(() => false)
        .catch(() => true);
      expect(draftGone).toBe(true);
    });

    it("promotes onto a different id when targetId is given", async () => {
      const id = getTestId("test-draft-1");
      const targetId = getTestId("custom-target");
      await createDraftAtState(id, "pending_approval", { targetId });

      const { response } = await throughGate(() =>
        approveHandler.execute({
          rawParams: { action: "approve", id, targetId, explanation: EXPLANATION, force: true },
          context,
        })
      );

      expect(response.isError).toBeFalsy();
      expect(await reader.getDocumentContent(targetId)).toContain("Test content");
    });

    it("returns an error when the draft file is gone", async () => {
      const id = getTestId("test-draft-1");
      await createDraftAtState(id, "pending_approval");

      await fs.rm(path.join(docsDir, DRAFT_DIR, `${id}.md`));
      reader.invalidateCache();

      const result = await approveHandler.execute({
        rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("leaves the draft alone when the write fails", async () => {
      const id = getTestId("test-draft-1");
      await createDraftAtState(id, "pending_approval");

      const call = () =>
        approveHandler.execute({
          rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
          context,
        });

      // The spy goes in before every attempt, since the one that reaches the
      // write is the one that has to fail -- and which attempt that is depends
      // on the configured count, not on this test.
      let response;
      do {
        const renameSpy = vi
          .spyOn(reader, "renameDocument")
          .mockResolvedValue({ success: false, error: "Filesystem error: permission denied" });
        response = await call();
        renameSpy.mockRestore();
      } while (isRefusal(response));

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Filesystem error: permission denied");
      const draftStillThere = await fs
        .access(path.join(docsDir, DRAFT_DIR, `${id}.md`))
        .then(() => true)
        .catch(() => false);
      expect(draftStillThere).toBe(true);
    });
  });

  describe("Single draft workflow (handleApprovalRequest)", () => {
    it("should transition from self_review to user_reviewing with notes", async () => {
      const id = getTestId("test-draft-1");
      await createDraftAtState(id, "self_review");

      const result = await approveHandler.execute({
        rawParams: { action: "approve", id, notes: "Self-review complete" },
        context,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("user_reviewing");

      const status = await draftWorkflowManager.getStatus({ id });
      expect(status?.state).toBe("user_reviewing");
    });

    it("should transition from user_reviewing to pending_approval on the first attempt", async () => {
      const id = getTestId("test-draft-1");
      await createDraftAtState(id, "user_reviewing");

      const result = await approveHandler.execute({
        rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
        context,
      });

      expect(isRefusal(result)).toBe(true);

      const status = await draftWorkflowManager.getStatus({ id });
      expect(status?.state).toBe("pending_approval");
    });

    it("starts the review for a draft that has no workflow state yet", async () => {
      const id = getTestId("test-draft-no-workflow");

      // Create draft file directly without triggering workflow
      await fs.writeFile(
        path.join(docsDir, DRAFT_DIR, `${id}.md`),
        `# ${id}\n\nTest content.`,
        "utf-8"
      );

      // Don't initialize any workflow state - so currentState will be "editing" (default)
      const result = await approveHandler.execute({
        rawParams: { action: "approve", id },
        context,
      });

      // `editing` used to fall through to "Unexpected State", which left any
      // draft reset back to it permanently stuck. It now submits the draft's
      // current content and asks for the self-review notes.
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("self_review");
      expect(result.content[0].text).toContain("notes");
    });

    it("should generate CREATE summary for new documents", async () => {
      const id = getTestId("test-draft-create");
      await createDraftAtState(id, "user_reviewing");

      const result = await approveHandler.execute({
        rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
        context,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("New Document");
      expect(result.content[0].text).toContain("CREATE");
    });

    it("should generate UPDATE diff for existing documents", async () => {
      const id = getTestId("test-draft-update");

      // Create existing target document
      await fs.writeFile(
        path.join(docsDir, `${id}.md`),
        "# Old Content\n\nThis is old.",
        "utf-8"
      );

      await createDraftAtState(id, "user_reviewing");

      const result = await approveHandler.execute({
        rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
        context,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Update");
      expect(result.content[0].text).toContain("UPDATE");
    });

    it("should generate UPDATE diff with context lines", async () => {
      const id = getTestId("test-draft-context");

      // Create existing target document with multiple lines
      await fs.writeFile(
        path.join(docsDir, `${id}.md`),
        "# Title\n\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5",
        "utf-8"
      );

      // Create draft with changes in the middle
      draftWorkflowManager.clear({ id });
      await addHandler.execute({
        rawParams: {
          action: "add",
          id,
          content: "# Title\n\nLine 1\nChanged Line 2\nLine 3\nChanged Line 4\nLine 5",
          description: "Test diff",
          whenToUse: ["Testing"],
        },
        context,
      });

      // Progress to user_reviewing
      await draftWorkflowManager.trigger({
        id,
        triggerParams: { action: "review_complete", notes: "Reviewed" },
      });

      const result = await approveHandler.execute({
        rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
        context,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Update");
      expect(result.content[0].text).toContain("diff");
    });

    it("should generate UPDATE diff showing removed lines", async () => {
      const id = getTestId("test-draft-removed");

      // Create existing target document with MORE lines than the draft
      await fs.writeFile(
        path.join(docsDir, `${id}.md`),
        "# Title\n\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6",
        "utf-8"
      );

      // Create draft with FEWER lines (simulating removal)
      draftWorkflowManager.clear({ id });
      await addHandler.execute({
        rawParams: {
          action: "add",
          id,
          content: "# Title\n\nLine 1\nLine 2",
          description: "Test removed lines",
          whenToUse: ["Testing"],
        },
        context,
      });

      // Progress to user_reviewing
      await draftWorkflowManager.trigger({
        id,
        triggerParams: { action: "review_complete", notes: "Reviewed" },
      });

      const result = await approveHandler.execute({
        rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
        context,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Update");
      // Should show removed lines with "-" prefix
      expect(result.content[0].text).toContain("-");
    });

    it("should generate UPDATE diff showing added lines", async () => {
      const id = getTestId("test-draft-added");

      // Create existing target document with FEWER lines than the draft
      await fs.writeFile(
        path.join(docsDir, `${id}.md`),
        "# Title\n\nLine 1",
        "utf-8"
      );

      // Create draft with MORE lines (simulating addition)
      draftWorkflowManager.clear({ id });
      await addHandler.execute({
        rawParams: {
          action: "add",
          id,
          content: "# Title\n\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5",
          description: "Test added lines",
          whenToUse: ["Testing"],
        },
        context,
      });

      // Progress to user_reviewing
      await draftWorkflowManager.trigger({
        id,
        triggerParams: { action: "review_complete", notes: "Reviewed" },
      });

      const result = await approveHandler.execute({
        rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
        context,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Update");
      // Should show added lines with "+" prefix
      expect(result.content[0].text).toContain("+");
    });
  });

  describe("Recently confirmed drafts detection", () => {
    it("should detect recently confirmed drafts and suggest batch approval", async () => {
      const id1 = getTestId("test-draft-1");
      const id2 = getTestId("test-draft-2");

      // Create first draft and confirm it (sets confirmedAt)
      await createDraftAtState(id1, "pending_approval");

      // Create second draft at user_reviewing
      await createDraftAtState(id2, "user_reviewing");

      // Try to confirm second draft without force
      // Should detect id1 as recently confirmed and return warning
      const result = await approveHandler.execute({
        rawParams: { action: "approve", id: id2, explanation: EXPLANATION },
        context,
      });

      // Warning is returned as isError: true, and what it suggests is
      // promoting them together under one explanation.
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Consecutive");
      expect(result.content[0].text).toContain("ids:");
    });

    it("should skip recently confirmed check with force: true", async () => {
      const id1 = getTestId("test-draft-1");
      const id2 = getTestId("test-draft-2");

      // Create first draft and confirm it
      await createDraftAtState(id1, "pending_approval");

      // Create second draft at user_reviewing
      await createDraftAtState(id2, "user_reviewing");

      // Confirm with force: true
      const result = await approveHandler.execute({
        rawParams: { action: "approve", id: id2, explanation: EXPLANATION, force: true },
        context,
      });

      expect(result.isError).toBeFalsy();
      // Should not mention batch, should proceed with approval
      expect(isRefusal(result)).toBe(true);
    });
  });

  describe("Workflow state transition loop bug", () => {
    /**
     * Bug reproduction test:
     * 1. approve with notes → should transition to user_reviewing
     * 2. approve with an explanation → should transition to pending_approval
     *
     * Reported issue:
     * - approve with notes returns to self_review
     * - an explanation alone says notes are required
     * This creates an infinite loop.
     */
    it("should complete full workflow: self_review → user_reviewing → pending_approval", async () => {
      const id = getTestId("test-workflow-loop");

      // Step 1: Create draft (goes to self_review automatically)
      await addHandler.execute({
        rawParams: {
          action: "add",
          id,
          content: `# ${id}\n\nTest content.`,
          description: "Test workflow",
          whenToUse: ["Testing workflow"],
        },
        context,
      });

      // Verify initial state is self_review
      const status1 = await draftWorkflowManager.getStatus({ id });
      expect(status1?.state).toBe("self_review");

      // Step 2: Approve with notes → should go to user_reviewing
      const result2 = await approveHandler.execute({
        rawParams: { action: "approve", id, notes: "Self-review: content looks good" },
        context,
      });

      expect(result2.isError).toBeFalsy();
      const status2 = await draftWorkflowManager.getStatus({ id });
      expect(status2?.state).toBe("user_reviewing");

      // Step 3: first promotion attempt → refused, and left at pending_approval
      const result3 = await approveHandler.execute({
        rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
        context,
      });

      expect(result3.isError).toBeFalsy();
      const status3 = await draftWorkflowManager.getStatus({ id });
      expect(status3?.state).toBe("pending_approval");
    });

    it("should NOT require notes when in user_reviewing state", async () => {
      const id = getTestId("test-no-notes-needed");

      // Create draft and progress to user_reviewing
      await addHandler.execute({
        rawParams: {
          action: "add",
          id,
          content: `# ${id}\n\nTest content.`,
          description: "Test no notes",
          whenToUse: ["Testing"],
        },
        context,
      });

      // Progress through self_review
      await approveHandler.execute({
        rawParams: { action: "approve", id, notes: "Self-review done" },
        context,
      });

      // Verify we're in user_reviewing
      const status = await draftWorkflowManager.getStatus({ id });
      expect(status?.state).toBe("user_reviewing");

      // Now promote (no notes) - should NOT ask for notes again
      const result = await approveHandler.execute({
        rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
        context,
      });

      // Should succeed, not ask for notes (i.e., not require notes to proceed)
      expect(result.isError).toBeFalsy();
      // Should NOT say "must provide notes" or similar error
      expect(result.content[0].text).not.toContain("must provide");
      expect(result.content[0].text).not.toContain("notes is required");
      expect(isRefusal(result)).toBe(true);
    });

    it("should NOT return to self_review after providing notes", async () => {
      const id = getTestId("test-no-return-self-review");

      // Create draft
      await addHandler.execute({
        rawParams: {
          action: "add",
          id,
          content: `# ${id}\n\nContent.`,
          description: "Test no return",
          whenToUse: ["Testing"],
        },
        context,
      });

      // Approve with notes
      const result = await approveHandler.execute({
        rawParams: { action: "approve", id, notes: "Self-review complete" },
        context,
      });

      // Should NOT be in self_review anymore
      const status = await draftWorkflowManager.getStatus({ id });
      expect(status?.state).not.toBe("self_review");
      expect(status?.state).toBe("user_reviewing");

      // Response should indicate transition to user_reviewing
      expect(result.content[0].text).toContain("user_reviewing");
    });

    it("should update frontmatter status to user_reviewing after notes transition", async () => {
      const id = getTestId("test-frontmatter-status");

      // Create draft
      await addHandler.execute({
        rawParams: {
          action: "add",
          id,
          content: `# ${id}\n\nContent.`,
          description: "Test frontmatter",
          whenToUse: ["Testing"],
        },
        context,
      });

      // Approve with notes
      await approveHandler.execute({
        rawParams: { action: "approve", id, notes: "Self-review complete" },
        context,
      });

      // Check frontmatter status in the draft file
      const draftContent = await reader.getDocumentContent(`_mcp_drafts__${id}`);
      expect(draftContent).not.toBeNull();
      // Frontmatter should have status: user_reviewing (not self_review!)
      expect(draftContent).toContain("status: user_reviewing");
    });

    it("should persist workflow state across getStatus calls", async () => {
      const id = getTestId("test-persist-state");

      // Create draft
      await addHandler.execute({
        rawParams: {
          action: "add",
          id,
          content: `# ${id}\n\nContent.`,
          description: "Test persist",
          whenToUse: ["Testing"],
        },
        context,
      });

      // Transition to user_reviewing
      await approveHandler.execute({
        rawParams: { action: "approve", id, notes: "Self-review complete" },
        context,
      });

      // Clear the in-memory cache to force reload from disk
      draftWorkflowManager.clear({ id });

      // Re-fetch status (should reload from persisted file)
      const status = await draftWorkflowManager.getStatus({ id });
      expect(status?.state).toBe("user_reviewing");
    });

    it("should handle multiple approve calls without regression", async () => {
      const id = getTestId("test-multiple-calls");

      // Create draft
      await addHandler.execute({
        rawParams: {
          action: "add",
          id,
          content: `# ${id}\n\nContent.`,
          description: "Test multiple",
          whenToUse: ["Testing"],
        },
        context,
      });

      // First approve with notes → should go to user_reviewing
      const result1 = await approveHandler.execute({
        rawParams: { action: "approve", id, notes: "First review" },
        context,
      });
      expect(result1.isError).toBeFalsy();

      const status1 = await draftWorkflowManager.getStatus({ id });
      expect(status1?.state).toBe("user_reviewing");

      // Second approve with notes (already in user_reviewing, should error or handle gracefully)
      const result2 = await approveHandler.execute({
        rawParams: { action: "approve", id, notes: "Second review" },
        context,
      });
      // In user_reviewing, notes are not expected - it asks for the
      // explanation the user was given.
      expect(result2.isError).toBe(true);
      expect(result2.content[0].text).toContain("explanation");

      // State should still be user_reviewing
      const status2 = await draftWorkflowManager.getStatus({ id });
      expect(status2?.state).toBe("user_reviewing");
    });

    it("should batch confirm multiple drafts after individual notes via approveHandler", async () => {
      const id1 = getTestId("test-batch-via-handler-1");
      const id2 = getTestId("test-batch-via-handler-2");
      const id3 = getTestId("test-batch-via-handler-3");

      // Create 3 drafts
      for (const id of [id1, id2, id3]) {
        await addHandler.execute({
          rawParams: {
            action: "add",
            id,
            content: `# ${id}\n\nContent for ${id}.`,
            description: `Test ${id}`,
            whenToUse: ["Testing batch"],
          },
          context,
        });
      }

      // Progress each draft to user_reviewing via approveHandler (not direct trigger)
      for (const id of [id1, id2, id3]) {
        const result = await approveHandler.execute({
          rawParams: { action: "approve", id, notes: `Self-review for ${id}` },
          context,
        });
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("user_reviewing");
      }

      // Verify all are in user_reviewing state
      for (const id of [id1, id2, id3]) {
        const status = await draftWorkflowManager.getStatus({ id });
        expect(status?.state).toBe("user_reviewing");
      }

      // Now batch confirm
      const batchResult = await approveHandler.execute({
        rawParams: { action: "approve", ids: `${id1},${id2},${id3}`, explanation: EXPLANATION },
        context,
      });

      expect(batchResult.isError).toBeFalsy();
      expect(isRefusal(batchResult)).toBe(true);
      expect(batchResult.content[0].text).toContain("3 draft(s)");

      // Verify all transitioned to pending_approval
      for (const id of [id1, id2, id3]) {
        const status = await draftWorkflowManager.getStatus({ id });
        expect(status?.state).toBe("pending_approval");
      }
    });
  });

  describe("Diff generation branch coverage", () => {
    it("should show context lines after changed lines (line 370 branch)", async () => {
      const id = getTestId("test-diff-context-after");

      // Create original with consistent structure
      const originalContent = `---
description: Original doc
whenToUse:
  - Testing
---

# Title

Line A
Line B
Line C`;

      // Create draft with change in middle - Line B changed
      const draftContent = `---
description: Original doc
whenToUse:
  - Testing
---

# Title

Line A
CHANGED Line B
Line C`;

      // Write original document
      await fs.writeFile(path.join(docsDir, `${id}.md`), originalContent, "utf-8");

      // Write draft directly (bypassing addHandler to control content exactly)
      await fs.writeFile(path.join(docsDir, DRAFT_DIR, `${id}.md`), draftContent, "utf-8");

      // Initialize workflow at user_reviewing
      draftWorkflowManager.clear({ id });
      await draftWorkflowManager.trigger({ id, triggerParams: { action: "submit", content: draftContent } });
      await draftWorkflowManager.trigger({ id, triggerParams: { action: "review_complete", notes: "Reviewed" } });

      const result = await approveHandler.execute({
        rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
        context,
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("Update");
      // Line C should appear as context after the change
      expect(text).toContain("Line C");
    });

    it("should show context lines before changed lines (line 372 branch)", async () => {
      const id = getTestId("test-diff-context-before");

      // Create original - Line A is unchanged, Line B is changed
      const originalContent = `---
description: Test doc
whenToUse:
  - Testing
---

# Title

Unchanged Line
Line to change`;

      // Create draft with change at the end
      const draftContent = `---
description: Test doc
whenToUse:
  - Testing
---

# Title

Unchanged Line
CHANGED line`;

      // Write original document
      await fs.writeFile(path.join(docsDir, `${id}.md`), originalContent, "utf-8");

      // Write draft directly
      await fs.writeFile(path.join(docsDir, DRAFT_DIR, `${id}.md`), draftContent, "utf-8");

      // Initialize workflow at user_reviewing
      draftWorkflowManager.clear({ id });
      await draftWorkflowManager.trigger({ id, triggerParams: { action: "submit", content: draftContent } });
      await draftWorkflowManager.trigger({ id, triggerParams: { action: "review_complete", notes: "Reviewed" } });

      const result = await approveHandler.execute({
        rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
        context,
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("Update");
      // Should show diff with the changed line
      expect(text).toContain("Line to change");
      expect(text).toContain("CHANGED line");
    });

    it("should show removed lines when new content has fewer lines (line 359 branch)", async () => {
      const id = getTestId("test-diff-removed-lines");

      // Original has extra lines at the end
      const originalContent = `---
description: Test doc
whenToUse:
  - Testing
---

# Title

Line 1
Line 2
Line 3 to be removed
Line 4 to be removed`;

      // Draft has fewer lines
      const draftContent = `---
description: Test doc
whenToUse:
  - Testing
---

# Title

Line 1
Line 2`;

      // Write original document
      await fs.writeFile(path.join(docsDir, `${id}.md`), originalContent, "utf-8");

      // Write draft directly
      await fs.writeFile(path.join(docsDir, DRAFT_DIR, `${id}.md`), draftContent, "utf-8");

      // Initialize workflow at user_reviewing
      draftWorkflowManager.clear({ id });
      await draftWorkflowManager.trigger({ id, triggerParams: { action: "submit", content: draftContent } });
      await draftWorkflowManager.trigger({ id, triggerParams: { action: "review_complete", notes: "Reviewed" } });

      const result = await approveHandler.execute({
        rawParams: { action: "approve", id, explanation: EXPLANATION, force: true },
        context,
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("Update");
      // Should show removed lines in diff
      expect(text).toContain("Line 3 to be removed");
      expect(text).toContain("Line 4 to be removed");
    });
  });
});
