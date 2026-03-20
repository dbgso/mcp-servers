import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ApplyHandler } from "../tools/draft/handlers/apply-handler.js";
import { CancelHandler } from "../tools/draft/handlers/cancel-handler.js";
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
