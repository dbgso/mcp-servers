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
});
