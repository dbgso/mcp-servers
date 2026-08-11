import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { UpdateHandler } from "../tools/instruction/handlers/update.js";
import { ApplyHandler } from "../tools/instruction/handlers/apply.js";
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

      const draftContent = "# Test\n\nModified content here.";

      const result = await handler.execute({
        rawParams: {
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
        rawParams: {
          action: "update",
          id: "non-existent",
          content: "# New\n\nUpdated content.",
        },
        context: { reader },
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain(`Document "non-existent" does not exist`);
      expect(text).toContain(`instruction(action: "add"`);

    });

  });

  describe("basic functionality", () => {
    it("requires id and content", async () => {
      const result = await handler.execute({
        rawParams: { action: "update" },
        context: { reader },
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("Required");
    });

    it("creates pending update for existing document", async () => {
      // Create existing document (not draft)
      await fs.writeFile(path.join(docsDir, "existing.md"), "# Old\n\nOld content.");

      const result = await handler.execute({
        rawParams: {
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
      expect(text).toContain('instruction(action: "apply"');
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

      // Update with identical content (the body part only, handler will preserve frontmatter)
      const result = await handler.execute({
        rawParams: {
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
        rawParams: {
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
        rawParams: {
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
        rawParams: {
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
        rawParams: {
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
        rawParams: {
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

  describe("frontmatter preservation (issue #7)", () => {
    // A content-only update used to drop relatedDocs / status / timestamps
    // because generateContentWithFrontmatter only forwarded description+whenToUse
    // to updateFrontmatter.
    const fullFrontmatterDoc = `---
description: 既存の説明
whenToUse:
  - 既存のユースケース
relatedDocs:
  - workflow__plan-tool-required
  - workflow__task-planning-tools
status: approved
confirmedAt: 2026-05-01T00:00:00Z
approvedAt: 2026-05-02T00:00:00Z
---

# Title

Original body.`;

    it("preserves relatedDocs, status, and timestamps when only body changes", async () => {
      await fs.writeFile(path.join(docsDir, "preserve.md"), fullFrontmatterDoc);

      const updateResult = await handler.execute({
        rawParams: {
          action: "update",
          id: "preserve",
          content: "# Title\n\nNew body.",
        },
        context: { reader },
      });

      expect(updateResult.isError).toBeFalsy();

      const applyHandler = new ApplyHandler();
      const applyResult = await applyHandler.execute({
        rawParams: { action: "apply", id: "preserve" },
        context: { reader },
      });
      expect(applyResult.isError).toBeFalsy();

      const written = await fs.readFile(path.join(docsDir, "preserve.md"), "utf-8");
      expect(written).toContain("description: 既存の説明");
      expect(written).toContain("- 既存のユースケース");
      expect(written).toContain("- workflow__plan-tool-required");
      expect(written).toContain("- workflow__task-planning-tools");
      expect(written).toContain("status: approved");
      expect(written).toContain("confirmedAt: 2026-05-01T00:00:00Z");
      expect(written).toContain("approvedAt: 2026-05-02T00:00:00Z");
      expect(written).toContain("New body.");
      expect(written).not.toContain("Original body.");
    });

    it("explicit description overrides existing but leaves other fields untouched", async () => {
      await fs.writeFile(path.join(docsDir, "override-desc.md"), fullFrontmatterDoc);

      const updateResult = await handler.execute({
        rawParams: {
          action: "update",
          id: "override-desc",
          content: "# Title\n\nBody.",
          description: "新しい説明",
        },
        context: { reader },
      });
      expect(updateResult.isError).toBeFalsy();

      const applyHandler = new ApplyHandler();
      await applyHandler.execute({
        rawParams: { action: "apply", id: "override-desc" },
        context: { reader },
      });

      const written = await fs.readFile(path.join(docsDir, "override-desc.md"), "utf-8");
      expect(written).toContain("description: 新しい説明");
      expect(written).not.toContain("description: 既存の説明");
      // Untouched fields remain
      expect(written).toContain("- workflow__plan-tool-required");
      expect(written).toContain("status: approved");
    });
  });
});
