import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MarkdownReader } from "../services/markdown-reader.js";
import type { ReminderConfig } from "../types/index.js";
import type { InstructionContext } from "../tools/instruction/types.js";
import { DRAFT_DIR } from "../constants.js";

// All handlers from instruction
import {
  ListHandler,
  ReadHandler,
  AddHandler,
  UpdateHandler,
  DeleteHandler,
  RenameHandler,
  ApplyHandler,
  ApproveHandler,
} from "../tools/instruction/handlers/index.js";
import { draftWorkflowManager } from "../workflows/draft-workflow.js";

// Import mocked functions from mcp-shared (mocked globally in vitest-setup.ts)
import { requestApproval, validateApproval } from "mcp-shared/approval";

// Get references to the mocked functions
const mockRequestApproval = vi.mocked(requestApproval);
const mockValidateApproval = vi.mocked(validateApproval);

const tempBase = path.join(process.cwd(), "src/__tests__/temp-integration");
const docsDir = tempBase; // Single directory for both docs and drafts

describe("Integration Tests", () => {
  let reader: MarkdownReader;
  let context: InstructionContext;

  // Handlers
  let listHandler: ListHandler;
  let readHandler: ReadHandler;
  let addHandler: AddHandler;
  let updateHandler: UpdateHandler;
  let deleteHandler: DeleteHandler;
  let renameHandler: RenameHandler;
  let applyHandler: ApplyHandler;

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

    context = {
      reader,
      config: defaultConfig,
    };

    // Initialize handlers
    listHandler = new ListHandler();
    readHandler = new ReadHandler();
    addHandler = new AddHandler();
    updateHandler = new UpdateHandler();
    deleteHandler = new DeleteHandler();
    renameHandler = new RenameHandler();
    applyHandler = new ApplyHandler();
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
        const result = await addHandler.execute({
          rawParams: {
            action: "add",
            id: "coding-style",
            content: "# Coding Style\n\nUse consistent formatting.",
            description: "Coding style guidelines",
            whenToUse: ["Writing new code"],
          },
          context: context,
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("created successfully");

        // Verify file exists in _mcp_drafts directory with prefix
        const filePath = path.join(docsDir, DRAFT_DIR, "coding-style.md");
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        expect(exists).toBe(true);
      });

      it("should list drafts via read", async () => {
        // Add some drafts
        await addHandler.execute({
          rawParams: { action: "add", id: "draft1", content: "# Draft 1\n\nFirst draft description.", description: "First draft", whenToUse: ["Testing"] },
          context: context,
        });
        await addHandler.execute({
          rawParams: { action: "add", id: "draft2", content: "# Draft 2\n\nSecond draft description.", description: "Second draft", whenToUse: ["Testing"] },
          context: context,
        });

        // ListHandler filters out drafts from public listing by design.
        // Verify drafts exist by reading them directly.
        const read1 = await readHandler.execute({
          rawParams: { action: "read", id: "draft1" },
          context: context,
        });
        const read2 = await readHandler.execute({
          rawParams: { action: "read", id: "draft2" },
          context: context,
        });

        expect(read1.isError).toBeFalsy();
        expect(read1.content[0].text).toContain("Draft 1");
        expect(read2.isError).toBeFalsy();
        expect(read2.content[0].text).toContain("Draft 2");
      });

      it("should read a draft", async () => {
        await addHandler.execute({
          rawParams: { action: "add", id: "test-read", content: "# Test Content\n\nSome text here.", description: "Test content", whenToUse: ["Testing"] },
          context: context,
        });

        const result = await readHandler.execute({
          rawParams: { action: "read", id: "test-read" },
          context: context,
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("Test Content");
        expect(result.content[0].text).toContain("Some text here");
      });

      it("should update an existing document", async () => {
        // Create existing document (not draft)
        await fs.writeFile(
          path.join(docsDir, "to-update.md"),
          "# Original\n\nOriginal content."
        );

        const result = await updateHandler.execute({
          rawParams: { action: "update", id: "to-update", content: "# Updated Content\n\nThis has been updated." },
          context: context,
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("Update prepared");
        expect(result.content[0].text).toContain("```diff");
      });

      it("should return error when updating non-existent document", async () => {
        const result = await updateHandler.execute({
          rawParams: { action: "update", id: "non-existent", content: "# New\n\nNew content." },
          context: context,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Document "non-existent" does not exist');
        expect(result.content[0].text).toContain('instruction(action: "add"');
      });

      it("should delete a draft", async () => {
        await addHandler.execute({
          rawParams: { action: "add", id: "to-delete", content: "# Delete Me\n\nThis will be deleted.", description: "To delete", whenToUse: ["Testing"] },
          context: context,
        });

        const result = await deleteHandler.execute({
          rawParams: { action: "delete", id: "to-delete" },
          context: context,
        });

        expect(result.isError).toBeFalsy();

        // Verify file is gone
        const filePath = path.join(docsDir, DRAFT_DIR, "to-delete.md");
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        expect(exists).toBe(false);
      });

      it("should rename a draft", async () => {
        await addHandler.execute({
          rawParams: { action: "add", id: "old-name", content: "# Rename Me\n\nThis will be renamed.", description: "Old name", whenToUse: ["Testing"] },
          context: context,
        });

        const result = await renameHandler.execute({
          rawParams: { action: "rename", id: "old-name", newId: "new-name" },
          context: context,
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
        await addHandler.execute({
          rawParams: { action: "add", id: "coding__style", content: "# Style\n\nCoding style guidelines.", description: "Style guide", whenToUse: ["Coding"] },
          context: context,
        });
        await addHandler.execute({
          rawParams: { action: "add", id: "coding__testing", content: "# Testing\n\nTesting guidelines.", description: "Testing guide", whenToUse: ["Testing"] },
          context: context,
        });

        // Check directory structure
        const codingDir = path.join(docsDir, DRAFT_DIR, "coding");
        const exists = await fs.access(codingDir).then(() => true).catch(() => false);
        expect(exists).toBe(true);

        // Verify both drafts can be read (ListHandler filters out drafts)
        const read1 = await readHandler.execute({
          rawParams: { action: "read", id: "coding__style" },
          context: context,
        });
        const read2 = await readHandler.execute({
          rawParams: { action: "read", id: "coding__testing" },
          context: context,
        });
        expect(read1.isError).toBeFalsy();
        expect(read1.content[0].text).toContain("Style");
        expect(read2.isError).toBeFalsy();
        expect(read2.content[0].text).toContain("Testing");
      });
    });
  });

  // ===================
  // B. Approve Workflow Tests
  // ===================
  describe("B. Approve Workflow", () => {
    let approveHandler: ApproveHandler;

    beforeEach(() => {
      approveHandler = new ApproveHandler();

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
    });

    describe("1. Approve requires self-review notes first", () => {
      it("should require notes when in self_review state", async () => {
        // Create draft
        await addHandler.execute({
          rawParams: { action: "add", id: "rules", content: "# Rules\n\nFollow these rules.", description: "Rules", whenToUse: ["Following rules"] },
          context: context,
        });

        // Submit to self_review
        await draftWorkflowManager.trigger({
          id: "rules",
          triggerParams: { action: "submit", content: "# Rules\n\nFollow these rules." },
        });

        // Try approve without notes - should fail
        const result = await approveHandler.execute({
          rawParams: { action: "approve", id: "rules" },
          context: context,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("notes");
      });
    });

    describe("2. List drafts", () => {
      it("should verify drafts exist via read", async () => {
        await addHandler.execute({
          rawParams: { action: "add", id: "ready1", content: "# Ready 1\n\nFirst ready draft.", description: "Ready 1", whenToUse: ["Testing"] },
          context: context,
        });
        await addHandler.execute({
          rawParams: { action: "add", id: "ready2", content: "# Ready 2\n\nSecond ready draft.", description: "Ready 2", whenToUse: ["Testing"] },
          context: context,
        });

        // ListHandler filters out drafts from public listing by design.
        // Verify drafts exist by reading them directly.
        const read1 = await readHandler.execute({
          rawParams: { action: "read", id: "ready1" },
          context: context,
        });
        const read2 = await readHandler.execute({
          rawParams: { action: "read", id: "ready2" },
          context: context,
        });

        expect(read1.isError).toBeFalsy();
        expect(read1.content[0].text).toContain("Ready 1");
        expect(read2.isError).toBeFalsy();
        expect(read2.content[0].text).toContain("Ready 2");
      });
    });
  });

  // ===================
  // C. Error Cases
  // ===================
  describe("C. Error Cases", () => {
    describe("1. Draft errors", () => {
      it("should error when adding draft without id", async () => {
        const result = await addHandler.execute({
          rawParams: { action: "add", content: "# No ID" },
          context: context,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Required");
      });

      it("should error when adding draft without content", async () => {
        const result = await addHandler.execute({
          rawParams: { action: "add", id: "no-content" },
          context: context,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Required");
      });

      it("should error when adding draft that already exists", async () => {
        // First add the draft
        await addHandler.execute({
          rawParams: { action: "add", id: "existing-draft", content: "# Existing\n\nContent.", description: "Existing", whenToUse: ["Testing"] },
          context: context,
        });

        // Try to add again with same id
        const result = await addHandler.execute({
          rawParams: { action: "add", id: "existing-draft", content: "# New\n\nNew content.", description: "New", whenToUse: ["Testing"] },
          context: context,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("already exists");
      });

      it("should error when reading without id", async () => {
        const result = await readHandler.execute({
          rawParams: { action: "read" },
          context: context,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Required");
      });

      it("should error when reading non-existent draft", async () => {
        const result = await readHandler.execute({
          rawParams: { action: "read", id: "non-existent" },
          context: context,
        });

        expect(result.isError).toBe(true);
      });

      it("should error when updating without id", async () => {
        const result = await updateHandler.execute({
          rawParams: { action: "update", content: "# New" },
          context: context,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Required");
      });

      it("should error when updating non-existent draft", async () => {
        const result = await updateHandler.execute({
          rawParams: { action: "update", id: "non-existent", content: "# New" },
          context: context,
        });

        expect(result.isError).toBe(true);
      });

      it("should error when deleting without id", async () => {
        const result = await deleteHandler.execute({
          rawParams: { action: "delete" },
          context: context,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Required");
      });

      it("should error when deleting non-existent draft", async () => {
        const result = await deleteHandler.execute({
          rawParams: { action: "delete", id: "non-existent" },
          context: context,
        });

        expect(result.isError).toBe(true);
      });

      it("should error when renaming without id", async () => {
        const result = await renameHandler.execute({
          rawParams: { action: "rename", newId: "new-name" },
          context: context,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Required");
      });

      it("should error when renaming without newId", async () => {
        await addHandler.execute({
          rawParams: { action: "add", id: "to-rename", content: "# Rename\n\nDocument to rename.", description: "To rename", whenToUse: ["Testing"] },
          context: context,
        });

        const result = await renameHandler.execute({
          rawParams: { action: "rename", id: "to-rename" },
          context: context,
        });

        expect(result.isError).toBe(true);
      });

      it("should error when renaming to existing document", async () => {
        // Create two drafts
        await addHandler.execute({
          rawParams: { action: "add", id: "draft-source", content: "# Source\n\nSource.", description: "Source", whenToUse: ["Testing"] },
          context: context,
        });
        await addHandler.execute({
          rawParams: { action: "add", id: "draft-target", content: "# Target\n\nTarget.", description: "Target", whenToUse: ["Testing"] },
          context: context,
        });

        // Try to rename source to target (which already exists)
        const result = await renameHandler.execute({
          rawParams: { action: "rename", id: "draft-source", newId: "draft-target" },
          context: context,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("already exists");
      });

      it("should return message when no drafts exist", async () => {
        // Ensure no drafts exist by using a fresh directory
        const result = await listHandler.execute({
          rawParams: { action: "list" },
          context: context,
        });

        // Should not be an error, just an informational message
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("No markdown documents found");
      });
    });

    describe("2. Approve errors", () => {
      it("should error when approving without id", async () => {
        const approveHandler = new ApproveHandler();
        const result = await approveHandler.execute({
          rawParams: { action: "approve" },
          context: context,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("required");
      });

      it("should error when applying non-existent pending update", async () => {
        const result = await applyHandler.execute({
          rawParams: { action: "apply", id: "non-existent", explanation: "test: applies the staged update" },
          context: context,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("No pending update");
      });
    });
  });

  // ===================
  // D. Full Workflow
  // ===================
  describe("D. Full Workflow", () => {
    it("should complete draft → read → list workflow", async () => {
      // Step 1: Create draft
      const addResult = await addHandler.execute({
        rawParams: {
          action: "add",
          id: "workflow-test",
          content: "# Workflow Test\n\nThis is a test document.",
          description: "Workflow test",
          whenToUse: ["Testing workflow"],
        },
        context: context,
      });
      expect(addResult.isError).toBeFalsy();

      // Step 2: Verify draft can be read
      const readResult = await readHandler.execute({
        rawParams: { action: "read", id: "workflow-test" },
        context: context,
      });
      expect(readResult.isError).toBeFalsy();
      expect(readResult.content[0].text).toContain("Workflow Test");

      // Step 3: Verify draft file exists (ListHandler filters out drafts from public listing)
      const draftFilePath = path.join(docsDir, DRAFT_DIR, "workflow-test.md");
      const draftFileExists = await fs.access(draftFilePath).then(() => true).catch(() => false);
      expect(draftFileExists).toBe(true);

      // Step 4: Verify draft file exists
      const draftPath = path.join(docsDir, DRAFT_DIR, "workflow-test.md");
      const draftExists = await fs.access(draftPath).then(() => true).catch(() => false);
      expect(draftExists).toBe(true);
    });

    it("should handle multiple drafts independently", async () => {
      // Create multiple drafts
      await addHandler.execute({
        rawParams: { action: "add", id: "draft-a", content: "# Draft A\n\nFirst independent draft.", description: "Draft A", whenToUse: ["Testing"] },
        context: context,
      });
      await addHandler.execute({
        rawParams: { action: "add", id: "draft-b", content: "# Draft B\n\nSecond independent draft.", description: "Draft B", whenToUse: ["Testing"] },
        context: context,
      });
      await addHandler.execute({
        rawParams: { action: "add", id: "draft-c", content: "# Draft C\n\nThird independent draft.", description: "Draft C", whenToUse: ["Testing"] },
        context: context,
      });

      // Delete only draft-b
      await deleteHandler.execute({
        rawParams: { action: "delete", id: "draft-b" },
        context: context,
      });

      // Verify states
      const draftAExists = await fs.access(path.join(docsDir, DRAFT_DIR, "draft-a.md"))
        .then(() => true).catch(() => false);
      const draftBExists = await fs.access(path.join(docsDir, DRAFT_DIR, "draft-b.md"))
        .then(() => true).catch(() => false);
      const draftCExists = await fs.access(path.join(docsDir, DRAFT_DIR, "draft-c.md"))
        .then(() => true).catch(() => false);

      expect(draftAExists).toBe(true);  // Still a draft
      expect(draftBExists).toBe(false); // Deleted
      expect(draftCExists).toBe(true);  // Still a draft
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
        await addHandler.execute({
          rawParams: { action: "add", id: id1, content: "# Batch 1\n\nFirst batch draft." },
          context: context,
        });
        await addHandler.execute({
          rawParams: { action: "add", id: id2, content: "# Batch 2\n\nSecond batch draft." },
          context: context,
        });

        // Progress all to user_reviewing
        await progressToState(id1, "user_reviewing");
        await progressToState(id2, "user_reviewing");

        // Batch confirm - should transition all to pending_approval
        const confirmResult = await approveHandler.execute({
          rawParams: { action: "approve", ids: `${id1},${id2}`, confirmed: true },
          context: context,
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

        await addHandler.execute({
          rawParams: { action: "add", id: id1, content: "# Batch 1\n\nFirst draft." },
          context: context,
        });
        await addHandler.execute({
          rawParams: { action: "add", id: id2, content: "# Batch 2\n\nSecond draft." },
          context: context,
        });

        // Only progress one to user_reviewing
        await progressToState(id1, "user_reviewing");
        await progressToState(id2, "self_review");

        const result = await approveHandler.execute({
          rawParams: { action: "approve", ids: `${id1},${id2}`, confirmed: true },
          context: context,
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

        await addHandler.execute({
          rawParams: { action: "add", id: id1, content: "# Doc 1\n\nFirst doc." },
          context: context,
        });
        await addHandler.execute({
          rawParams: { action: "add", id: id2, content: "# Doc 2\n\nSecond doc." },
          context: context,
        });

        await progressToState(id1, "user_reviewing");
        await progressToState(id2, "user_reviewing");

        await approveHandler.execute({
          rawParams: { action: "approve", ids: `${id1},${id2}`, confirmed: true },
          context: context,
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

        await addHandler.execute({
          rawParams: { action: "add", id, content: "# Single\n\nSingle draft." },
          context: context,
        });
        await progressToState(id, "user_reviewing");

        const result = await approveHandler.execute({
          rawParams: { action: "approve", ids: id, confirmed: true },
          context: context,
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("1 drafts");
      });

      it("should handle whitespace in ids parameter", async () => {
        const id1 = getBatchId("batch-draft");
        const id2 = getBatchId("batch-draft");

        await addHandler.execute({
          rawParams: { action: "add", id: id1, content: "# WS1\n\nDraft with whitespace." },
          context: context,
        });
        await addHandler.execute({
          rawParams: { action: "add", id: id2, content: "# WS2\n\nAnother draft." },
          context: context,
        });
        await progressToState(id1, "user_reviewing");
        await progressToState(id2, "user_reviewing");

        // IDs with extra whitespace
        const result = await approveHandler.execute({
          rawParams: { action: "approve", ids: `  ${id1} , ${id2}  `, confirmed: true },
          context: context,
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain("2 drafts");
      });
    });
  });
});
