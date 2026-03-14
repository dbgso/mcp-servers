import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { UpdateHandler } from "../tools/draft/handlers/update-handler.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_PREFIX } from "../constants.js";

describe("UpdateHandler", () => {
  let tempDir: string;
  let docsDir: string;
  let draftsDir: string;
  let reader: MarkdownReader;
  let handler: UpdateHandler;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "update-handler-test-"));
    docsDir = path.join(tempDir, "docs");
    draftsDir = path.join(docsDir, "_mcp_drafts");
    await fs.mkdir(draftsDir, { recursive: true });

    reader = new MarkdownReader(docsDir);
    handler = new UpdateHandler();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("diff generation", () => {
    it("writes diff to file when original document exists", async () => {
      // Create original document
      const originalContent = "# Test\n\nOriginal content here.";
      await fs.writeFile(path.join(docsDir, "test-doc.md"), originalContent);

      // Create draft
      const draftContent = "# Test\n\nModified content here.";
      await fs.writeFile(path.join(draftsDir, "test-doc.md"), "# Test\n\nInitial draft.");

      const result = await handler.execute({
        actionParams: {
          action: "update",
          id: "test-doc",
          content: draftContent,
        },
        context: { reader },
      });

      const text = result.content[0].type === "text" ? result.content[0].text : "";

      // Check that diff file path is returned
      expect(text).toContain("**Diff:**");
      expect(text).toContain(".diff");

      // Extract diff file path and verify content
      const diffPathMatch = text.match(/\*\*Diff:\*\* (.+\.diff)/);
      expect(diffPathMatch).not.toBeNull();

      const diffPath = diffPathMatch![1];
      const diffContent = await fs.readFile(diffPath, "utf-8");
      expect(diffContent).toContain("-Original content here.");
      expect(diffContent).toContain("+Modified content here.");
    });

    it("does not show diff when original document does not exist", async () => {
      // Create only draft, no original
      await fs.writeFile(path.join(draftsDir, "new-doc.md"), "# New\n\nInitial.");

      const result = await handler.execute({
        actionParams: {
          action: "update",
          id: "new-doc",
          content: "# New\n\nUpdated content.",
        },
        context: { reader },
      });

      const text = result.content[0].type === "text" ? result.content[0].text : "";

      expect(text).toContain('Draft "new-doc" updated successfully');
      expect(text).not.toContain("**Diff:**");
    });

  });

  describe("basic functionality", () => {
    it("requires id and content", async () => {
      const result = await handler.execute({
        actionParams: { action: "update" },
        context: { reader },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].type === "text" && result.content[0].text).toContain(
        "id and content are required"
      );
    });

    it("updates draft file successfully", async () => {
      await fs.writeFile(path.join(draftsDir, "existing.md"), "# Old");

      const result = await handler.execute({
        actionParams: {
          action: "update",
          id: "existing",
          content: "# New\n\nNew content.",
        },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await fs.readFile(
        path.join(draftsDir, "existing.md"),
        "utf-8"
      );
      expect(updatedContent).toContain("New content");
    });
  });
});
