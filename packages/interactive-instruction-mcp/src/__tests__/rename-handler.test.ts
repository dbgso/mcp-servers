import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { RenameHandler } from "../tools/draft/handlers/rename-handler.js";
import { MarkdownReader } from "../services/markdown-reader.js";

// Mock mcp-shared
vi.mock("mcp-shared", () => ({
  requestApproval: vi.fn().mockResolvedValue({ fallbackPath: "/tmp/token.txt" }),
  validateApproval: vi.fn().mockReturnValue({ valid: true }),
  getApprovalRequestedMessage: vi.fn().mockReturnValue("Check desktop notification for token"),
  getApprovalRejectionMessage: vi.fn().mockReturnValue("Approval rejected"),
}));

import { validateApproval } from "mcp-shared";

describe("RenameHandler", () => {
  let tempDir: string;
  let docsDir: string;
  let draftsDir: string;
  let reader: MarkdownReader;
  let handler: RenameHandler;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rename-handler-test-"));
    docsDir = path.join(tempDir, "docs");
    draftsDir = path.join(docsDir, "_mcp_drafts");
    await fs.mkdir(draftsDir, { recursive: true });

    reader = new MarkdownReader(docsDir);
    handler = new RenameHandler();

    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("validation", () => {
    it("requires id parameter", async () => {
      const result = await handler.execute({
        actionParams: { action: "rename", newId: "new-name" },
        context: { reader },
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("id and newId are required");
    });

    it("requires newId parameter", async () => {
      const result = await handler.execute({
        actionParams: { action: "rename", id: "old-name" },
        context: { reader },
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("id and newId are required");
    });

    it("returns error when document not found", async () => {
      const result = await handler.execute({
        actionParams: { action: "rename", id: "nonexistent", newId: "new-name" },
        context: { reader },
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("not found");
    });
  });

  describe("draft rename", () => {
    it("renames draft without approval", async () => {
      const content = `---
description: A draft document
---

# Draft Doc

Content.`;
      await fs.writeFile(path.join(draftsDir, "old-draft.md"), content);

      const result = await handler.execute({
        actionParams: { action: "rename", id: "old-draft", newId: "new-draft" },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("renamed");
      expect(text).toContain("old-draft");
      expect(text).toContain("new-draft");

      // Verify file was renamed
      const oldExists = await fs.access(path.join(draftsDir, "old-draft.md")).then(() => true).catch(() => false);
      const newExists = await fs.access(path.join(draftsDir, "new-draft.md")).then(() => true).catch(() => false);
      expect(oldExists).toBe(false);
      expect(newExists).toBe(true);
    });

    it("returns error when draft rename fails", async () => {
      // Try to rename to a path that already exists
      const content1 = `# Draft 1\n\nContent.`;
      const content2 = `# Draft 2\n\nContent.`;
      await fs.writeFile(path.join(draftsDir, "draft-1.md"), content1);
      await fs.writeFile(path.join(draftsDir, "draft-2.md"), content2);

      const result = await handler.execute({
        actionParams: { action: "rename", id: "draft-1", newId: "draft-2" },
        context: { reader },
      });

      expect(result.isError).toBe(true);
    });
  });

  describe("promoted document rename - preview", () => {
    it("shows preview without confirmed flag", async () => {
      const content = `---
description: A promoted document
---

# Promoted Doc

Content.`;
      await fs.writeFile(path.join(docsDir, "promoted-doc.md"), content);

      const result = await handler.execute({
        actionParams: { action: "rename", id: "promoted-doc", newId: "new-promoted" },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("Rename Preview");
      expect(text).toContain("promoted-doc");
      expect(text).toContain("new-promoted");
      expect(text).toContain("confirmed: true");
    });

    it("shows backlinks in preview", async () => {
      const docContent = `---
description: Main document
---

# Main Doc

Content.`;
      const refContent = `---
description: References main doc
relatedDocs:
  - main-doc
---

# Referencing Doc

References main-doc.`;

      await fs.writeFile(path.join(docsDir, "main-doc.md"), docContent);
      await fs.writeFile(path.join(docsDir, "ref-doc.md"), refContent);

      const result = await handler.execute({
        actionParams: { action: "rename", id: "main-doc", newId: "renamed-doc" },
        context: { reader },
      });

      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("Backlinks");
      expect(text).toContain("ref-doc");
    });
  });

  describe("promoted document rename - approval flow", () => {
    it("requests approval with confirmed flag", async () => {
      const content = `---
description: A promoted document
---

# Promoted Doc

Content.`;
      await fs.writeFile(path.join(docsDir, "promoted-doc.md"), content);

      const result = await handler.execute({
        actionParams: { action: "rename", id: "promoted-doc", newId: "new-promoted", confirmed: true },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("Approval Requested");
      expect(text).toContain("promoted-doc");
      expect(text).toContain("new-promoted");
      expect(text).toContain("approvalToken");
    });

    it("applies rename with valid token", async () => {
      const content = `---
description: A promoted document
---

# Promoted Doc

Content.`;
      await fs.writeFile(path.join(docsDir, "promoted-doc.md"), content);

      // First request approval
      await handler.execute({
        actionParams: { action: "rename", id: "promoted-doc", newId: "new-promoted", confirmed: true },
        context: { reader },
      });

      // Then apply with token
      const result = await handler.execute({
        actionParams: { action: "rename", id: "promoted-doc", newId: "new-promoted", approvalToken: "valid-token" },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("Successfully renamed");

      // Verify file was renamed
      const oldExists = await fs.access(path.join(docsDir, "promoted-doc.md")).then(() => true).catch(() => false);
      const newExists = await fs.access(path.join(docsDir, "new-promoted.md")).then(() => true).catch(() => false);
      expect(oldExists).toBe(false);
      expect(newExists).toBe(true);
    });

    it("returns error when no pending rename exists", async () => {
      const content = `---
description: A document
---

# Doc

Content.`;
      await fs.writeFile(path.join(docsDir, "some-doc.md"), content);

      const result = await handler.execute({
        actionParams: { action: "rename", id: "some-doc", newId: "other-doc", approvalToken: "some-token" },
        context: { reader },
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("No pending rename found");
    });

    it("returns error when token is invalid", async () => {
      const content = `---
description: A document
---

# Doc

Content.`;
      await fs.writeFile(path.join(docsDir, "token-test.md"), content);

      // Request approval
      await handler.execute({
        actionParams: { action: "rename", id: "token-test", newId: "token-renamed", confirmed: true },
        context: { reader },
      });

      // Mock invalid token
      vi.mocked(validateApproval).mockReturnValueOnce({ valid: false, reason: "Invalid token" });

      const result = await handler.execute({
        actionParams: { action: "rename", id: "token-test", newId: "token-renamed", approvalToken: "invalid-token" },
        context: { reader },
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("rejected");
    });

    it("updates backlinks when renaming", async () => {
      const mainContent = `---
description: Main document
---

# Main Doc

Content.`;
      const refContent = `---
description: References main doc
relatedDocs:
  - main-doc
---

# Referencing Doc

Content that references another doc.`;

      await fs.writeFile(path.join(docsDir, "main-doc.md"), mainContent);
      await fs.writeFile(path.join(docsDir, "ref-doc.md"), refContent);

      // Request approval
      await handler.execute({
        actionParams: { action: "rename", id: "main-doc", newId: "renamed-doc", confirmed: true },
        context: { reader },
      });

      // Apply
      const result = await handler.execute({
        actionParams: { action: "rename", id: "main-doc", newId: "renamed-doc", approvalToken: "valid-token" },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("Successfully renamed");

      // Check relatedDocs in frontmatter was updated
      const updatedRefContent = await fs.readFile(path.join(docsDir, "ref-doc.md"), "utf-8");
      expect(updatedRefContent).toContain("relatedDocs:");
      expect(updatedRefContent).toContain("renamed-doc");
    });

    it("returns error when renameDocument fails", async () => {
      const content = `---
description: A document to rename
---

# Doc to rename

Content.`;
      await fs.writeFile(path.join(docsDir, "rename-fail-doc.md"), content);

      // Request approval
      await handler.execute({
        actionParams: { action: "rename", id: "rename-fail-doc", newId: "renamed-fail", confirmed: true },
        context: { reader },
      });

      // Mock renameDocument to fail
      const renameSpy = vi.spyOn(reader, "renameDocument").mockResolvedValueOnce({
        success: false,
        error: "File system error: disk full",
      });

      // Apply with valid token but mock failure
      const result = await handler.execute({
        actionParams: { action: "rename", id: "rename-fail-doc", newId: "renamed-fail", approvalToken: "valid-token" },
        context: { reader },
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("File system error: disk full");

      renameSpy.mockRestore();
    });
  });
});
