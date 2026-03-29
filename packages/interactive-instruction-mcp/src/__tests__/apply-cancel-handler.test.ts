import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ApplyHandler } from "../tools/draft/handlers/apply-handler.js";
import { CancelHandler } from "../tools/draft/handlers/cancel-handler.js";
import { UpdateHandler } from "../tools/draft/handlers/update-handler.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import { savePendingUpdate, getPendingUpdate, deletePendingUpdate } from "../utils/pending-update.js";

describe("ApplyHandler", () => {
  let tempDir: string;
  let docsDir: string;
  let reader: MarkdownReader;
  let handler: ApplyHandler;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "apply-handler-test-"));
    docsDir = path.join(tempDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    reader = new MarkdownReader(docsDir);
    handler = new ApplyHandler();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("requires id", async () => {
    const result = await handler.execute({
      actionParams: { action: "apply" },
      context: { reader },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].type === "text" && result.content[0].text).toContain(
      "id is required"
    );
  });

  it("returns error when no pending update exists", async () => {
    const result = await handler.execute({
      actionParams: { action: "apply", id: "nonexistent" },
      context: { reader },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].type === "text" && result.content[0].text).toContain(
      "No pending update found"
    );
  });

  it("applies pending update to file", async () => {
    // Create original file
    const originalPath = path.join(docsDir, "test-doc.md");
    await fs.writeFile(originalPath, "# Original\n\nOld content.");

    // Create pending update
    const diffPath = path.join(tempDir, "test.diff");
    await fs.writeFile(diffPath, "diff content");

    await savePendingUpdate({
      id: "test-doc",
      content: "# Updated\n\nNew content.",
      originalPath,
      diffPath,
    });

    // Apply
    const result = await handler.execute({
      actionParams: { action: "apply", id: "test-doc" },
      context: { reader },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].type === "text" && result.content[0].text).toContain(
      "Update applied successfully"
    );

    // Verify file was updated
    const content = await fs.readFile(originalPath, "utf-8");
    expect(content).toContain("New content");

    // Verify pending was cleaned up
    const pending = await getPendingUpdate("test-doc");
    expect(pending).toBeNull();
  });

  it("returns error when file write fails", async () => {
    // Create pending update with invalid path (directory doesn't exist)
    const invalidPath = path.join(tempDir, "nonexistent", "deep", "nested", "file.md");
    const diffPath = path.join(tempDir, "test.diff");
    await fs.writeFile(diffPath, "diff content");

    await savePendingUpdate({
      id: "write-fail-test",
      content: "# Content",
      originalPath: invalidPath,
      diffPath,
    });

    // Try to apply
    const result = await handler.execute({
      actionParams: { action: "apply", id: "write-fail-test" },
      context: { reader },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].type === "text" && result.content[0].text).toContain(
      "Error applying update"
    );

    // Clean up the pending update
    await deletePendingUpdate("write-fail-test");
  });

});

describe("CancelHandler", () => {
  let tempDir: string;
  let docsDir: string;
  let reader: MarkdownReader;
  let handler: CancelHandler;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cancel-handler-test-"));
    docsDir = path.join(tempDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    reader = new MarkdownReader(docsDir);
    handler = new CancelHandler();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("requires id", async () => {
    const result = await handler.execute({
      actionParams: { action: "cancel" },
      context: { reader },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].type === "text" && result.content[0].text).toContain(
      "id is required"
    );
  });

  it("returns error when no pending update exists", async () => {
    const result = await handler.execute({
      actionParams: { action: "cancel", id: "nonexistent" },
      context: { reader },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].type === "text" && result.content[0].text).toContain(
      "No pending update found"
    );
  });

  it("cancels pending update and cleans up", async () => {
    // Create pending update
    const originalPath = path.join(docsDir, "test-doc.md");
    const diffPath = path.join(tempDir, "test.diff");
    await fs.writeFile(diffPath, "diff content");

    await savePendingUpdate({
      id: "test-doc",
      content: "# New",
      originalPath,
      diffPath,
    });

    // Cancel
    const result = await handler.execute({
      actionParams: { action: "cancel", id: "test-doc" },
      context: { reader },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].type === "text" && result.content[0].text).toContain(
      "cancelled"
    );

    // Verify pending was cleaned up
    const pending = await getPendingUpdate("test-doc");
    expect(pending).toBeNull();
  });
});

describe("Update → Apply/Cancel integration", () => {
  let tempDir: string;
  let docsDir: string;
  let reader: MarkdownReader;
  let updateHandler: UpdateHandler;
  let applyHandler: ApplyHandler;
  let cancelHandler: CancelHandler;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "update-apply-integration-"));
    docsDir = path.join(tempDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    reader = new MarkdownReader(docsDir);
    updateHandler = new UpdateHandler();
    applyHandler = new ApplyHandler();
    cancelHandler = new CancelHandler();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("update → apply: full flow for existing document", async () => {
    // Step 1: Create existing document
    const docPath = path.join(docsDir, "existing-doc.md");
    await fs.writeFile(docPath, `---
description: Original description
---

# Existing Doc

Original content here.`);

    // Step 2: Call update (creates pending + diff)
    const updateResult = await updateHandler.execute({
      actionParams: {
        action: "update",
        id: "existing-doc",
        content: `---
description: Original description
---

# Existing Doc

Updated content here.`,
      },
      context: { reader },
    });

    expect(updateResult.isError).toBeFalsy();
    const updateText = updateResult.content[0].type === "text" ? updateResult.content[0].text : "";
    expect(updateText).toContain("Update prepared");
    expect(updateText).toContain("```diff");
    expect(updateText).toContain("-Original content here.");
    expect(updateText).toContain("+Updated content here.");

    // Step 3: Call apply
    const applyResult = await applyHandler.execute({
      actionParams: { action: "apply", id: "existing-doc" },
      context: { reader },
    });

    expect(applyResult.isError).toBeFalsy();
    const applyText = applyResult.content[0].type === "text" ? applyResult.content[0].text : "";
    expect(applyText).toContain("Update applied successfully");

    // Step 4: Verify file was updated
    const finalContent = await fs.readFile(docPath, "utf-8");
    expect(finalContent).toContain("Updated content here.");
    expect(finalContent).not.toContain("Original content here.");
  });

  it("update → cancel: discards changes", async () => {
    // Step 1: Create existing document
    const docPath = path.join(docsDir, "cancel-test.md");
    const originalContent = `---
description: Test doc
---

# Cancel Test

Original content.`;
    await fs.writeFile(docPath, originalContent);

    // Step 2: Call update
    const updateResult = await updateHandler.execute({
      actionParams: {
        action: "update",
        id: "cancel-test",
        content: `---
description: Test doc
---

# Cancel Test

This change will be cancelled.`,
      },
      context: { reader },
    });

    expect(updateResult.isError).toBeFalsy();

    // Step 3: Call cancel
    const cancelResult = await cancelHandler.execute({
      actionParams: { action: "cancel", id: "cancel-test" },
      context: { reader },
    });

    expect(cancelResult.isError).toBeFalsy();
    const cancelText = cancelResult.content[0].type === "text" ? cancelResult.content[0].text : "";
    expect(cancelText).toContain("cancelled");

    // Step 4: Verify file was NOT changed
    const finalContent = await fs.readFile(docPath, "utf-8");
    expect(finalContent).toContain("Original content.");
    expect(finalContent).not.toContain("This change will be cancelled.");
  });
});
