import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MarkdownReader } from "../services/markdown-reader.js";
import type { ReminderConfig, DraftActionContext, ApplyActionContext } from "../types/index.js";
import { DRAFT_DIR } from "../constants.js";

// Draft handlers
import {
  ListHandler as DraftListHandler,
  ReadHandler,
  AddHandler,
  UpdateHandler,
  DeleteHandler,
  RenameHandler,
} from "../tools/draft/handlers/index.js";

// Apply handlers
import {
  ListHandler as ApplyListHandler,
  PromoteHandler,
} from "../tools/apply/handlers/index.js";

// Approve handler for batch approval tests
import { ApproveHandler } from "../tools/draft/handlers/approve-handler.js";
import { draftWorkflowManager } from "../workflows/draft-workflow.js";

// Import mocked functions from mcp-shared (mocked globally in vitest-setup.ts)
import { requestApproval, validateApproval } from "mcp-shared";

// Get references to the mocked functions
const mockRequestApproval = vi.mocked(requestApproval);
const mockValidateApproval = vi.mocked(validateApproval);

const tempBase = path.join(process.cwd(), "src/__tests__/temp-integration");
const docsDir = tempBase; // Single directory for both docs and drafts

describe("Integration Tests", () => {
  let reader: MarkdownReader;
  let draftContext: DraftActionContext;
  let applyContext: ApplyActionContext;

  // Draft handlers
  let draftListHandler: DraftListHandler;
  let draftReadHandler: ReadHandler;
  let draftAddHandler: AddHandler;
  let draftUpdateHandler: UpdateHandler;
  let draftDeleteHandler: DeleteHandler;
  let draftRenameHandler: RenameHandler;

  // Apply handlers
  let applyListHandler: ApplyListHandler;
  let promoteHandler: PromoteHandler;

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

    draftContext = {
      reader,
      config: defaultConfig,
    };

    applyContext = {
      reader,
      config: defaultConfig,
    };

    // Initialize draft handlers
    draftListHandler = new DraftListHandler();
    draftReadHandler = new ReadHandler();
    draftAddHandler = new AddHandler();
    draftUpdateHandler = new UpdateHandler();
    draftDeleteHandler = new DeleteHandler();
    draftRenameHandler = new RenameHandler();

    // Initialize apply handlers
    applyListHandler = new ApplyListHandler();
    promoteHandler = new PromoteHandler();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempBase, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ===================
  // A. Draft Tool Tests
  // ===================
  describe("A. Draft Tool", () => {
    describe("1. Basic draft operations", () => {
      it("should add a new draft", async () => {
        const result = await draftAddHandler.execute({
          actionParams: {
            id: "coding-style",
            content: "# Coding Style\n\nUse consistent formatting.",
            description: "Coding style guidelines",
            whenToUse: ["Writing new code"],
          },
          context: draftContext,
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("created successfully");

        // Verify file exists in _mcp_drafts directory with prefix
        const filePath = path.join(docsDir, DRAFT_DIR, "coding-style.md");
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        expect(exists).toBe(true);
      });

      it("should list drafts", async () => {
        // Add some drafts
        await draftAddHandler.execute({
          actionParams: { id: "draft1", content: "# Draft 1\n\nFirst draft description.", description: "First draft", whenToUse: ["Testing"] },
          context: draftContext,
        });
        await draftAddHandler.execute({
          actionParams: { id: "draft2", content: "# Draft 2\n\nSecond draft description.", description: "Second draft", whenToUse: ["Testing"] },
          context: draftContext,
        });

        const result = await draftListHandler.execute({
          actionParams: {},
          context: draftContext,
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("draft1");
        expect(result.content[0].text).toContain("draft2");
      });

      it("should read a draft", async () => {
        await draftAddHandler.execute({
          actionParams: { id: "test-read", content: "# Test Content\n\nSome text here.", description: "Test content", whenToUse: ["Testing"] },
          context: draftContext,
        });

        const result = await draftReadHandler.execute({
          actionParams: { id: "test-read" },
          context: draftContext,
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("Test Content");
        expect(result.content[0].text).toContain("Some text here");
      });

      it("should update a draft", async () => {
        await draftAddHandler.execute({
          actionParams: { id: "to-update", content: "# Original\n\nOriginal content.", description: "Original", whenToUse: ["Testing"] },
          context: draftContext,
        });

        const result = await draftUpdateHandler.execute({
          actionParams: { id: "to-update", content: "# Updated Content\n\nThis has been updated." },
          context: draftContext,
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("updated");

        // Verify content changed
        const readResult = await draftReadHandler.execute({
          actionParams: { id: "to-update" },
          context: draftContext,
        });
        expect(readResult.content[0].text).toContain("Updated Content");
      });

      it("should delete a draft", async () => {
        await draftAddHandler.execute({
          actionParams: { id: "to-delete", content: "# Delete Me\n\nThis will be deleted.", description: "To delete", whenToUse: ["Testing"] },
          context: draftContext,
        });

        const result = await draftDeleteHandler.execute({
          actionParams: { id: "to-delete" },
          context: draftContext,
        });

        expect(result.isError).toBeFalsy();

        // Verify file is gone
        const filePath = path.join(docsDir, DRAFT_DIR, "to-delete.md");
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        expect(exists).toBe(false);
      });

      it("should rename a draft", async () => {
        await draftAddHandler.execute({
          actionParams: { id: "old-name", content: "# Rename Me\n\nThis will be renamed.", description: "Old name", whenToUse: ["Testing"] },
          context: draftContext,
        });

        const result = await draftRenameHandler.execute({
          actionParams: { id: "old-name", newId: "new-name" },
          context: draftContext,
        });

        expect(result.isError).toBeFalsy();

        // Verify old file is gone, new file exists
        const oldPath = path.join(docsDir, DRAFT_DIR, "old-name.md");
        const newPath = path.join(docsDir, DRAFT_DIR, "new-name.md");
        const oldExists = await fs.access(oldPath).then(() => true).catch(() => false);
        const newExists = await fs.access(newPath).then(() => true).catch(() => false);
        expect(oldExists).toBe(false);
        expect(newExists).toBe(true);
      });
    });

    describe("2. Draft with hierarchy", () => {
      it("should create drafts with hierarchical IDs", async () => {
        await draftAddHandler.execute({
          actionParams: { id: "coding__style", content: "# Style\n\nCoding style guidelines.", description: "Style guide", whenToUse: ["Coding"] },
          context: draftContext,
        });
        await draftAddHandler.execute({
          actionParams: { id: "coding__testing", content: "# Testing\n\nTesting guidelines.", description: "Testing guide", whenToUse: ["Testing"] },
          context: draftContext,
        });

        // Check directory structure
        const codingDir = path.join(docsDir, DRAFT_DIR, "coding");
        const exists = await fs.access(codingDir).then(() => true).catch(() => false);
        expect(exists).toBe(true);

        // List should show both
        const result = await draftListHandler.execute({
          actionParams: {},
          context: draftContext,
        });
        expect(result.content[0].text).toContain("coding__style");
        expect(result.content[0].text).toContain("coding__testing");
      });
    });
  });

  // ===================
  // B. Apply Tool Tests
  // ===================
  describe("B. Apply Tool", () => {
    describe("1. Promote draft to confirmed", () => {
      it("should promote a draft with same name", async () => {
        // Create draft
        await draftAddHandler.execute({
          actionParams: { id: "rules", content: "# Rules\n\nFollow these rules.", description: "Rules", whenToUse: ["Following rules"] },
          context: draftContext,
        });

        // Promote
        const result = await promoteHandler.execute({
          actionParams: { draftId: "rules" },
          context: applyContext,
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("promoted");

        // Verify draft is gone, confirmed doc exists
        const draftPath = path.join(docsDir, DRAFT_DIR, "rules.md");
        const confirmedPath = path.join(docsDir, "rules.md");
        const draftExists = await fs.access(draftPath).then(() => true).catch(() => false);
        const confirmedExists = await fs.access(confirmedPath).then(() => true).catch(() => false);
        expect(draftExists).toBe(false);
        expect(confirmedExists).toBe(true);
      });

      it("should promote a draft with different target name", async () => {
        await draftAddHandler.execute({
          actionParams: { id: "temp-rules", content: "# Rules\n\nTemporary rules draft.", description: "Temp rules", whenToUse: ["Testing"] },
          context: draftContext,
        });

        const result = await promoteHandler.execute({
          actionParams: { draftId: "temp-rules", targetId: "coding__rules" },
          context: applyContext,
        });

        expect(result.isError).toBeFalsy();

        // Verify correct paths
        const confirmedPath = path.join(docsDir, "coding", "rules.md");
        const confirmedExists = await fs.access(confirmedPath).then(() => true).catch(() => false);
        expect(confirmedExists).toBe(true);
      });

      it("should list drafts ready to promote", async () => {
        await draftAddHandler.execute({
          actionParams: { id: "ready1", content: "# Ready 1\n\nFirst ready draft.", description: "Ready 1", whenToUse: ["Testing"] },
          context: draftContext,
        });
        await draftAddHandler.execute({
          actionParams: { id: "ready2", content: "# Ready 2\n\nSecond ready draft.", description: "Ready 2", whenToUse: ["Testing"] },
          context: draftContext,
        });

        const result = await applyListHandler.execute({
          actionParams: {},
          context: applyContext,
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("ready1");
        expect(result.content[0].text).toContain("ready2");
      });
    });
  });

  // ===================
  // C. Error Cases
  // ===================
  describe("C. Error Cases", () => {
    describe("1. Draft errors", () => {
      it("should error when adding draft without id", async () => {
        const result = await draftAddHandler.execute({
          actionParams: { content: "# No ID" },
          context: draftContext,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("required");
      });

      it("should error when adding draft without content", async () => {
        const result = await draftAddHandler.execute({
          actionParams: { id: "no-content" },
          context: draftContext,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("required");
      });

      it("should error when adding draft that already exists", async () => {
        // First add the draft
        await draftAddHandler.execute({
          actionParams: { id: "existing-draft", content: "# Existing\n\nContent.", description: "Existing", whenToUse: ["Testing"] },
          context: draftContext,
        });

        // Try to add again with same id
        const result = await draftAddHandler.execute({
          actionParams: { id: "existing-draft", content: "# New\n\nNew content.", description: "New", whenToUse: ["Testing"] },
          context: draftContext,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("already exists");
      });

      it("should error when reading without id", async () => {
        const result = await draftReadHandler.execute({
          actionParams: {},
          context: draftContext,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("required");
      });

      it("should error when reading non-existent draft", async () => {
        const result = await draftReadHandler.execute({
          actionParams: { id: "non-existent" },
          context: draftContext,
        });

        expect(result.isError).toBe(true);
      });

      it("should error when updating without id", async () => {
        const result = await draftUpdateHandler.execute({
          actionParams: { content: "# New" },
          context: draftContext,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("required");
      });

      it("should error when updating non-existent draft", async () => {
        const result = await draftUpdateHandler.execute({
          actionParams: { id: "non-existent", content: "# New" },
          context: draftContext,
        });

        expect(result.isError).toBe(true);
      });

      it("should error when deleting without id", async () => {
        const result = await draftDeleteHandler.execute({
          actionParams: {},
          context: draftContext,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("required");
      });

      it("should error when deleting non-existent draft", async () => {
        const result = await draftDeleteHandler.execute({
          actionParams: { id: "non-existent" },
          context: draftContext,
        });

        expect(result.isError).toBe(true);
      });

      it("should error when renaming without id", async () => {
        const result = await draftRenameHandler.execute({
          actionParams: { newId: "new-name" },
          context: draftContext,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("required");
      });

      it("should error when renaming without newId", async () => {
        await draftAddHandler.execute({
          actionParams: { id: "to-rename", content: "# Rename\n\nDocument to rename.", description: "To rename", whenToUse: ["Testing"] },
          context: draftContext,
        });

        const result = await draftRenameHandler.execute({
          actionParams: { id: "to-rename" },
          context: draftContext,
        });

        expect(result.isError).toBe(true);
      });

      it("should error when renaming to existing document", async () => {
        // Create two drafts
        await draftAddHandler.execute({
          actionParams: { id: "draft-source", content: "# Source\n\nSource.", description: "Source", whenToUse: ["Testing"] },
          context: draftContext,
        });
        await draftAddHandler.execute({
          actionParams: { id: "draft-target", content: "# Target\n\nTarget.", description: "Target", whenToUse: ["Testing"] },
          context: draftContext,
        });

        // Try to rename source to target (which already exists)
        const result = await draftRenameHandler.execute({
          actionParams: { id: "draft-source", newId: "draft-target" },
          context: draftContext,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("already exists");
      });

      it("should return message when no drafts exist", async () => {
        // Ensure no drafts exist by using a fresh directory
        const result = await draftListHandler.execute({
          context: draftContext,
        });

        // Should not be an error, just an informational message
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("No drafts found");
      });
    });

    describe("2. Apply errors", () => {
      it("should error when promoting non-existent draft", async () => {
        const result = await promoteHandler.execute({
          actionParams: { draftId: "non-existent" },
          context: applyContext,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("not found");
      });

      it("should error when promoting without draftId", async () => {
        const result = await promoteHandler.execute({
          actionParams: {},
          context: applyContext,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("required");
      });

      it("should return message when no drafts available to promote", async () => {
        const result = await applyListHandler.execute({
          context: applyContext,
        });

        // Should not be an error, just an informational message
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("No drafts available");
      });
    });
  });

  // ===================
  // D. Full Workflow
  // ===================
  describe("D. Full Workflow", () => {
    it("should complete draft → review → promote workflow", async () => {
      // Step 1: Create draft
      const addResult = await draftAddHandler.execute({
        actionParams: {
          id: "workflow-test",
          content: "# Workflow Test\n\nThis is a test document.",
          description: "Workflow test",
          whenToUse: ["Testing workflow"],
        },
        context: draftContext,
      });
      expect(addResult.isError).toBeFalsy();

      // Step 2: Verify draft can be read
      const readResult = await draftReadHandler.execute({
        actionParams: { id: "workflow-test" },
        context: draftContext,
      });
      expect(readResult.isError).toBeFalsy();
      expect(readResult.content[0].text).toContain("Workflow Test");

      // Step 3: Update draft
      const updateResult = await draftUpdateHandler.execute({
        actionParams: {
          id: "workflow-test",
          content: "# Workflow Test\n\nUpdated content after review.",
        },
        context: draftContext,
      });
      expect(updateResult.isError).toBeFalsy();

      // Step 4: Check draft appears in apply list
      const listResult = await applyListHandler.execute({
        actionParams: {},
        context: applyContext,
      });
      expect(listResult.content[0].text).toContain("workflow-test");

      // Step 5: Promote draft
      const promoteResult = await promoteHandler.execute({
        actionParams: { draftId: "workflow-test" },
        context: applyContext,
      });
      expect(promoteResult.isError).toBeFalsy();

      // Step 6: Verify draft is gone
      const draftPath = path.join(docsDir, DRAFT_DIR, "workflow-test.md");
      const draftExists = await fs.access(draftPath).then(() => true).catch(() => false);
      expect(draftExists).toBe(false);

      // Step 7: Verify confirmed doc exists with updated content
      const confirmedPath = path.join(docsDir, "workflow-test.md");
      const content = await fs.readFile(confirmedPath, "utf-8");
      expect(content).toContain("Updated content after review");
    });

    it("should handle multiple drafts independently", async () => {
      // Create multiple drafts
      await draftAddHandler.execute({
        actionParams: { id: "draft-a", content: "# Draft A\n\nFirst independent draft.", description: "Draft A", whenToUse: ["Testing"] },
        context: draftContext,
      });
      await draftAddHandler.execute({
        actionParams: { id: "draft-b", content: "# Draft B\n\nSecond independent draft.", description: "Draft B", whenToUse: ["Testing"] },
        context: draftContext,
      });
      await draftAddHandler.execute({
        actionParams: { id: "draft-c", content: "# Draft C\n\nThird independent draft.", description: "Draft C", whenToUse: ["Testing"] },
        context: draftContext,
      });

      // Promote only draft-b
      await promoteHandler.execute({
        actionParams: { draftId: "draft-b" },
        context: applyContext,
      });

      // Verify states
      const draftAExists = await fs.access(path.join(docsDir, DRAFT_DIR, "draft-a.md"))
        .then(() => true).catch(() => false);
      const draftBExists = await fs.access(path.join(docsDir, DRAFT_DIR, "draft-b.md"))
        .then(() => true).catch(() => false);
      const draftCExists = await fs.access(path.join(docsDir, DRAFT_DIR, "draft-c.md"))
        .then(() => true).catch(() => false);
      const confirmedBExists = await fs.access(path.join(docsDir, "draft-b.md"))
        .then(() => true).catch(() => false);

      expect(draftAExists).toBe(true);  // Still a draft
      expect(draftBExists).toBe(false); // Promoted
      expect(draftCExists).toBe(true);  // Still a draft
      expect(confirmedBExists).toBe(true); // Now confirmed
    });
  });

  // ===================
  // E. Help Tool (MarkdownReader)
  // ===================
  describe("E. Help Tool (MarkdownReader)", () => {
    it("should list available documents", async () => {
      // Create some docs with proper descriptions
      await fs.mkdir(path.join(docsDir, "coding"), { recursive: true });
      await fs.writeFile(path.join(docsDir, "getting-started.md"), "# Getting Started\n\nIntroduction guide.");
      await fs.writeFile(path.join(docsDir, "coding", "style.md"), "# Style Guide\n\nCoding style rules.");

      // Invalidate cache to pick up new files
      reader.invalidateCache();

      const docs = await reader.listDocuments({ recursive: true });

      expect(docs.documents.length).toBeGreaterThanOrEqual(2);
      const ids = docs.documents.map(d => d.id);
      expect(ids).toContain("getting-started");
      expect(ids).toContain("coding__style");
    });

    it("should read document content", async () => {
      await fs.writeFile(
        path.join(docsDir, "test-doc.md"),
        "# Test Document\n\nThis is test content."
      );

      // getDocumentContent doesn't use cache, reads directly
      const content = await reader.getDocumentContent("test-doc");

      expect(content).not.toBeNull();
      expect(content).toContain("Test Document");
      expect(content).toContain("test content");
    });

    it("should list documents in a category", async () => {
      await fs.mkdir(path.join(docsDir, "rules"), { recursive: true });
      await fs.writeFile(path.join(docsDir, "rules", "coding.md"), "# Coding\n\nCoding rules.");
      await fs.writeFile(path.join(docsDir, "rules", "testing.md"), "# Testing\n\nTesting rules.");

      // Invalidate cache to pick up new files
      reader.invalidateCache();

      const docs = await reader.listDocuments({ parentId: "rules", recursive: true });

      expect(docs.documents.length).toBe(2);
      const ids = docs.documents.map(d => d.id);
      expect(ids).toContain("rules__coding");
      expect(ids).toContain("rules__testing");
    });

    it("should return null for non-existent document", async () => {
      const content = await reader.getDocumentContent("non-existent-doc");
      expect(content).toBeNull();
    });
  });

  // ===================
  // F. Batch Approval Integration Tests
  // ===================
  describe("F. Batch Approval", () => {
    let approveHandler: ApproveHandler;
    let batchTestIds: string[] = [];

    // Generate unique ID for batch tests
    const getBatchId = (base: string) => {
      const id = `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      batchTestIds.push(id);
      return id;
    };

    beforeEach(() => {
      batchTestIds = [];
      approveHandler = new ApproveHandler();

      // Setup mock implementations for batch tests
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

    afterEach(() => {
      vi.clearAllMocks();
      // Clear workflow states for all IDs used in this test
      for (const id of batchTestIds) {
        draftWorkflowManager.clear({ id });
      }
    });

    /**
     * Helper to progress a draft through workflow states.
     * Clears existing state first to ensure clean starting point.
     */
    async function progressToState(
      id: string,
      targetState: "self_review" | "user_reviewing" | "pending_approval"
    ): Promise<void> {
      // Clear existing state first
      draftWorkflowManager.clear({ id });

      // Submit to self_review
      await draftWorkflowManager.trigger({
        id,
        triggerParams: { action: "submit", content: `# ${id}\n\nContent.` },
      });
      if (targetState === "self_review") return;

      // Review complete to user_reviewing
      await draftWorkflowManager.trigger({
        id,
        triggerParams: { action: "review_complete", notes: "LGTM" },
      });
      if (targetState === "user_reviewing") return;

      // Confirm to pending_approval
      await draftWorkflowManager.trigger({
        id,
        triggerParams: { action: "confirm", confirmed: true },
      });
    }

    describe("1. Batch approval workflow", () => {
      it("should complete full batch approval flow", async () => {
        const id1 = getBatchId("batch-draft");
        const id2 = getBatchId("batch-draft");

        // Create multiple drafts
        await draftAddHandler.execute({
          actionParams: { id: id1, content: "# Batch 1\n\nFirst batch draft." },
          context: draftContext,
        });
        await draftAddHandler.execute({
          actionParams: { id: id2, content: "# Batch 2\n\nSecond batch draft." },
          context: draftContext,
        });

        // Progress all to user_reviewing
        await progressToState(id1, "user_reviewing");
        await progressToState(id2, "user_reviewing");

        // Batch confirm - should transition all to pending_approval
        const confirmResult = await approveHandler.execute({
          actionParams: { ids: `${id1},${id2}`, confirmed: true },
          context: draftContext,
        });

        expect(confirmResult.isError).toBeFalsy();
        expect(confirmResult.content[0].text).toContain("Batch Approval Requested");
        expect(confirmResult.content[0].text).toContain("2 drafts");

        // Verify single notification was sent
        expect(mockRequestApproval).toHaveBeenCalledTimes(1);

        // Verify all in pending_approval
        const status1 = await draftWorkflowManager.getStatus({ id: id1 });
        const status2 = await draftWorkflowManager.getStatus({ id: id2 });
        expect(status1?.state).toBe("pending_approval");
        expect(status2?.state).toBe("pending_approval");
      });

      it("should prevent batch confirm when not all drafts ready", async () => {
        const id1 = getBatchId("batch-draft");
        const id2 = getBatchId("batch-draft");

        await draftAddHandler.execute({
          actionParams: { id: id1, content: "# Batch 1\n\nFirst draft." },
          context: draftContext,
        });
        await draftAddHandler.execute({
          actionParams: { id: id2, content: "# Batch 2\n\nSecond draft." },
          context: draftContext,
        });

        // Only progress one to user_reviewing
        await progressToState(id1, "user_reviewing");
        await progressToState(id2, "self_review");

        const result = await approveHandler.execute({
          actionParams: { ids: `${id1},${id2}`, confirmed: true },
          context: draftContext,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(id2);
        expect(result.content[0].text).toContain("self_review");

        // Verify no notification was sent
        expect(mockRequestApproval).not.toHaveBeenCalled();
      });
    });

    describe("2. Batch notification verification", () => {
      it("should call requestApproval with correct batch info", async () => {
        const id1 = getBatchId("batch-draft");
        const id2 = getBatchId("batch-draft");

        await draftAddHandler.execute({
          actionParams: { id: id1, content: "# Doc 1\n\nFirst doc." },
          context: draftContext,
        });
        await draftAddHandler.execute({
          actionParams: { id: id2, content: "# Doc 2\n\nSecond doc." },
          context: draftContext,
        });

        await progressToState(id1, "user_reviewing");
        await progressToState(id2, "user_reviewing");

        await approveHandler.execute({
          actionParams: { ids: `${id1},${id2}`, confirmed: true },
          context: draftContext,
        });

        // Verify requestApproval was called with batch info
        expect(mockRequestApproval).toHaveBeenCalledWith(
          expect.objectContaining({
            request: expect.objectContaining({
              operation: "Batch Draft Approval",
              description: expect.stringContaining("2 drafts"),
            }),
          })
        );
      });
    });

    describe("3. Edge cases", () => {
      it("should handle single draft in batch mode", async () => {
        const id = getBatchId("batch-draft");

        await draftAddHandler.execute({
          actionParams: { id, content: "# Single\n\nSingle draft." },
          context: draftContext,
        });
        await progressToState(id, "user_reviewing");

        const result = await approveHandler.execute({
          actionParams: { ids: id, confirmed: true },
          context: draftContext,
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("1 drafts");
      });

      it("should handle whitespace in ids parameter", async () => {
        const id1 = getBatchId("batch-draft");
        const id2 = getBatchId("batch-draft");

        await draftAddHandler.execute({
          actionParams: { id: id1, content: "# WS1\n\nDraft with whitespace." },
          context: draftContext,
        });
        await draftAddHandler.execute({
          actionParams: { id: id2, content: "# WS2\n\nAnother draft." },
          context: draftContext,
        });
        await progressToState(id1, "user_reviewing");
        await progressToState(id2, "user_reviewing");

        // IDs with extra whitespace
        const result = await approveHandler.execute({
          actionParams: { ids: `  ${id1} , ${id2}  `, confirmed: true },
          context: draftContext,
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("2 drafts");
      });
    });
  });
});
