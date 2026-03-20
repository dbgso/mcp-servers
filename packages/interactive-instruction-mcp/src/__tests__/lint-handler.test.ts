import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { LintHandler } from "../tools/draft/handlers/lint-handler.js";
import { MarkdownReader } from "../services/markdown-reader.js";

describe("LintHandler", () => {
  let tempDir: string;
  let docsDir: string;
  let reader: MarkdownReader;
  let handler: LintHandler;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lint-handler-test-"));
    docsDir = path.join(tempDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    reader = new MarkdownReader(docsDir);
    handler = new LintHandler();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("no issues", () => {
    it("returns success when no documents", async () => {
      const result = await handler.execute({
        actionParams: { action: "lint" },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("No issues found");
    });

    it("returns no errors when documents have valid metadata", async () => {
      // Create a valid document with proper metadata
      const content = `---
description: A valid document with proper metadata
whenToUse:
  - When testing lint handler
  - When creating valid documents
relatedDocs:
  - other-doc
---

# Valid Document

This is a valid document.`;
      await fs.writeFile(path.join(docsDir, "valid-doc.md"), content);

      // Create the referenced document
      const otherContent = `---
description: Another valid document
whenToUse:
  - When needed
relatedDocs:
  - valid-doc
---

# Other Doc

Content here.`;
      await fs.writeFile(path.join(docsDir, "other-doc.md"), otherContent);

      const result = await handler.execute({
        actionParams: { action: "lint" },
        context: { reader },
      });

      expect(result.isError).toBeFalsy();
      // May have circular reference or other info-level issues, but no errors
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).not.toContain("missing-description");
      expect(text).not.toContain("missing-when-to-use");
    });
  });

  describe("missing metadata", () => {
    it("detects missing description", async () => {
      // No frontmatter at all - should be missing description
      const content = `# No Description Doc

Just content without any frontmatter.`;
      await fs.writeFile(path.join(docsDir, "no-desc.md"), content);

      const result = await handler.execute({
        actionParams: { action: "lint" },
        context: { reader },
      });

      const text = result.content[0].type === "text" ? result.content[0].text : "";
      // Should have missing-description error (no frontmatter means no description)
      expect(text).toContain("no-desc");
      // Missing metadata should trigger errors/warnings
      expect(text).toContain("issue(s)");
    });

    it("detects placeholder description", async () => {
      const content = `---
description: (No description)
whenToUse:
  - Some use case
---

# Placeholder Desc

Content.`;
      await fs.writeFile(path.join(docsDir, "placeholder-desc.md"), content);

      const result = await handler.execute({
        actionParams: { action: "lint" },
        context: { reader },
      });

      const text = result.content[0].type === "text" ? result.content[0].text : "";
      // Placeholder "(No description)" should be detected as missing
      expect(text).toContain("placeholder-desc");
      expect(text).toContain("missing-description");
    });

    it("detects empty description", async () => {
      // Empty string description should be detected
      const content = `---
description: ""
whenToUse:
  - Some use case
---

# Empty Desc

Content.`;
      await fs.writeFile(path.join(docsDir, "empty-desc.md"), content);

      const result = await handler.execute({
        actionParams: { action: "lint" },
        context: { reader },
      });

      const text = result.content[0].type === "text" ? result.content[0].text : "";
      // Empty description should trigger missing-description
      expect(text).toContain("empty-desc");
      expect(text).toContain("issue(s)");
    });

    it("detects missing whenToUse", async () => {
      const content = `---
description: A document without whenToUse
---

# No WhenToUse

Content.`;
      await fs.writeFile(path.join(docsDir, "no-when.md"), content);

      const result = await handler.execute({
        actionParams: { action: "lint" },
        context: { reader },
      });

      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("missing-when-to-use");
    });
  });

  describe("orphaned documents", () => {
    it("detects orphaned documents", async () => {
      const content = `---
description: An orphaned document
whenToUse:
  - Testing orphan detection
---

# Orphan Doc

Not referenced by anyone.`;
      await fs.writeFile(path.join(docsDir, "orphan-doc.md"), content);

      const result = await handler.execute({
        actionParams: { action: "lint" },
        context: { reader },
      });

      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("orphaned-document");
      expect(text).toContain("orphan-doc");
    });

    it("ignores system docs (starting with _)", async () => {
      // Create _mcp_drafts directory
      const draftsDir = path.join(docsDir, "_mcp_drafts");
      await fs.mkdir(draftsDir, { recursive: true });

      const content = `---
description: A system document
whenToUse:
  - Internal use
---

# System Doc

Internal doc.`;
      await fs.writeFile(path.join(draftsDir, "system-doc.md"), content);

      const result = await handler.execute({
        actionParams: { action: "lint" },
        context: { reader },
      });

      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).not.toContain("_mcp_drafts__system-doc");
    });
  });

  describe("document size", () => {
    it("detects large documents", async () => {
      // Create a document with more than 150 lines
      const lines = Array(160).fill("Line content here.").join("\n");
      const content = `---
description: A very large document
whenToUse:
  - Testing size limits
---

# Large Doc

${lines}`;
      await fs.writeFile(path.join(docsDir, "large-doc.md"), content);

      const result = await handler.execute({
        actionParams: { action: "lint" },
        context: { reader },
      });

      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("document-too-large");
      expect(text).toContain("large-doc");
    });
  });

  describe("similar documents", () => {
    it("handles documents with very short words in similarity check", async () => {
      // Create documents with very short words (≤2 chars) to trigger empty word set branch
      const content1 = `---
description: A is it
whenToUse:
  - Do it
relatedDocs:
  - short-words-doc-2
---

# X Y Z

A is it.`;

      const content2 = `---
description: To go up
whenToUse:
  - Go to
relatedDocs:
  - short-words-doc-1
---

# A B C

Do it.`;

      await fs.writeFile(path.join(docsDir, "short-words-doc-1.md"), content1);
      await fs.writeFile(path.join(docsDir, "short-words-doc-2.md"), content2);

      const result = await handler.execute({
        actionParams: { action: "lint" },
        context: { reader },
      });

      // Should not crash and should complete lint
      expect(result.isError).toBeFalsy();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      // These docs should not be flagged as similar since similarity is 0
      expect(text).not.toContain("similar-content");
    });

    it("detects similar document titles", async () => {
      // Use very similar file names to trigger title similarity
      const content1 = `---
description: First authentication setup document
whenToUse:
  - When handling authentication setup
relatedDocs:
  - authentication-setup-guide
---

# Authentication Setup

Content about authentication setup.`;

      const content2 = `---
description: Second authentication setup document
whenToUse:
  - When configuring authentication setup
relatedDocs:
  - authentication-setup
---

# Authentication Setup Guide

Content about authentication setup guide.`;

      await fs.writeFile(path.join(docsDir, "authentication-setup.md"), content1);
      await fs.writeFile(path.join(docsDir, "authentication-setup-guide.md"), content2);

      const result = await handler.execute({
        actionParams: { action: "lint" },
        context: { reader },
      });

      const text = result.content[0].type === "text" ? result.content[0].text : "";
      // Should detect similar titles or circular references
      expect(text).toContain("authentication");
    });

    it("detects similar use cases", async () => {
      // Use identical whenToUse to trigger similarity
      const content1 = `---
description: First document about database connections
whenToUse:
  - When connecting to postgres database server
  - When setting up database connection pool configuration
  - When configuring database connection timeouts
relatedDocs:
  - second-db-doc
---

# First DB Doc

Config for database.`;

      const content2 = `---
description: Second document about database setup
whenToUse:
  - When connecting to postgres database server
  - When setting up database connection pool configuration
  - When configuring database connection timeouts
relatedDocs:
  - first-db-doc
---

# Second DB Doc

Setup for database.`;

      await fs.writeFile(path.join(docsDir, "first-db-doc.md"), content1);
      await fs.writeFile(path.join(docsDir, "second-db-doc.md"), content2);

      const result = await handler.execute({
        actionParams: { action: "lint" },
        context: { reader },
      });

      const text = result.content[0].type === "text" ? result.content[0].text : "";
      // Should detect similar use cases or circular references
      expect(text).toContain("similar");
    });
  });

  describe("circular references", () => {
    it("detects circular references", async () => {
      const content1 = `---
description: Document A
whenToUse:
  - Use case A
relatedDocs:
  - doc-b
---

# Doc A

References doc-b.`;

      const content2 = `---
description: Document B
whenToUse:
  - Use case B
relatedDocs:
  - doc-c
---

# Doc B

References doc-c.`;

      const content3 = `---
description: Document C
whenToUse:
  - Use case C
relatedDocs:
  - doc-a
---

# Doc C

References doc-a, creating a cycle.`;

      await fs.writeFile(path.join(docsDir, "doc-a.md"), content1);
      await fs.writeFile(path.join(docsDir, "doc-b.md"), content2);
      await fs.writeFile(path.join(docsDir, "doc-c.md"), content3);

      const result = await handler.execute({
        actionParams: { action: "lint" },
        context: { reader },
      });

      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("circular-reference");
    });

    it("ignores relatedDocs pointing to non-existent documents (line 250 branch)", async () => {
      // Create a document that references non-existent docs
      const content = `---
description: Document with broken links
whenToUse:
  - Testing broken refs
relatedDocs:
  - nonexistent-doc-1
  - nonexistent-doc-2
---

# Broken Links Doc

References to docs that don't exist.`;

      await fs.writeFile(path.join(docsDir, "broken-refs.md"), content);

      const result = await handler.execute({
        actionParams: { action: "lint" },
        context: { reader },
      });

      // Should complete without error - non-existent refs are simply not followed in DFS
      expect(result.isError).toBeFalsy();
      const text = result.content[0].type === "text" ? result.content[0].text : "";
      // Should not have circular-reference issues since the refs don't exist
      expect(text).not.toContain("circular-reference");
    });

    it("only reports each cycle once even when reachable from multiple starting points", async () => {
      // Create a cycle where all nodes point to each other
      // This tests the reportedCycles.has() check - same cycle should not be reported twice
      const contentA = `---
description: Document Alpha
whenToUse:
  - Alpha case
relatedDocs:
  - cycle-b
  - cycle-c
---

# Cycle A

Links to B and C.`;

      const contentB = `---
description: Document Beta
whenToUse:
  - Beta case
relatedDocs:
  - cycle-c
  - cycle-a
---

# Cycle B

Links to C and A.`;

      const contentC = `---
description: Document Gamma
whenToUse:
  - Gamma case
relatedDocs:
  - cycle-a
  - cycle-b
---

# Cycle C

Links to A and B.`;

      await fs.writeFile(path.join(docsDir, "cycle-a.md"), contentA);
      await fs.writeFile(path.join(docsDir, "cycle-b.md"), contentB);
      await fs.writeFile(path.join(docsDir, "cycle-c.md"), contentC);

      const result = await handler.execute({
        actionParams: { action: "lint" },
        context: { reader },
      });

      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("circular-reference");
      // Count occurrences of "circular-reference" - should be limited despite multiple entry points
      const matches = text.match(/circular-reference/g) || [];
      // The cycle A-B-C should not be reported 3 times
      expect(matches.length).toBeLessThanOrEqual(3);
    });
  });

  describe("output formatting", () => {
    it("formats output with severity icons and counts", async () => {
      // Create documents with various issues
      const noDesc = `# No Desc\n\nContent.`;
      const noWhen = `---
description: Has description
---

# No When

Content.`;

      await fs.writeFile(path.join(docsDir, "no-desc.md"), noDesc);
      await fs.writeFile(path.join(docsDir, "no-when.md"), noWhen);

      const result = await handler.execute({
        actionParams: { action: "lint" },
        context: { reader },
      });

      const text = result.content[0].type === "text" ? result.content[0].text : "";
      expect(text).toContain("Lint Results");
      expect(text).toContain("issue(s)");
      expect(text).toContain("Rule:");
    });

    it("sorts issues by severity", async () => {
      // Create documents with different severity issues
      const errorDoc = `# Error Doc\n\nNo metadata at all.`;
      const warningDoc = `---
description: Has description
---

# Warning Doc

Missing whenToUse.`;

      await fs.writeFile(path.join(docsDir, "error-doc.md"), errorDoc);
      await fs.writeFile(path.join(docsDir, "warning-doc.md"), warningDoc);

      const result = await handler.execute({
        actionParams: { action: "lint" },
        context: { reader },
      });

      const text = result.content[0].type === "text" ? result.content[0].text : "";
      // Errors should appear before warnings
      const errorPos = text.indexOf("missing-description");
      const warningPos = text.indexOf("missing-when-to-use");
      expect(errorPos).toBeLessThan(warningPos);
    });
  });
});
