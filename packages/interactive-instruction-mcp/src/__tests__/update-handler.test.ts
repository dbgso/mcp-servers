import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { UpdateHandler } from "../tools/draft/handlers/update-handler.js";
import { MarkdownReader } from "../services/markdown-reader.js";

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

    it("detects no changes when content is identical to original", async () => {
      // Create original document with full frontmatter
      const content = `---
description: Test description
whenToUse:
  - Testing
---

# Test

Same content here.`;
      await fs.writeFile(path.join(docsDir, "same-content.md"), content);

      // Create draft with same content
      await fs.writeFile(path.join(draftsDir, "same-content.md"), content);

      // Update with identical content (the body part only, handler will preserve frontmatter)
      const result = await handler.execute({
        actionParams: {
          action: "update",
          id: "same-content",
          content: content,  // same as original including frontmatter
        },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("No changes detected");
    });
  });

  describe("inferDescription branches", () => {
    it("skips empty lines before title (line 246)", async () => {
      // Create draft with empty lines before title, no frontmatter
      await fs.writeFile(path.join(draftsDir, "empty-before-title.md"), "# Old");

      // Update with content that has empty lines before title
      const content = `

# Title

This is the description paragraph.`;

      const result = await handler.execute({
        actionParams: {
          action: "update",
          id: "empty-before-title",
          content,
        },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      // Should infer description from first paragraph
      const updatedContent = await fs.readFile(
        path.join(draftsDir, "empty-before-title.md"),
        "utf-8"
      );
      expect(updatedContent).toContain("description: This is the description paragraph.");
    });

    it("stops at sub-heading (line 253 # branch)", async () => {
      // Create draft without frontmatter
      await fs.writeFile(path.join(draftsDir, "sub-heading.md"), "# Old");

      // Update with content that has a sub-heading after first paragraph
      const content = `# Title

First paragraph.

## Sub-heading

More content.`;

      const result = await handler.execute({
        actionParams: {
          action: "update",
          id: "sub-heading",
          content,
        },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const updatedContent = await fs.readFile(
        path.join(draftsDir, "sub-heading.md"),
        "utf-8"
      );
      // Should only include first paragraph in description, not content after sub-heading
      expect(updatedContent).toContain("description: First paragraph.");
      // Description should not contain text after sub-heading
      expect(updatedContent).not.toContain("description: First paragraph. More content");
    });

    it("stops at code block (line 253 ``` branch)", async () => {
      // Create draft without frontmatter
      await fs.writeFile(path.join(draftsDir, "code-block.md"), "# Old");

      // Update with content that has code block after paragraph
      const content = `# Title

Description text.

\`\`\`typescript
code here
\`\`\``;

      const result = await handler.execute({
        actionParams: {
          action: "update",
          id: "code-block",
          content,
        },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const updatedContent = await fs.readFile(
        path.join(draftsDir, "code-block.md"),
        "utf-8"
      );
      expect(updatedContent).toContain("description: Description text.");
    });

    it("collects multiple lines in first paragraph (line 254)", async () => {
      // Create draft without frontmatter
      await fs.writeFile(path.join(draftsDir, "multi-line.md"), "# Old");

      // Update with multi-line paragraph
      const content = `# Title

Line one of paragraph.
Line two of paragraph.
Line three of paragraph.

Next section.`;

      const result = await handler.execute({
        actionParams: {
          action: "update",
          id: "multi-line",
          content,
        },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const updatedContent = await fs.readFile(
        path.join(draftsDir, "multi-line.md"),
        "utf-8"
      );
      // Should join all lines with space
      expect(updatedContent).toContain("description: Line one of paragraph. Line two of paragraph. Line three of paragraph.");
    });

    it("stops at empty line after paragraph (line 256)", async () => {
      // Create draft without frontmatter
      await fs.writeFile(path.join(draftsDir, "empty-after.md"), "# Old");

      // Update with content that has empty line after paragraph
      const content = `# Title

First paragraph content.

This should not be included.`;

      const result = await handler.execute({
        actionParams: {
          action: "update",
          id: "empty-after",
          content,
        },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const updatedContent = await fs.readFile(
        path.join(draftsDir, "empty-after.md"),
        "utf-8"
      );
      // Description should only be first paragraph
      expect(updatedContent).toContain("description: First paragraph content.");
      // Description should not include second paragraph
      expect(updatedContent).not.toContain("description: First paragraph content. This should not be included");
    });
  });
});
