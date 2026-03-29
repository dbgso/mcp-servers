/**
 * ApproveHandler Unit Tests
 *
 * Tests for batch approval functionality and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MarkdownReader } from "../services/markdown-reader.js";
import type { ReminderConfig, DraftActionContext } from "../types/index.js";
import { DRAFT_DIR } from "../constants.js";
import { ApproveHandler } from "../tools/draft/handlers/approve-handler.js";
import { AddHandler } from "../tools/draft/handlers/add-handler.js";
import { draftWorkflowManager } from "../workflows/draft-workflow.js";

// Import mocked functions from mcp-shared (mocked globally in vitest-setup.ts)
import { requestApproval, validateApproval } from "mcp-shared";

// Get references to the mocked functions
const mockRequestApproval = vi.mocked(requestApproval);
const mockValidateApproval = vi.mocked(validateApproval);

const tempBase = path.join(process.cwd(), "src/__tests__/temp-approve");
const docsDir = tempBase;

describe("ApproveHandler", () => {
  let reader: MarkdownReader;
  let context: DraftActionContext;
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

    // Setup mock implementations
    mockRequestApproval.mockResolvedValue({
      token: "mock-token-12345",
      fallbackPath: "/tmp/mock-pending.txt",
    });
    mockValidateApproval.mockImplementation(({ providedToken }) => {
      if (providedToken === "valid-token") {
        return { valid: true };
      }
      return { valid: false, reason: "Invalid token" };
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();

    // Clear workflow states for all IDs used in this test
    for (const id of testIds) {
      draftWorkflowManager.clear({ id });
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
  async function createDraftAtState(
    id: string,
    state: "editing" | "self_review" | "user_reviewing" | "pending_approval"
  ): Promise<void> {
    // Clear any existing state first
    draftWorkflowManager.clear({ id });

    // Create draft file
    await addHandler.execute({
      actionParams: { id, content: `# ${id}\n\nTest content for ${id}.`, description: `Test ${id}`, whenToUse: ["Testing"] },
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

    // Progress to pending_approval
    await draftWorkflowManager.trigger({
      id,
      triggerParams: { action: "confirm", confirmed: true },
    });
  }

  describe("AddHandler validations", () => {
    it("should require whenToUse for add action", async () => {
      const id = getTestId("test-no-when");
      const result = await addHandler.execute({
        actionParams: { id, content: "# Test", description: "Test description" },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("whenToUse is required");
    });

    it("should reject empty whenToUse array", async () => {
      const id = getTestId("test-empty-when");
      const result = await addHandler.execute({
        actionParams: { id, content: "# Test", description: "Test desc", whenToUse: [] },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("whenToUse is required");
    });
  });

  describe("Single draft approval", () => {
    it("should require id or ids parameter", async () => {
      const result = await approveHandler.execute({
        actionParams: {},
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("id or ids is required");
    });

    it("should require notes in self_review state", async () => {
      const id = getTestId("test-draft-1");
      await createDraftAtState(id, "self_review");

      const result = await approveHandler.execute({
        actionParams: { id },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("notes");
    });

    it("should require confirmed in user_reviewing state", async () => {
      const id = getTestId("test-draft-1");
      await createDraftAtState(id, "user_reviewing");

      const result = await approveHandler.execute({
        actionParams: { id },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("confirmed");
    });
  });

  describe("Batch approval with ids parameter", () => {
    describe("confirmed: true behavior", () => {
      it("should send single notification for batch (mock verification)", async () => {
        const id1 = getTestId("test-draft-1");
        const id2 = getTestId("test-draft-2");
        const id3 = getTestId("test-draft-3");
        await createDraftAtState(id1, "user_reviewing");
        await createDraftAtState(id2, "user_reviewing");
        await createDraftAtState(id3, "user_reviewing");

        const result = await approveHandler.execute({
          actionParams: { ids: `${id1},${id2},${id3}`, confirmed: true },
          context,
        });

        // Success case
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("Batch Approval Requested");
        expect(result.content[0].text).toContain("3 drafts");

        // Verify single notification was sent
        expect(mockRequestApproval).toHaveBeenCalledTimes(1);
        expect(mockRequestApproval).toHaveBeenCalledWith(
          expect.objectContaining({
            request: expect.objectContaining({
              operation: "Batch Draft Approval",
              description: expect.stringContaining("3 drafts"),
            }),
          })
        );

        // Verify state transitions
        const status1 = await draftWorkflowManager.getStatus({ id: id1 });
        const status2 = await draftWorkflowManager.getStatus({ id: id2 });
        const status3 = await draftWorkflowManager.getStatus({ id: id3 });
        expect(status1?.state).toBe("pending_approval");
        expect(status2?.state).toBe("pending_approval");
        expect(status3?.state).toBe("pending_approval");
      });

      it("should return error with isError: true when drafts not in user_reviewing", async () => {
        const id1 = getTestId("test-draft-1");
        const id2 = getTestId("test-draft-2");
        await createDraftAtState(id1, "user_reviewing");
        await createDraftAtState(id2, "self_review"); // Wrong state

        const result = await approveHandler.execute({
          actionParams: { ids: `${id1},${id2}`, confirmed: true },
          context,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(id2);
        expect(result.content[0].text).toContain("self_review");

        // Verify no notification was sent
        expect(mockRequestApproval).not.toHaveBeenCalled();
      });

      it("should send exactly one notification for single draft in batch mode", async () => {
        const id1 = getTestId("test-draft-1");
        await createDraftAtState(id1, "user_reviewing");

        const result = await approveHandler.execute({
          actionParams: { ids: id1, confirmed: true },
          context,
        });

        expect(result.isError).toBeFalsy();

        // Single draft should also send exactly 1 notification
        expect(mockRequestApproval).toHaveBeenCalledTimes(1);
        expect(mockRequestApproval).toHaveBeenCalledWith(
          expect.objectContaining({
            request: expect.objectContaining({
              operation: "Batch Draft Approval",
              description: expect.stringContaining("1 drafts"),
            }),
          })
        );
      });
    });

    describe("approvalToken behavior", () => {
      it("should validate token and apply all drafts without sending notification", async () => {
        const id1 = getTestId("test-draft-1");
        const id2 = getTestId("test-draft-2");
        await createDraftAtState(id1, "pending_approval");
        await createDraftAtState(id2, "pending_approval");

        const result = await approveHandler.execute({
          actionParams: {
            ids: `${id1},${id2}`,
            approvalToken: "valid-token",
          },
          context,
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("Batch Approval Complete");
        expect(result.content[0].text).toContain(id1);
        expect(result.content[0].text).toContain(id2);

        // Final approval with token should NOT send notification
        expect(mockRequestApproval).not.toHaveBeenCalled();
      });

      it("should handle missing draft file during batch approval", async () => {
        const id1 = getTestId("test-draft-missing");

        // Create workflow state without draft file
        draftWorkflowManager.clear({ id: id1 });
        await draftWorkflowManager.trigger({
          id: id1,
          triggerParams: { action: "submit", content: "# Test" },
        });
        await draftWorkflowManager.trigger({
          id: id1,
          triggerParams: { action: "review_complete", notes: "Reviewed" },
        });
        await draftWorkflowManager.trigger({
          id: id1,
          triggerParams: { action: "confirm", confirmed: true },
        });

        const result = await approveHandler.execute({
          actionParams: {
            ids: id1,
            approvalToken: "valid-token",
          },
          context,
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("Draft not found");
      });

      it("should reject invalid token", async () => {
        const id1 = getTestId("test-draft-1");
        await createDraftAtState(id1, "pending_approval");

        const result = await approveHandler.execute({
          actionParams: {
            ids: id1,
            approvalToken: "invalid-token",
          },
          context,
        });

        expect(result.isError).toBe(true);
        // Message contains reason from validateApproval
        expect(result.content[0].text).toContain("Invalid token");
      });

      it("should require all drafts in pending_approval state", async () => {
        const id1 = getTestId("test-draft-1");
        const id2 = getTestId("test-draft-2");
        await createDraftAtState(id1, "pending_approval");
        await createDraftAtState(id2, "user_reviewing"); // Wrong state

        const result = await approveHandler.execute({
          actionParams: {
            ids: `${id1},${id2}`,
            approvalToken: "valid-token",
          },
          context,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("pending_approval");
      });

      it("should request approval when all drafts in pending_approval without token", async () => {
        const id1 = getTestId("test-draft-1");
        const id2 = getTestId("test-draft-2");
        await createDraftAtState(id1, "pending_approval");
        await createDraftAtState(id2, "pending_approval");

        const result = await approveHandler.execute({
          actionParams: {
            ids: `${id1},${id2}`,
            // No approvalToken - should request approval
          },
          context,
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("Batch Approval Requested");
        expect(result.content[0].text).toContain("2 drafts");
        expect(mockRequestApproval).toHaveBeenCalledTimes(1);
      });
    });

    describe("confirmed + approvalToken precedence", () => {
      /**
       * Security requirement: approvalToken must take precedence over confirmed.
       * This ensures AI cannot bypass user approval by sending confirmed: true.
       *
       * These tests define EXPECTED behavior. They will fail until the bug is fixed.
       */
      it("should prioritize approvalToken over confirmed", async () => {
        const id1 = getTestId("test-draft-1");
        await createDraftAtState(id1, "pending_approval");

        // Both confirmed and approvalToken provided
        const result = await approveHandler.execute({
          actionParams: {
            ids: id1,
            confirmed: true,
            approvalToken: "valid-token",
          },
          context,
        });

        // Expected: should use token and complete approval
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("Batch Approval Complete");
      });

      it("should not allow confirmed: true to bypass token requirement in pending_approval", async () => {
        const id1 = getTestId("test-draft-1");
        await createDraftAtState(id1, "pending_approval");

        // Only confirmed, no token - should NOT approve
        const result = await approveHandler.execute({
          actionParams: {
            ids: id1,
            confirmed: true,
          },
          context,
        });

        // When in pending_approval, confirmed: true should fail
        // (drafts are not in user_reviewing state)
        expect(result.isError).toBe(true);
      });
    });
  });

  describe("Error handling", () => {
    it("should return isError: true for empty ids", async () => {
      const result = await approveHandler.execute({
        actionParams: { ids: "   ,  , " },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No valid IDs");
    });

    it("should handle rename error in batch approval", async () => {
      const id1 = getTestId("test-draft-1");
      await createDraftAtState(id1, "pending_approval");

      // Mock renameDocument to fail
      const renameSpy = vi.spyOn(reader, "renameDocument").mockResolvedValueOnce({
        success: false,
        error: "Batch rename error",
      });

      const result = await approveHandler.execute({
        actionParams: {
          ids: id1,
          approvalToken: "valid-token",
        },
        context,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("❌");
      expect(result.content[0].text).toContain("Batch rename error");

      renameSpy.mockRestore();
    });
  });

  describe("Single draft approval with token (handleApprovalWithToken)", () => {
    it("should reject token when draft is not in pending_approval state", async () => {
      const id = getTestId("test-draft-1");
      await createDraftAtState(id, "self_review");

      const result = await approveHandler.execute({
        actionParams: { id, approvalToken: "valid-token" },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Cannot approve yet");
      expect(result.content[0].text).toContain("self_review");
      expect(result.content[0].text).toContain("pending_approval");
    });

    it("should reject invalid token in pending_approval state", async () => {
      const id = getTestId("test-draft-1");
      await createDraftAtState(id, "pending_approval");

      const result = await approveHandler.execute({
        actionParams: { id, approvalToken: "invalid-token" },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Approval rejected");
      expect(result.content[0].text).toContain("Invalid token");
    });

    it("should apply draft with valid token", async () => {
      const id = getTestId("test-draft-1");
      await createDraftAtState(id, "pending_approval");

      const result = await approveHandler.execute({
        actionParams: { id, approvalToken: "valid-token" },
        context,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("approved and promoted");
      expect(result.content[0].text).toContain(id);

      // Verify draft file was moved to target location
      const draftContent = await reader.getDocumentContent(`_mcp_drafts__${id}`);
      expect(draftContent).toBeNull(); // Draft should no longer exist

      const targetContent = await reader.getDocumentContent(id);
      expect(targetContent).not.toBeNull();
      expect(targetContent).toContain(id);
    });

    it("should apply draft to custom targetId with valid token", async () => {
      const id = getTestId("test-draft-1");
      const targetId = getTestId("custom-target");
      await createDraftAtState(id, "pending_approval");

      const result = await approveHandler.execute({
        actionParams: { id, targetId, approvalToken: "valid-token" },
        context,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain(targetId);

      // Verify target file exists
      const targetContent = await reader.getDocumentContent(targetId);
      expect(targetContent).not.toBeNull();
    });

    it("should return error when draft content not found", async () => {
      const id = getTestId("test-draft-missing");

      // Create workflow state without draft file
      draftWorkflowManager.clear({ id });
      await draftWorkflowManager.trigger({
        id,
        triggerParams: { action: "submit", content: "# Test" },
      });
      await draftWorkflowManager.trigger({
        id,
        triggerParams: { action: "review_complete", notes: "Reviewed" },
      });
      await draftWorkflowManager.trigger({
        id,
        triggerParams: { action: "confirm", confirmed: true },
      });

      const result = await approveHandler.execute({
        actionParams: { id, approvalToken: "valid-token" },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("should return error when renameDocument fails during approval", async () => {
      const id = getTestId("test-draft-rename-fail");
      await createDraftAtState(id, "pending_approval");

      // Mock renameDocument to simulate failure
      const renameSpy = vi.spyOn(reader, "renameDocument").mockResolvedValueOnce({
        success: false,
        error: "Filesystem error: permission denied",
      });

      const result = await approveHandler.execute({
        actionParams: { id, approvalToken: "valid-token" },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error:");
      expect(result.content[0].text).toContain("Filesystem error: permission denied");

      renameSpy.mockRestore();
    });

  });

  describe("Single draft workflow (handleApprovalRequest)", () => {
    it("should transition from self_review to user_reviewing with notes", async () => {
      const id = getTestId("test-draft-1");
      await createDraftAtState(id, "self_review");

      const result = await approveHandler.execute({
        actionParams: { id, notes: "Self-review complete" },
        context,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("user_reviewing");

      const status = await draftWorkflowManager.getStatus({ id });
      expect(status?.state).toBe("user_reviewing");
    });

    it("should transition from user_reviewing to pending_approval with confirmed", async () => {
      const id = getTestId("test-draft-1");
      await createDraftAtState(id, "user_reviewing");

      const result = await approveHandler.execute({
        actionParams: { id, confirmed: true, force: true },
        context,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Approval Requested");
      expect(mockRequestApproval).toHaveBeenCalledTimes(1);

      const status = await draftWorkflowManager.getStatus({ id });
      expect(status?.state).toBe("pending_approval");
    });

    it("should return error for unexpected state when no workflow exists", async () => {
      const id = getTestId("test-draft-no-workflow");

      // Create draft file directly without triggering workflow
      await fs.writeFile(
        path.join(docsDir, DRAFT_DIR, `${id}.md`),
        `# ${id}\n\nTest content.`,
        "utf-8"
      );

      // Don't initialize any workflow state - so currentState will be "editing" (default)
      const result = await approveHandler.execute({
        actionParams: { id },
        context,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unexpected State");
      expect(result.content[0].text).toContain("editing");
    });

    it("should generate CREATE summary for new documents", async () => {
      const id = getTestId("test-draft-create");
      await createDraftAtState(id, "user_reviewing");

      const result = await approveHandler.execute({
        actionParams: { id, confirmed: true, force: true },
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
        actionParams: { id, confirmed: true, force: true },
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
        actionParams: {
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
        actionParams: { id, confirmed: true, force: true },
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
        actionParams: {
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
        actionParams: { id, confirmed: true, force: true },
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
        actionParams: {
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
        actionParams: { id, confirmed: true, force: true },
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
        actionParams: { id: id2, confirmed: true },
        context,
      });

      // Warning is returned as isError: true with batch suggestion
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("batch");
      expect(result.content[0].text).toContain("Consecutive");
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
        actionParams: { id: id2, confirmed: true, force: true },
        context,
      });

      expect(result.isError).toBeFalsy();
      // Should not mention batch, should proceed with approval
      expect(result.content[0].text).toContain("Approval Requested");
    });
  });

  describe("Workflow state transition loop bug", () => {
    /**
     * Bug reproduction test:
     * 1. approve with notes → should transition to user_reviewing
     * 2. approve with confirmed: true → should transition to pending_approval
     *
     * Reported issue:
     * - approve with notes returns to self_review
     * - confirmed: true alone says notes are required
     * This creates an infinite loop.
     */
    it("should complete full workflow: self_review → user_reviewing → pending_approval", async () => {
      const id = getTestId("test-workflow-loop");

      // Step 1: Create draft (goes to self_review automatically)
      await addHandler.execute({
        actionParams: {
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
        actionParams: { id, notes: "Self-review: content looks good" },
        context,
      });

      expect(result2.isError).toBeFalsy();
      const status2 = await draftWorkflowManager.getStatus({ id });
      expect(status2?.state).toBe("user_reviewing");

      // Step 3: Approve with confirmed: true → should go to pending_approval
      const result3 = await approveHandler.execute({
        actionParams: { id, confirmed: true, force: true },
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
        actionParams: {
          id,
          content: `# ${id}\n\nTest content.`,
          description: "Test no notes",
          whenToUse: ["Testing"],
        },
        context,
      });

      // Progress through self_review
      await approveHandler.execute({
        actionParams: { id, notes: "Self-review done" },
        context,
      });

      // Verify we're in user_reviewing
      const status = await draftWorkflowManager.getStatus({ id });
      expect(status?.state).toBe("user_reviewing");

      // Now approve with confirmed: true (no notes) - should NOT error
      const result = await approveHandler.execute({
        actionParams: { id, confirmed: true, force: true },
        context,
      });

      // Should succeed, not ask for notes (i.e., not require notes to proceed)
      expect(result.isError).toBeFalsy();
      // Should NOT say "must provide notes" or similar error
      expect(result.content[0].text).not.toContain("must provide");
      expect(result.content[0].text).not.toContain("notes is required");
      expect(result.content[0].text).toContain("Approval Requested");
    });

    it("should NOT return to self_review after providing notes", async () => {
      const id = getTestId("test-no-return-self-review");

      // Create draft
      await addHandler.execute({
        actionParams: {
          id,
          content: `# ${id}\n\nContent.`,
          description: "Test no return",
          whenToUse: ["Testing"],
        },
        context,
      });

      // Approve with notes
      const result = await approveHandler.execute({
        actionParams: { id, notes: "Self-review complete" },
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
        actionParams: {
          id,
          content: `# ${id}\n\nContent.`,
          description: "Test frontmatter",
          whenToUse: ["Testing"],
        },
        context,
      });

      // Approve with notes
      await approveHandler.execute({
        actionParams: { id, notes: "Self-review complete" },
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
        actionParams: {
          id,
          content: `# ${id}\n\nContent.`,
          description: "Test persist",
          whenToUse: ["Testing"],
        },
        context,
      });

      // Transition to user_reviewing
      await approveHandler.execute({
        actionParams: { id, notes: "Self-review complete" },
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
        actionParams: {
          id,
          content: `# ${id}\n\nContent.`,
          description: "Test multiple",
          whenToUse: ["Testing"],
        },
        context,
      });

      // First approve with notes → should go to user_reviewing
      const result1 = await approveHandler.execute({
        actionParams: { id, notes: "First review" },
        context,
      });
      expect(result1.isError).toBeFalsy();

      const status1 = await draftWorkflowManager.getStatus({ id });
      expect(status1?.state).toBe("user_reviewing");

      // Second approve with notes (already in user_reviewing, should error or handle gracefully)
      const result2 = await approveHandler.execute({
        actionParams: { id, notes: "Second review" },
        context,
      });
      // In user_reviewing, notes are not expected - should ask for confirmed
      expect(result2.isError).toBe(true);
      expect(result2.content[0].text).toContain("confirmed");

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
          actionParams: {
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
          actionParams: { id, notes: `Self-review for ${id}` },
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
        actionParams: { ids: `${id1},${id2},${id3}`, confirmed: true },
        context,
      });

      expect(batchResult.isError).toBeFalsy();
      expect(batchResult.content[0].text).toContain("Batch Approval Requested");
      expect(batchResult.content[0].text).toContain("3 drafts");

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
        actionParams: { id, confirmed: true, force: true },
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
        actionParams: { id, confirmed: true, force: true },
        context,
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("Update");
      // Should show - and + for the changed line
      expect(text).toContain("- Line to change");
      expect(text).toContain("+ CHANGED line");
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
        actionParams: { id, confirmed: true, force: true },
        context,
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text as string;
      expect(text).toContain("Update");
      // Should show removed lines
      expect(text).toContain("- Line 3 to be removed");
      expect(text).toContain("- Line 4 to be removed");
      // Summary should show removed count
      expect(text).toMatch(/-\d+/);
    });
  });
});
