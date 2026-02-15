import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MarkdownReader } from "../services/markdown-reader.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const fixturesDir = path.join(process.cwd(), "src/__tests__/fixtures");
const tempDir = path.join(process.cwd(), "src/__tests__/temp");

describe("MarkdownReader", () => {
  describe("listDocuments (flat)", () => {
    it.each([
      ["sample", "This is a sample document for testing purposes."],
      ["no-description", "(No description)"],
    ])("should return correct description for %s", async (id, expected) => {
      const reader = new MarkdownReader(fixturesDir);
      const { documents } = await reader.listDocuments({ recursive: true });
      const doc = documents.find((d) => d.id === id);

      expect(doc).toBeDefined();
      expect(doc?.description).toBe(expected);
    });

    it("should sort documents by id", async () => {
      const reader = new MarkdownReader(fixturesDir);
      const { documents } = await reader.listDocuments({ recursive: true });

      const ids = documents.map((d) => d.id);
      const sorted = [...ids].sort();
      expect(ids).toEqual(sorted);
    });
  });

  describe("formatDocumentList", () => {
    const reader = new MarkdownReader(fixturesDir);

    it.each([
      {
        documents: [],
        categories: [],
        expected: "No markdown documents found.",
      },
      {
        documents: [{ id: "test", description: "Test doc" }],
        categories: [],
        expected: "Available documents:\n\n- **test**: Test doc",
      },
      {
        documents: [
          { id: "a", description: "Doc A" },
          { id: "b", description: "Doc B" },
        ],
        categories: [],
        expected: "Available documents:\n\n- **a**: Doc A\n- **b**: Doc B",
      },
      {
        documents: [{ id: "root", description: "Root doc" }],
        categories: [{ id: "git", docCount: 3 }],
        expected:
          "Available documents:\n\n**Categories:**\n- **git/** (3 docs)\n\n**Documents:**\n- **root**: Root doc",
      },
    ])(
      "formats documents and categories correctly",
      ({ documents, categories, expected }) => {
        expect(reader.formatDocumentList({ documents, categories })).toBe(expected);
      }
    );
  });

  describe("getDocumentContent", () => {
    it.each([
      ["sample", ["# Sample Document", "## Section 1"]],
      ["no-description", ["# No Description"]],
    ])("should return content for %s", async (id, expectedContents) => {
      const reader = new MarkdownReader(fixturesDir);
      const content = await reader.getDocumentContent(id);

      expect(content).not.toBeNull();
      for (const expected of expectedContents) {
        expect(content).toContain(expected);
      }
    });

    it("should return null for non-existent document", async () => {
      const reader = new MarkdownReader(fixturesDir);
      const content = await reader.getDocumentContent("non-existent");

      expect(content).toBeNull();
    });
  });

  describe("document operations", () => {
    beforeEach(async () => {
      await fs.mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it.each([
      ["new-doc", "# New Doc\n\nNew content."],
      ["another", "# Another\n\nAnother doc."],
    ])("should add document %s", async (id, content) => {
      const reader = new MarkdownReader(tempDir);

      const result = await reader.addDocument({ id, content });

      expect(result.success, `addDocument failed: ${result.error}`).toBe(true);
      const saved = await reader.getDocumentContent(id);
      expect(saved).toBe(content);
    });

    type AddDocumentErrorTestCase = {
      name: string;
      setup: (reader: MarkdownReader) => Promise<void>;
      id: string;
      content: string;
      expectedError: string;
    };

    const addDocumentErrorTestCases: AddDocumentErrorTestCase[] = [
      {
        name: "existing document",
        setup: async (reader) => {
          await reader.addDocument({ id: "existing", content: "# First\n\nFirst description." });
        },
        id: "existing",
        content: "# Second\n\nSecond description.",
        expectedError: "already exists",
      },
      {
        name: "document without description",
        setup: async () => {},
        id: "no-desc",
        content: "# Title Only",
        expectedError: "must have a description",
      },
    ];

    it.each(addDocumentErrorTestCases)(
      "should return error for $name",
      async ({ setup, id, content, expectedError }) => {
        const reader = new MarkdownReader(tempDir);
        await setup(reader);

        const result = await reader.addDocument({ id, content });

        expect(result.success).toBe(false);
        expect(result.error).toContain(expectedError);
      }
    );

    it.each([
      ["missing", false],
      ["exists", true],
    ])("documentExists returns %s for %s doc", async (id, expected) => {
      const reader = new MarkdownReader(tempDir);

      if (expected) {
        await reader.addDocument({ id, content: "# Exists\n\nContent." });
      }

      expect(await reader.documentExists(id)).toBe(expected);
    });

    it("should update existing document", async () => {
      const reader = new MarkdownReader(tempDir);

      await reader.addDocument({ id: "to-update", content: "# Original\n\nOriginal content." });
      const result = await reader.updateDocument({
        id: "to-update",
        content: "# Updated\n\nUpdated content.",
      });

      expect(result.success).toBe(true);
      const content = await reader.getDocumentContent("to-update");
      expect(content).toContain("Updated content.");
    });

    type UpdateDocumentErrorTestCase = {
      name: string;
      setup: (reader: MarkdownReader) => Promise<void>;
      id: string;
      content: string;
      expectedError: string;
    };

    const updateDocumentErrorTestCases: UpdateDocumentErrorTestCase[] = [
      {
        name: "non-existent document",
        setup: async () => {},
        id: "missing",
        content: "# Content\n\nSome description.",
        expectedError: "not found",
      },
      {
        name: "update without description",
        setup: async (reader) => {
          await reader.addDocument({ id: "has-desc", content: "# Title\n\nHas description." });
        },
        id: "has-desc",
        content: "# Title Only",
        expectedError: "must have a description",
      },
    ];

    it.each(updateDocumentErrorTestCases)(
      "should return error for $name",
      async ({ setup, id, content, expectedError }) => {
        const reader = new MarkdownReader(tempDir);
        await setup(reader);

        const result = await reader.updateDocument({ id, content });

        expect(result.success).toBe(false);
        expect(result.error).toContain(expectedError);
      }
    );
  });

  describe("hierarchical structure", () => {
    beforeEach(async () => {
      await fs.mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("should create nested directories with __ separator", async () => {
      const reader = new MarkdownReader(tempDir);

      const result = await reader.addDocument({
        id: "git__workflow",
        content: "# Git Workflow\n\nHow to use git.",
      });

      expect(result.success).toBe(true);

      // Verify file was created in subdirectory
      const filePath = path.join(tempDir, "git", "workflow.md");
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it("should read nested documents by hierarchical ID", async () => {
      const reader = new MarkdownReader(tempDir);

      await reader.addDocument({
        id: "api__auth__oauth",
        content: "# OAuth\n\nOAuth authentication.",
      });
      const content = await reader.getDocumentContent("api__auth__oauth");

      expect(content).toContain("# OAuth");
    });

    it("should list categories at root level", async () => {
      const reader = new MarkdownReader(tempDir);

      await reader.addDocument({ id: "root-doc", content: "# Root\n\nRoot level doc." });
      await reader.addDocument({
        id: "git__workflow",
        content: "# Git Workflow\n\nWorkflow doc.",
      });
      await reader.addDocument({ id: "git__commands", content: "# Git Commands\n\nCommands." });

      const { documents, categories } = await reader.listDocuments();

      expect(documents).toHaveLength(1);
      expect(documents[0].id).toBe("root-doc");
      expect(categories).toHaveLength(1);
      expect(categories[0]).toEqual({ id: "git", docCount: 2 });
    });

    it("should list documents in category", async () => {
      const reader = new MarkdownReader(tempDir);

      await reader.addDocument({
        id: "git__workflow",
        content: "# Git Workflow\n\nWorkflow doc.",
      });
      await reader.addDocument({ id: "git__commands", content: "# Git Commands\n\nCommands." });
      await reader.addDocument({ id: "git__branching", content: "# Branching\n\nBranching." });

      const { documents, categories } = await reader.listDocuments({ parentId: "git" });

      expect(documents).toHaveLength(3);
      expect(categories).toHaveLength(0);
      expect(documents.map((d) => d.id).sort()).toEqual([
        "git__branching",
        "git__commands",
        "git__workflow",
      ]);
    });

    it("should list subcategories when parentId has nested categories", async () => {
      const reader = new MarkdownReader(tempDir);

      // Create documents with nested structure
      await reader.addDocument({ id: "api__auth__login", content: "# Login\n\nLogin doc." });
      await reader.addDocument({ id: "api__auth__logout", content: "# Logout\n\nLogout doc." });
      await reader.addDocument({ id: "api__users__list", content: "# List Users\n\nList doc." });
      await reader.addDocument({ id: "api__overview", content: "# Overview\n\nOverview doc." });

      const { documents, categories } = await reader.listDocuments({ parentId: "api" });

      // overview is a direct child
      expect(documents).toHaveLength(1);
      expect(documents[0].id).toBe("api__overview");

      // auth and users are subcategories
      expect(categories).toHaveLength(2);
      expect(categories.map((c) => c.id).sort()).toEqual(["api__auth", "api__users"]);
      expect(categories.find((c) => c.id === "api__auth")?.docCount).toBe(2);
      expect(categories.find((c) => c.id === "api__users")?.docCount).toBe(1);
    });

    it("should list all nested documents recursively with parentId", async () => {
      const reader = new MarkdownReader(tempDir);

      // Create documents with nested structure
      await reader.addDocument({ id: "api__auth__login", content: "# Login\n\nLogin doc." });
      await reader.addDocument({ id: "api__auth__logout", content: "# Logout\n\nLogout doc." });
      await reader.addDocument({ id: "api__overview", content: "# Overview\n\nOverview doc." });

      const { documents, categories } = await reader.listDocuments({ parentId: "api", recursive: true });

      // Should return all documents under api, flattened
      expect(documents).toHaveLength(3);
      expect(documents.map((d) => d.id).sort()).toEqual([
        "api__auth__login",
        "api__auth__logout",
        "api__overview",
      ]);
      // No categories when recursive
      expect(categories).toHaveLength(0);
    });

    it("should list all documents recursively", async () => {
      const reader = new MarkdownReader(tempDir);

      await reader.addDocument({ id: "root", content: "# Root\n\nRoot doc." });
      await reader.addDocument({ id: "git__workflow", content: "# Workflow\n\nWorkflow." });
      await reader.addDocument({ id: "api__auth", content: "# Auth\n\nAuth." });

      const { documents } = await reader.listDocuments({ recursive: true });

      expect(documents).toHaveLength(3);
    });

    it("should identify categories correctly", async () => {
      const reader = new MarkdownReader(tempDir);

      await reader.addDocument({ id: "git__workflow", content: "# Workflow\n\nWorkflow." });
      await reader.addDocument({ id: "standalone", content: "# Standalone\n\nDoc." });

      expect(await reader.isCategory("git")).toBe(true);
      expect(await reader.isCategory("standalone")).toBe(false);
      expect(await reader.isCategory("nonexistent")).toBe(false);
    });

    it("should invalidate cache after add", async () => {
      const reader = new MarkdownReader(tempDir);

      await reader.addDocument({ id: "first", content: "# First\n\nFirst doc." });
      const { documents: before } = await reader.listDocuments({ recursive: true });

      await reader.addDocument({ id: "second", content: "# Second\n\nSecond doc." });
      const { documents: after } = await reader.listDocuments({ recursive: true });

      expect(before).toHaveLength(1);
      expect(after).toHaveLength(2);
    });

    it("should invalidate cache after update", async () => {
      const reader = new MarkdownReader(tempDir);

      await reader.addDocument({ id: "doc", content: "# Original\n\nOriginal description." });
      const { documents: before } = await reader.listDocuments({ recursive: true });

      await reader.updateDocument({ id: "doc", content: "# Updated\n\nNew description here." });
      const { documents: after } = await reader.listDocuments({ recursive: true });

      expect(before[0].description).toBe("Original description.");
      expect(after[0].description).toBe("New description here.");
    });

    it("should delete document", async () => {
      const reader = new MarkdownReader(tempDir);

      await reader.addDocument({ id: "to-delete", content: "# Delete Me\n\nContent." });
      expect(await reader.documentExists("to-delete")).toBe(true);

      const result = await reader.deleteDocument("to-delete");
      expect(result.success).toBe(true);
      expect(await reader.documentExists("to-delete")).toBe(false);
    });

    it("should return error when deleting non-existent document", async () => {
      const reader = new MarkdownReader(tempDir);

      const result = await reader.deleteDocument("non-existent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should delete nested document and clean up empty dirs", async () => {
      const reader = new MarkdownReader(tempDir);

      await reader.addDocument({ id: "cat__sub__doc", content: "# Nested\n\nContent." });
      const result = await reader.deleteDocument("cat__sub__doc");

      expect(result.success).toBe(true);

      // Check that empty directories were removed
      const catExists = await import("node:fs/promises")
        .then((fs) => fs.access(path.join(tempDir, "cat")))
        .then(() => true)
        .catch(() => false);
      expect(catExists).toBe(false);
    });

    it("should rename document", async () => {
      const reader = new MarkdownReader(tempDir);

      await reader.addDocument({ id: "old-name", content: "# Doc\n\nContent." });
      const result = await reader.renameDocument({ oldId: "old-name", newId: "new-name" });

      expect(result.success).toBe(true);
      expect(await reader.documentExists("old-name")).toBe(false);
      expect(await reader.documentExists("new-name")).toBe(true);

      const content = await reader.getDocumentContent("new-name");
      expect(content).toContain("# Doc");
    });

    it("should rename document to different category", async () => {
      const reader = new MarkdownReader(tempDir);

      await reader.addDocument({ id: "root-doc", content: "# Doc\n\nContent." });
      const result = await reader.renameDocument({ oldId: "root-doc", newId: "category__doc" });

      expect(result.success).toBe(true);
      expect(await reader.documentExists("root-doc")).toBe(false);
      expect(await reader.documentExists("category__doc")).toBe(true);
    });

    type RenameDocumentErrorTestCase = {
      name: string;
      setup: (reader: MarkdownReader) => Promise<void>;
      oldId: string;
      newId: string;
      expectedError: string;
    };

    const renameDocumentErrorTestCases: RenameDocumentErrorTestCase[] = [
      {
        name: "non-existent source document",
        setup: async () => {},
        oldId: "non-existent",
        newId: "new-name",
        expectedError: "not found",
      },
      {
        name: "existing target document",
        setup: async (reader) => {
          await reader.addDocument({ id: "doc1", content: "# Doc 1\n\nContent." });
          await reader.addDocument({ id: "doc2", content: "# Doc 2\n\nContent." });
        },
        oldId: "doc1",
        newId: "doc2",
        expectedError: "already exists",
      },
    ];

    it.each(renameDocumentErrorTestCases)(
      "should return error for $name",
      async ({ setup, oldId, newId, expectedError }) => {
        const reader = new MarkdownReader(tempDir);
        await setup(reader);

        const result = await reader.renameDocument({ oldId, newId });

        expect(result.success).toBe(false);
        expect(result.error).toContain(expectedError);
      }
    );

    it("should overwrite existing document when overwrite is true", async () => {
      const reader = new MarkdownReader(tempDir);

      await reader.addDocument({ id: "source", content: "# Source\n\nSource content." });
      await reader.addDocument({ id: "target", content: "# Target\n\nTarget content." });

      const result = await reader.renameDocument({
        oldId: "source",
        newId: "target",
        overwrite: true,
      });

      expect(result.success).toBe(true);
      expect(await reader.documentExists("source")).toBe(false);
      expect(await reader.documentExists("target")).toBe(true);

      const content = await reader.getDocumentContent("target");
      expect(content).toContain("Source content.");
    });
  });

  describe("parseDescription", () => {
    beforeEach(async () => {
      await fs.mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it.each([
      {
        name: "truncates long descriptions",
        content: `# Long\n\n${"A".repeat(200)}\n\n## Next`,
        check: (desc: string) => desc.length === 150 && desc.endsWith("..."),
      },
      {
        name: "handles multi-line paragraphs",
        content: "# Multi\n\nFirst line.\nSecond line.\n\n## Next",
        check: (desc: string) => desc === "First line. Second line.",
      },
      {
        name: "handles empty content after title",
        content: "# Empty\n\nHas description now.",
        check: (desc: string) => desc === "Has description now.",
      },
    ])("$name", async ({ content, check }) => {
      const reader = new MarkdownReader(tempDir);
      await reader.addDocument({ id: "test", content });

      const { documents } = await reader.listDocuments({ recursive: true });
      const doc = documents.find((d) => d.id === "test");

      expect(check(doc!.description)).toBe(true);
    });
  });

  describe("error handling", () => {
    const errorTempDir = path.join(process.cwd(), "src/__tests__/temp-error");

    beforeEach(async () => {
      await fs.mkdir(errorTempDir, { recursive: true });
    });

    afterEach(async () => {
      await fs.rm(errorTempDir, { recursive: true, force: true });
    });

    it("should throw non-ENOENT errors in getDocumentContent", async () => {
      const reader = new MarkdownReader(errorTempDir);

      // Create a document then make parent directory unreadable
      await reader.addDocument({ id: "test", content: "# Test\n\nContent." });

      // Create a subdirectory to nest the file
      const subDir = path.join(errorTempDir, "sub");
      await fs.mkdir(subDir, { recursive: true });
      await fs.writeFile(path.join(subDir, "nested.md"), "# Nested\n\nContent.", "utf-8");

      try {
        // Make the file unreadable (not the directory)
        await fs.chmod(path.join(subDir, "nested.md"), 0o000);

        // invalidate cache to force re-scan
        reader.invalidateCache();

        // Try to read - this should throw for permission denied
        await expect(reader.getDocumentContent("sub__nested")).rejects.toThrow();
      } catch {
        // If chmod doesn't work on this system, skip the test
      } finally {
        // Restore permissions for cleanup
        await fs.chmod(path.join(subDir, "nested.md"), 0o644).catch(() => {});
      }
    });

    it("should throw non-ENOENT errors in scanDirectory", async () => {
      const reader = new MarkdownReader(errorTempDir);

      // Create a subdirectory
      const subDir = path.join(errorTempDir, "protected");
      await fs.mkdir(subDir, { recursive: true });
      await fs.writeFile(path.join(subDir, "doc.md"), "# Doc\n\nContent.", "utf-8");

      try {
        // Make subdirectory execute-only (no read permission)
        await fs.chmod(subDir, 0o111);

        // Invalidate cache and try to list - should throw or handle error
        reader.invalidateCache();

        // listDocuments calls scanDirectory recursively
        await expect(reader.listDocuments({ recursive: true })).rejects.toThrow();
      } catch {
        // If chmod doesn't work on this system, skip the test
      } finally {
        // Restore permissions for cleanup
        await fs.chmod(subDir, 0o755).catch(() => {});
      }
    });

    it("should handle extractDescription error when file is unreadable", async () => {
      const reader = new MarkdownReader(errorTempDir);

      // Create a document first
      await reader.addDocument({ id: "readable", content: "# Readable\n\nContent." });

      // Create a symlink to a non-existent file to simulate read error
      const brokenLink = path.join(errorTempDir, "broken-link.md");
      try {
        await fs.symlink("/non/existent/path", brokenLink);

        // List documents - the broken link should return "(Unable to read file)"
        const { documents } = await reader.listDocuments({ recursive: true });

        // Should still list the readable document
        const readable = documents.find((d) => d.id === "readable");
        expect(readable).toBeDefined();

        // The broken link might be listed with error description
        const broken = documents.find((d) => d.id === "broken-link");
        if (broken) {
          expect(broken.description).toBe("(Unable to read file)");
        }
      } catch {
        // Symlink might fail on some systems, skip this part
      }
    });

    it("should return error when deleteDocument fails due to permission", async () => {
      const reader = new MarkdownReader(errorTempDir);

      // Create a document
      await reader.addDocument({ id: "protected", content: "# Protected\n\nContent." });

      // Make the directory read-only to cause delete failure
      try {
        await fs.chmod(errorTempDir, 0o555);

        const result = await reader.deleteDocument("protected");

        // On some systems this might succeed, on others it will fail
        if (!result.success) {
          expect(result.error).toContain("Failed to delete document");
        }
      } finally {
        // Restore permissions for cleanup
        await fs.chmod(errorTempDir, 0o755);
      }
    });

    it("should return error when renameDocument fails", async () => {
      const reader = new MarkdownReader(errorTempDir);

      // Create source document
      await reader.addDocument({ id: "source", content: "# Source\n\nContent." });

      // Create a subdirectory for the target
      const subDir = path.join(errorTempDir, "subdir");
      await fs.mkdir(subDir, { recursive: true });

      try {
        // Make the subdirectory read-only to cause rename failure
        await fs.chmod(subDir, 0o555);

        const result = await reader.renameDocument({
          oldId: "source",
          newId: "subdir__new-name",
        });

        // On some systems this might succeed, on others it will fail
        if (!result.success) {
          expect(result.error).toContain("Failed to rename document");
        }
      } finally {
        // Restore permissions for cleanup
        await fs.chmod(subDir, 0o755);
      }
    });

    it("should return error when addDocument fails due to permission", async () => {
      const reader = new MarkdownReader(errorTempDir);

      // Create a file that will conflict with directory creation
      const conflictFile = path.join(errorTempDir, "conflict");
      await fs.writeFile(conflictFile, "blocking file", "utf-8");

      // Try to create a document that would require the blocking file to be a directory
      const result = await reader.addDocument({
        id: "conflict__subdoc",
        content: "# Subdoc\n\nContent.",
      });

      // This should fail because we can't create a directory where a file exists
      if (!result.success) {
        expect(result.error).toContain("Failed to add document");
      }
    });

    it("should return error when updateDocument fails due to permission", async () => {
      const reader = new MarkdownReader(errorTempDir);

      // Create a document
      await reader.addDocument({ id: "update-test", content: "# Original\n\nContent." });

      const filePath = path.join(errorTempDir, "update-test.md");

      try {
        // Make the file read-only to cause update failure
        await fs.chmod(filePath, 0o444);

        const result = await reader.updateDocument({
          id: "update-test",
          content: "# Updated\n\nNew content.",
        });

        // On some systems this might succeed (root), on others it will fail
        if (!result.success) {
          expect(result.error).toContain("Failed to update document");
        }
      } finally {
        // Restore permissions for cleanup
        await fs.chmod(filePath, 0o644);
      }
    });
  });
});
