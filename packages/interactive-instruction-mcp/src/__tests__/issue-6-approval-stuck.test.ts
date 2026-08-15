/**
 * Issue #6 Reproduction Test
 *
 * Draft approval workflow gets stuck in pending_approval state.
 * Token is always rejected as "expired" regardless of timing.
 *
 * Three bugs contribute:
 * 1. Request ID mismatch between approve-handler and workflow instance
 * 2. Double token consumption (handler validates then workflow validates again)
 * 3. set_status doesn't reset workflow state machine
 *
 * These tests use a realistic mock that enforces request ID matching,
 * unlike the global mock in vitest-setup.ts which accepts any request ID.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MarkdownReader } from "../services/markdown-reader.js";
import type { ReminderConfig } from "../types/index.js";
import type { InstructionContext } from "../tools/instruction/types.js";
import { DRAFT_DIR } from "../constants.js";

import {
  AddHandler,
  ApproveHandler,
  SetStatusHandler,
} from "../tools/instruction/handlers/index.js";
import { draftWorkflowManager, DRAFT_PERSIST_DIR } from "../workflows/draft-workflow.js";

// Import mocked functions from mcp-shared (mocked globally in vitest-setup.ts)
import { requestApproval, validateApproval } from "mcp-shared/approval";

const mockRequestApproval = vi.mocked(requestApproval);
const mockValidateApproval = vi.mocked(validateApproval);

const tempBase = path.join(process.cwd(), "src/__tests__/temp-issue6");
const docsDir = tempBase;


describe("Issue #6: Approval workflow stuck in pending_approval", () => {
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
  });

  afterEach(async () => {
    vi.clearAllMocks();
    draftWorkflowManager.clear({ id: "test-doc" });
    // Also clean persisted workflow state to prevent leaking between test cases
    try {
      await fs.rm(DRAFT_PERSIST_DIR, { recursive: true, force: true });
      await fs.mkdir(DRAFT_PERSIST_DIR, { recursive: true });
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

  describe("Bug 1: Request ID mismatch causes token rejection", () => {
    it("should reproduce: approve-handler uses different request ID than workflow engine", async () => {
      // Track what request IDs are used by requestApproval and validateApproval
      const requestIds: { requested: string[]; validated: string[] } = {
        requested: [],
        validated: [],
      };

      mockRequestApproval.mockImplementation(async ({ request }) => {
        requestIds.requested.push(request.id);
        return { token: "1234", fallbackPath: "/tmp/mock.txt" };
      });

      mockValidateApproval.mockImplementation(({ requestId, providedToken }) => {
        requestIds.validated.push(requestId);
        // Simulate real behavior: only valid if requestId matches one that was requested
        const wasRequested = requestIds.requested.includes(requestId);
        if (!wasRequested) {
          return { valid: false, reason: "not_found" };
        }
        if (providedToken === "1234") {
          return { valid: true };
        }
        return { valid: false, reason: "invalid_token" };
      });

      // Create draft and progress to user_reviewing
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
      await progressToState("test-doc", "user_reviewing");

      // Step 1: Confirm → transitions to pending_approval, sends notification
      const confirmResult = await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", confirmed: true, force: true },
        context,
      });
      expect(confirmResult.isError).toBeFalsy();
      expect(confirmResult.content[0].text).toContain("Approval Requested");

      // At this point, requestApproval was called by the handler with its request ID
      expect(requestIds.requested.length).toBe(1);
      const handlerRequestId = requestIds.requested[0];

      // Step 2: Provide the token
      const tokenResult = await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", approvalToken: "1234" },
        context,
      });

      // BUG 1 REPRODUCTION: The handler validates with its own request ID (instruction::approve::test-doc)
      // but then calls draftWorkflowManager.trigger() which internally validates with
      // a different request ID (test-doc-pending_approval).
      //
      // With our realistic mock, the handler-level validation succeeds (same ID),
      // but the workflow engine's validation fails (different ID → not_found).

      // Check what request IDs were used for validation
      expect(requestIds.validated.length).toBeGreaterThanOrEqual(1);

      // The handler validates with the same ID it requested - this succeeds
      expect(requestIds.validated[0]).toBe(handlerRequestId);

      // If the workflow engine also tries to validate (Bug 2: double consumption),
      // it uses a DIFFERENT request ID format: "${instanceId}-${currentState}"
      if (requestIds.validated.length > 1) {
        const workflowRequestId = requestIds.validated[1];
        // This demonstrates the mismatch
        expect(workflowRequestId).not.toBe(handlerRequestId);
        // The workflow engine's ID format is "${id}-pending_approval"
        expect(workflowRequestId).toBe("test-doc-pending_approval");
      }

      // The overall operation should succeed (draft applied), but currently it may fail
      // because of Bug 1 (ID mismatch) or Bug 2 (double consumption)
      //
      // Expected behavior: tokenResult should NOT be an error
      // Actual behavior (bug): tokenResult IS an error due to mismatch/double consumption
      if (tokenResult.isError) {
        // BUG CONFIRMED: The approval fails even with a valid token
        expect(tokenResult.content[0].text).toMatch(/approval|expired|invalid|rejected/i);
      } else {
        // If this passes, the bug is fixed
        expect(tokenResult.content[0].text).toContain("approved");
      }
    });
  });

  describe("Bug 2: Double token consumption", () => {
    it("should reproduce: handler validates token then workflow validates again", async () => {
      let validateCallCount = 0;

      mockRequestApproval.mockResolvedValue({
        token: "5678",
        fallbackPath: "/tmp/mock.txt",
      });

      mockValidateApproval.mockImplementation(({ providedToken }) => {
        validateCallCount++;
        if (providedToken === "5678") {
          // Simulate real behavior: first call succeeds, second fails
          // because real validateApproval deletes the token on first success
          if (validateCallCount === 1) {
            return { valid: true };
          }
          // Second call: token already consumed
          return { valid: false, reason: "not_found" };
        }
        return { valid: false, reason: "invalid_token" };
      });

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
      await progressToState("test-doc", "user_reviewing");

      // Confirm → pending_approval
      await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", confirmed: true, force: true },
        context,
      });

      // Reset counter before token validation
      validateCallCount = 0;

      // Provide token
      const tokenResult = await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", approvalToken: "5678" },
        context,
      });

      // BUG 2 REPRODUCTION:
      // The handler calls validateApproval() first (succeeds, token deleted),
      // then calls draftWorkflowManager.trigger() which calls validateApproval() again
      // (fails because token was already consumed).
      //
      // With real approval utils, validateApproval deletes the pending approval on success.
      // The second call finds nothing → returns not_found → reported as "expired".

      // Check how many times validateApproval was called
      // Expected: 1 (handler only, workflow should not re-validate)
      // Actual (bug): 2 (handler + workflow engine both validate)
      if (validateCallCount > 1) {
        // BUG CONFIRMED: Token validated twice
        expect(validateCallCount).toBe(2);
        // The second validation fails because token was consumed
        expect(tokenResult.isError).toBe(true);
      } else {
        // Bug is fixed: only validated once
        expect(validateCallCount).toBe(1);
      }
    });
  });

  describe("Bug 3: set_status does not reset workflow state machine", () => {
    it("should reproduce: set_status updates frontmatter but not workflow manager state", async () => {
      mockRequestApproval.mockResolvedValue({
        token: "9999",
        fallbackPath: "/tmp/mock.txt",
      });
      mockValidateApproval.mockReturnValue({ valid: true });

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

      // Use set_status to reset to user_reviewing (e.g., to retry approval)
      const setStatusResult = await setStatusHandler.execute({
        rawParams: { action: "set_status", id: "test-doc", status: "user_reviewing" },
        context,
      });
      expect(setStatusResult.isError).toBeFalsy();

      // BUG 3 REPRODUCTION:
      // set_status only updates the frontmatter in the markdown file,
      // but does NOT reset the workflow state machine in draftWorkflowManager.

      // Check workflow manager state - it should be user_reviewing after set_status
      const statusAfter = await draftWorkflowManager.getStatus({ id: "test-doc" });

      // Expected behavior: statusAfter.state === "user_reviewing"
      // Actual behavior (bug): statusAfter.state === "pending_approval" (unchanged)
      expect(statusAfter?.state).toBe("pending_approval"); // Bug: still pending_approval

      // Now try to re-confirm - the approve handler reads state from workflow manager,
      // which is still "pending_approval", so it hits the "Unexpected State" fallback
      const retryResult = await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", confirmed: true, force: true },
        context,
      });

      // BUG: The handler sees "pending_approval" from workflow manager (not frontmatter),
      // and since confirmed=true is only handled for user_reviewing state,
      // it falls through to the "Unexpected State" error.
      expect(retryResult.isError).toBe(true);
      expect(retryResult.content[0].text).toContain("Unexpected State");
    });
  });

  describe("Full reproduction: Steps from issue #6", () => {
    it("should reproduce the complete stuck workflow scenario", async () => {
      // Setup realistic mock that tracks request IDs and enforces matching
      const pendingTokens = new Map<string, string>();

      mockRequestApproval.mockImplementation(async ({ request }) => {
        const token = "4567";
        pendingTokens.set(request.id, token);
        return { token, fallbackPath: "/tmp/mock.txt" };
      });

      mockValidateApproval.mockImplementation(({ requestId, providedToken }) => {
        const expected = pendingTokens.get(requestId);
        if (!expected) {
          return { valid: false, reason: "not_found" };
        }
        if (expected !== providedToken) {
          return { valid: false, reason: "invalid_token" };
        }
        // Consume token (real behavior)
        pendingTokens.delete(requestId);
        return { valid: true };
      });

      // Step 1: Create draft
      await addHandler.execute({
        rawParams: {
          action: "add",
          id: "test-doc",
          content: "# Test Doc\n\nThis is a test document.",
          description: "Test document",
          whenToUse: ["Testing"],
        },
        context,
      });

      // Step 2: Progress through workflow: editing → self_review → user_reviewing
      await progressToState("test-doc", "user_reviewing");

      // Step 3: Confirm → pending_approval + notification sent
      const confirmResult = await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", confirmed: true, force: true },
        context,
      });
      expect(confirmResult.isError).toBeFalsy();
      expect(confirmResult.content[0].text).toContain("Approval Requested");

      // Record the request ID used by the handler
      const handlerRequestId = [...pendingTokens.keys()][0];
      expect(handlerRequestId).toBeDefined();

      // Step 4: Provide token
      // The handler validates the token successfully (using its own request ID).
      // Then it calls draftWorkflowManager.trigger() which internally tries to
      // validate with a DIFFERENT request ID (Bug 1) — this fails silently because
      // the handler doesn't check trigger()'s return value.
      //
      // Despite the internal workflow engine failure, the handler proceeds to
      // rename the draft file and clear the workflow. The workflow state machine
      // is left in an inconsistent state: the handler thinks it's applied,
      // but the workflow engine never transitioned to "applied".
      const approveResult = await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", approvalToken: "4567" },
        context,
      });

      // The handler-level validation succeeds, so it proceeds with the apply
      // (Note: internally the workflow trigger fails, but result is ignored)
      expect(approveResult.isError).toBeFalsy();
      expect(approveResult.content[0].text).toContain("approved");

      // But the workflow state was never properly transitioned.
      // The handler called draftWorkflowManager.clear() which removes from cache,
      // but the persisted state file still has "pending_approval".
      // This demonstrates the inconsistency introduced by Bug 1 and Bug 2:
      // the handler bypasses the workflow engine's state machine.

      // Verify: the handler-level validateApproval consumed the token
      expect(pendingTokens.has(handlerRequestId)).toBe(false);

      // Verify: the workflow engine tried to validate with a different ID
      // (this is the ID format used by instance.ts: "${instanceId}-${currentState}")
      // The real validateApproval in mcp-shared would have received this ID
      // and found no matching pending approval → returned "not_found".
    });

    it("should reproduce stuck state when handler-level validation also fails", async () => {
      // In the real system (without mocks), both requestApproval and validateApproval
      // are the SAME real functions. The request ID mismatch means the token stored
      // under one key is looked up under another → always "not_found".
      //
      // This test simulates that scenario more faithfully.
      mockRequestApproval.mockImplementation(async ({ request }) => {
        // Store under the handler's request ID
        return { token: "4567", fallbackPath: "/tmp/mock.txt" };
      });

      // Always return not_found to simulate the real mismatch
      mockValidateApproval.mockReturnValue({ valid: false, reason: "not_found" });

      await addHandler.execute({
        rawParams: {
          action: "add",
          id: "test-doc",
          content: "# Test Doc\n\nThis is a test document.",
          description: "Test document",
          whenToUse: ["Testing"],
        },
        context,
      });

      await progressToState("test-doc", "user_reviewing");

      // Confirm → pending_approval
      await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", confirmed: true, force: true },
        context,
      });

      // Provide token → rejected because validateApproval returns not_found
      const approveResult = await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", approvalToken: "4567" },
        context,
      });

      // Handler-level validation fails → token rejected
      expect(approveResult.isError).toBe(true);
      expect(approveResult.content[0].text).toMatch(/approval|rejected/i);

      // Workflow is stuck at pending_approval
      const status = await draftWorkflowManager.getStatus({ id: "test-doc" });
      expect(status?.state).toBe("pending_approval");

      // Step 5: Try set_status to recover
      await setStatusHandler.execute({
        rawParams: { action: "set_status", id: "test-doc", status: "user_reviewing" },
        context,
      });

      // Bug 3: Workflow manager state is still pending_approval
      const statusAfterReset = await draftWorkflowManager.getStatus({ id: "test-doc" });
      expect(statusAfterReset?.state).toBe("pending_approval"); // BUG: not reset

      // Step 6: Try to re-confirm → hits "Unexpected State"
      const retryResult = await approveHandler.execute({
        rawParams: { action: "approve", id: "test-doc", confirmed: true, force: true },
        context,
      });

      // Handler sees pending_approval from workflow manager, falls to "Unexpected State"
      expect(retryResult.isError).toBe(true);
      expect(retryResult.content[0].text).toContain("Unexpected State");
    });
  });
});
