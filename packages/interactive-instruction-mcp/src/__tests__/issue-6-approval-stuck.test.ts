/**
 * Issue #6: the approval workflow got stuck in `pending_approval`, with the
 * token rejected as expired regardless of timing.
 *
 * Three things contributed: the handler and the workflow engine minted
 * different request ids, the token was validated twice and consumed by the
 * first, and `set_status` did not reset the state machine -- so the draft
 * could not be taken forward or back.
 *
 * Two of those three cannot recur, because there is no request id and no token
 * any more: promotion goes through the deliberation gate. What is still worth
 * testing is the property the issue was actually about -- a draft must never
 * reach a state it cannot leave -- so that is what these tests say now, one per
 * way the old flow got stuck.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { MarkdownReader } from "../services/markdown-reader.js";
import type { ReminderConfig } from "../types/index.js";
import type { InstructionContext } from "../tools/instruction/types.js";
import { DRAFT_DIR } from "../constants.js";

import {
  AddHandler,
  ApproveHandler,
  SetStatusHandler,
} from "../tools/instruction/handlers/index.js";
import { draftWorkflowManager } from "../workflows/draft-workflow.js";
import { resetMutationGatesForTesting } from "../services/mutation-gate.js";
import { isRefusal, throughGate } from "./helpers/gate.js";

const tempBase = path.join(process.cwd(), "src/__tests__/temp-issue6");
const docsDir = tempBase;

// Persist dir used by draftWorkflowManager
const PERSIST_DIR =
  process.env.MCP_DRAFT_PERSIST_DIR ?? path.join(os.tmpdir(), "mcp-draft-workflows");

describe("Issue #6: a draft must not reach a state it cannot leave", () => {
  let reader: MarkdownReader;
  let context: InstructionContext;
  let addHandler: AddHandler;
  let approveHandler: ApproveHandler;
  let setStatusHandler: SetStatusHandler;

  const defaultConfig: ReminderConfig = {
    remindMcp: false,
    remindOrganize: false,
    customReminders: [],
    topicForEveryTask: null,
    infoValidSeconds: 60,
  };

  beforeEach(async () => {
    await fs.mkdir(docsDir, { recursive: true });
    await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });

    reader = new MarkdownReader(docsDir);
    context = { reader, config: defaultConfig };

    addHandler = new AddHandler();
    approveHandler = new ApproveHandler();
    setStatusHandler = new SetStatusHandler();

    resetMutationGatesForTesting();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    draftWorkflowManager.clear({ id: "test-doc" });
    // Also clean persisted workflow state to prevent leaking between test cases
    try {
      await fs.rm(PERSIST_DIR, { recursive: true, force: true });
      await fs.mkdir(PERSIST_DIR, { recursive: true });
    } catch {
      // Ignore
    }
    try {
      await fs.rm(tempBase, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Helper: Progress a draft through workflow to a target state.
   */
  async function progressToState(
    id: string,
    targetState: "self_review" | "user_reviewing" | "pending_approval"
  ): Promise<void> {
    draftWorkflowManager.clear({ id });

    await draftWorkflowManager.trigger({
      id,
      triggerParams: { action: "submit", content: `# ${id}\n\nContent.` },
    });
    if (targetState === "self_review") return;

    await draftWorkflowManager.trigger({
      id,
      triggerParams: { action: "review_complete", notes: "LGTM" },
    });
    if (targetState === "user_reviewing") return;

    await draftWorkflowManager.trigger({
      id,
      triggerParams: { action: "confirm", confirmed: true },
    });
  }

  const EXPLANATION = "This records how we handle approvals.";

  async function addDraft(id: string): Promise<void> {
    await addHandler.execute({
      rawParams: {
        action: "add",
        id,
        content: `# ${id}\n\nContent.`,
        description: "Test",
        whenToUse: ["Testing"],
      },
      context,
    });
  }

  describe("the refused attempt leaves a state the next call can use", () => {
    it("promotes on the repeat, from the state the refusal left behind", async () => {
      await addDraft("test-doc");
      await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", notes: "LGTM" },
        context,
      });

      // The gate refuses the first attempt, and that attempt has already moved
      // the draft to pending_approval. If that state had no way forward -- as
      // it did not when the token was rejected -- this is exactly where a draft
      // got stuck.
      const refused = await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", explanation: EXPLANATION, force: true },
        context,
      });
      expect(isRefusal(refused)).toBe(true);
      expect((await draftWorkflowManager.getStatus({ id: "test-doc" }))?.state).toBe("pending_approval");

      const { response } = await throughGate(() =>
        approveHandler.execute({
          rawParams: { action: "approve", id: "test-doc", explanation: EXPLANATION, force: true },
          context,
        })
      );

      expect(response.isError).toBeFalsy();
      expect(await reader.getDocumentContent("test-doc")).toContain("Content.");
    });

    it("says what it wants when a pending_approval draft is called without an explanation", async () => {
      await addDraft("test-doc");
      await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", notes: "LGTM" },
        context,
      });
      await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", explanation: EXPLANATION, force: true },
        context,
      });

      // A bare call in this state used to fall through to "Unexpected State",
      // which told the caller nothing it could act on.
      const result = await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc" },
        context,
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("pending_approval");
      expect(text).toContain("explanation");
    });
  });

  describe("set_status resets the workflow state machine", () => {
    it("set_status resets the workflow, unsticking a draft", async () => {
      await addHandler.execute({
        rawParams: {
          action: "add",
          id: "test-doc",
          content: "# Test\n\nTest content.",
          description: "Test",
          whenToUse: ["Testing"],
        },
        context,
      });

      // Progress to pending_approval via workflow
      await progressToState("test-doc", "pending_approval");

      // Verify workflow manager state
      const statusBefore = await draftWorkflowManager.getStatus({ id: "test-doc" });
      expect(statusBefore?.state).toBe("pending_approval");

      // Declaring an intermediate state is refused: writing one into the
      // frontmatter never advanced anything, because the approve handler goes
      // by the workflow manager. That mismatch is what left a draft stuck with
      // no way back.
      const forward = await setStatusHandler.execute({
        rawParams: { action: "set_status", id: "test-doc", status: "user_reviewing" },
        context,
      });
      expect(forward.isError).toBe(true);

      // A reset is the supported recovery, and it clears the workflow entry too.
      const setStatusResult = await setStatusHandler.execute({
        rawParams: { action: "set_status", id: "test-doc", status: "editing" },
        context,
      });
      expect(setStatusResult.isError).toBeFalsy();

      const statusAfter = await draftWorkflowManager.getStatus({ id: "test-doc" });
      expect(statusAfter?.state).toBe("editing");

      // And the review can be started again from the beginning.
      const retryResult = await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", notes: "reviewed again" },
        context,
      });
      expect(retryResult.isError).toBeFalsy();
    });
  });

  describe("the states nothing could leave", () => {
    it("can always be taken back to editing and started again", async () => {
      await addDraft("test-doc");
      await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", notes: "LGTM" },
        context,
      });
      await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", explanation: EXPLANATION, force: true },
        context,
      });
      expect((await draftWorkflowManager.getStatus({ id: "test-doc" }))?.state).toBe("pending_approval");

      // This is the recovery the issue asked for and did not have.
      const reset = await setStatusHandler.execute({
        rawParams: { action: "set_status", id: "test-doc", status: "editing" },
        context,
      });
      expect(reset.isError).toBeFalsy();
      expect((await draftWorkflowManager.getStatus({ id: "test-doc" }))?.state).toBe("editing");

      const restarted = await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", notes: "reviewed again" },
        context,
      });
      expect(restarted.isError).toBeFalsy();
    });

    it("does not strand the draft when the promotion itself fails", async () => {
      await addDraft("test-doc");
      await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", notes: "LGTM" },
        context,
      });

      const call = () =>
        approveHandler.execute({
          rawParams: { action: "approve", id: "test-doc", explanation: EXPLANATION, force: true },
          context,
        });

      // The spy goes in before every attempt: which attempt reaches the write
      // depends on the configured count, not on this test.
      let response;
      do {
        const renameSpy = vi
          .spyOn(reader, "renameDocument")
          .mockResolvedValue({ success: false, error: "simulated disk failure" });
        response = await call();
        renameSpy.mockRestore();
      } while (isRefusal(response));

      expect(response.isError).toBe(true);

      // The run survives a failed write, so the caller retries without making
      // the user sit through the explanation twice.
      const retry = await call();
      expect(retry.isError).toBeFalsy();
      expect(await reader.getDocumentContent("test-doc")).toContain("Content.");
    });
  });
});
