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
    it("shows inline diff when original document exists", async () => {
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

      // Check that diff content is returned inline
      expect(text).toContain("```diff");
      expect(text).toContain("-Original content here.");
      expect(text).toContain("+Modified content here.");
    });

    it("returns error when document does not exist", async () => {
      const result = await handler.execute({
        actionParams: {
          action: "update",
          id: "non-existent",
          content: "# New\n\nUpdated content.",
        },
        context: { reader },
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toBe(`Error: Document "non-existent" does not exist.

Use \`draft(action: "add", ...)\` to create a new document.`);
    });

  });

  describe("basic functionality", () => {
    it("requires id and content", async () => {
      const result = await handler.execute({
        actionParams: { action: "update" },
        context: { reader },
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toBe("Error: id and content are required for update action");
    });

    it("creates pending update for existing document", async () => {
      // Create existing document (not draft)
      await fs.writeFile(path.join(docsDir, "existing.md"), "# Old\n\nOld content.");

      const result = await handler.execute({
        actionParams: {
          action: "update",
          id: "existing",
          content: "# New\n\nNew content.",
        },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain('Update prepared for "existing"');
      expect(text).toContain("```diff");
      expect(text).toContain('draft(action: "apply"');
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
    // Note: These tests verify description inference in the diff output,
    // since update now only works with existing documents and creates pending updates.

    it("skips empty lines before title", async () => {
      // Create existing document
      await fs.writeFile(path.join(docsDir, "empty-before-title.md"), "# Old\n\nOld content.");

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
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      // Should show diff with inferred description
      expect(text).toContain("```diff");
      expect(text).toContain("description: This is the description paragraph.");
    });

    it("stops at sub-heading", async () => {
      // Create existing document
      await fs.writeFile(path.join(docsDir, "sub-heading.md"), "# Old\n\nOld content.");

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
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      // Should only include first paragraph in description
      expect(text).toContain("description: First paragraph.");
    });

    it("stops at code block", async () => {
      // Create existing document
      await fs.writeFile(path.join(docsDir, "code-block.md"), "# Old\n\nOld content.");

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
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("description: Description text.");
    });

    it("collects multiple lines in first paragraph", async () => {
      // Create existing document
      await fs.writeFile(path.join(docsDir, "multi-line.md"), "# Old\n\nOld content.");

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
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      // Should join all lines with space
      expect(text).toContain("description: Line one of paragraph. Line two of paragraph. Line three of paragraph.");
    });

    it("stops at empty line after paragraph", async () => {
      // Create existing document
      await fs.writeFile(path.join(docsDir, "empty-after.md"), "# Old\n\nOld content.");

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
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      // Description should only be first paragraph
      expect(text).toContain("description: First paragraph content.");
    });
  });
});
